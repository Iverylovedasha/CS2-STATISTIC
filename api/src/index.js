import { normalizeFaceit, normalizeSteamInventory, parsePlayerQuery } from './normalize.js';

const CACHE_SECONDS = 5 * 60;
const STEAM_API = 'https://api.steampowered.com';
const FACEIT_API = 'https://open.faceit.com/data/v4';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    if (request.method !== 'GET') return response({ error: { code: 'method_not_allowed', message: 'Разрешены только GET-запросы.' } }, 405);
    if (url.pathname === '/health') return response({ ok: true, now: new Date().toISOString() });
    if (url.pathname !== '/v1/profile') return response({ error: { code: 'not_found', message: 'Маршрут не найден.' } }, 404);

    const query = parsePlayerQuery(url.searchParams.get('query'));
    if (query.kind === 'invalid') return response({ error: { code: 'invalid_query', message: query.reason } }, 400);

    const cacheKey = new Request(url.toString(), request);
    const cached = await caches.default.match(cacheKey);
    if (cached) return withCors(cached);

    try {
      const dashboard = await buildDashboard(query, env, url.searchParams.get('inventory') === '1');
      const result = response(dashboard, 200, { 'Cache-Control': `public, max-age=${CACHE_SECONDS}` });
      ctx.waitUntil(caches.default.put(cacheKey, result.clone()));
      return result;
    } catch (error) {
      console.error(JSON.stringify({ name: error?.name, code: error?.code, message: error?.message }));
      const status = error instanceof ApiError ? error.status : 502;
      return response({
        error: {
          code: error instanceof ApiError ? error.code : 'upstream_unavailable',
          message: userMessage(error)
        }
      }, status);
    }
  }
};

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function buildDashboard(query, env, includeInventory) {
  const steamKey = requireSecret(env.STEAM_API_KEY, 'STEAM_API_KEY');
  const faceitKey = requireSecret(env.FACEIT_API_KEY, 'FACEIT_API_KEY');
  let steamId = null;
  let faceitPlayer = null;

  if (query.kind === 'faceit-nickname') {
    faceitPlayer = await faceit(`/players?nickname=${encodeURIComponent(query.nickname)}`, faceitKey);
    steamId = playerSteamId(faceitPlayer);
  } else if (query.kind === 'ambiguous-nickname') {
    faceitPlayer = await findFaceitByNickname(query.nickname, faceitKey);
    steamId = playerSteamId(faceitPlayer);
    if (!steamId) steamId = await resolveVanity(query.nickname, steamKey);
  } else {
    steamId = query.kind === 'steam-id' ? query.steamId : await resolveVanity(query.vanity, steamKey);
  }

  if (!steamId && !faceitPlayer) {
    throw new ApiError(404, 'player_not_found', 'Профиль не найден или не связан с CS2 / FACEIT.');
  }

  if (!faceitPlayer && steamId) {
    faceitPlayer = await findFaceitBySteamId(steamId, faceitKey);
  }

  const [steamProfileResult, playtimeResult, faceitStatsResult, recentResult, inventoryResult] = await Promise.allSettled([
    steamId ? steamPlayer(steamId, steamKey) : Promise.resolve(null),
    steamId ? steamPlaytime(steamId, steamKey) : Promise.resolve(null),
    faceitPlayer ? faceit(`/players/${faceitPlayer.player_id}/stats/${gameId(env)}`, faceitKey) : Promise.resolve(null),
    faceitPlayer ? faceit(`/players/${faceitPlayer.player_id}/games/${gameId(env)}/stats?limit=20`, faceitKey) : Promise.resolve(null),
    includeInventory && steamId ? steamInventory(steamId) : Promise.resolve(null)
  ]);

  const steamProfile = settledValue(steamProfileResult);
  const playtimeMinutes = settledValue(playtimeResult);
  const normalizedFaceit = faceitPlayer
    ? normalizeFaceit(faceitPlayer, settledValue(faceitStatsResult), settledValue(recentResult))
    : null;
  const inventory = settledValue(inventoryResult);
  const notices = [
    ...upstreamNotices({ steamProfileResult, playtimeResult, faceitStatsResult, recentResult, inventoryResult }, Boolean(faceitPlayer), includeInventory),
    ...(faceitPlayer ? [] : [{ level: 'info', code: 'faceit_not_linked', message: 'FACEIT-профиль не найден: подробная история матчей недоступна.' }])
  ];

  return {
    queriedAt: new Date().toISOString(),
    queryType: query.kind,
    profile: {
      steamId: steamId ?? normalizedFaceit?.steamId ?? null,
      name: steamProfile?.personaname ?? normalizedFaceit?.nickname ?? 'Игрок CS2',
      avatar: steamProfile?.avatarfull ?? normalizedFaceit?.avatar ?? null,
      profileUrl: steamProfile?.profileurl ?? null,
      country: steamProfile?.loccountrycode ?? normalizedFaceit?.country ?? null,
      visibility: steamProfile ? 'public' : 'limited'
    },
    steam: {
      playtimeMinutes: playtimeMinutes ?? null,
      inventory: inventory ?? null
    },
    faceit: normalizedFaceit,
    notices,
    sources: {
      steam: 'Steam Web API и публичный Steam Community Inventory',
      faceit: 'FACEIT Data API',
      limitation: 'Статистика матчей отражает только матчи FACEIT. Valve не публикует историю матчей Premier для произвольных профилей.'
    }
  };
}

function gameId(env) {
  return env.FACEIT_GAME_ID || 'cs2';
}

function requireSecret(value, variable) {
  if (!value) throw new ApiError(503, 'service_not_configured', `Сервер не настроен: отсутствует ${variable}.`);
  return value;
}

async function resolveVanity(vanity, steamKey) {
  const data = await steam(`/ISteamUser/ResolveVanityURL/v1/?key=${encodeURIComponent(steamKey)}&vanityurl=${encodeURIComponent(vanity)}`);
  if (data?.response?.success !== 1 || !data?.response?.steamid) {
    throw new ApiError(404, 'player_not_found', 'Steam-профиль с таким адресом не найден.');
  }
  return data.response.steamid;
}

async function steamPlayer(steamId, steamKey) {
  const data = await steam(`/ISteamUser/GetPlayerSummaries/v2/?key=${encodeURIComponent(steamKey)}&steamids=${encodeURIComponent(steamId)}`);
  return data?.response?.players?.[0] ?? null;
}

async function steamPlaytime(steamId, steamKey) {
  const data = await steam(`/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(steamKey)}&steamid=${encodeURIComponent(steamId)}&include_appinfo=false&include_played_free_games=true&appids_filter[0]=730`);
  return data?.response?.games?.[0]?.playtime_forever ?? null;
}

async function steamInventory(steamId) {
  const data = await fetchJson(`https://steamcommunity.com/inventory/${encodeURIComponent(steamId)}/730/2?l=english&count=100`, {
    'User-Agent': 'CS2-Competitive-Profile/2.0'
  }, 'Steam Community');
  if (!data?.success) throw new ApiError(403, 'inventory_unavailable', 'Инвентарь закрыт или временно недоступен.');
  return normalizeSteamInventory(data);
}

async function findFaceitBySteamId(steamId, faceitKey) {
  try {
    return await faceit(`/players?game=cs2&game_player_id=${encodeURIComponent(steamId)}`, faceitKey);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

async function findFaceitByNickname(nickname, faceitKey) {
  try {
    return await faceit(`/players?nickname=${encodeURIComponent(nickname)}`, faceitKey);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function playerSteamId(player) {
  return player?.games?.cs2?.game_player_id ?? player?.games?.csgo?.game_player_id ?? null;
}

function steam(path) {
  return fetchJson(`${STEAM_API}${path}`, undefined, 'Steam Web API');
}

function faceit(path, key) {
  return fetchJson(`${FACEIT_API}${path}`, { Authorization: `Bearer ${key}` }, 'FACEIT Data API');
}

async function fetchJson(url, headers, provider) {
  let result;
  try {
    result = await fetch(url, { headers, signal: AbortSignal.timeout(12_000) });
  } catch {
    throw new ApiError(503, 'provider_timeout', `${provider} не ответил вовремя.`);
  }
  if (result.status === 404) throw new ApiError(404, 'player_not_found', 'Игрок не найден у выбранного источника.');
  if (result.status === 401 || result.status === 403) throw new ApiError(502, 'provider_access_denied', `${provider} отклонил запрос или профиль закрыт.`);
  if (result.status === 429) throw new ApiError(429, 'rate_limited', `${provider} временно ограничил количество запросов. Попробуйте чуть позже.`);
  if (!result.ok) throw new ApiError(502, 'provider_error', `${provider} вернул ошибку ${result.status}.`);
  try {
    return await result.json();
  } catch {
    throw new ApiError(502, 'provider_invalid_response', `${provider} вернул некорректный ответ.`);
  }
}

function settledValue(result) {
  return result.status === 'fulfilled' ? result.value : null;
}

function upstreamNotices(results, hasFaceit, requestedInventory) {
  const notices = [];
  if (results.steamProfileResult.status === 'rejected' || results.playtimeResult.status === 'rejected') {
    notices.push({ level: 'warning', code: 'steam_limited', message: 'Часть данных Steam скрыта настройками приватности или временно недоступна.' });
  }
  if (hasFaceit && (results.faceitStatsResult.status === 'rejected' || results.recentResult.status === 'rejected')) {
    notices.push({ level: 'warning', code: 'faceit_limited', message: 'FACEIT-профиль найден, но часть статистики или истории сейчас недоступна.' });
  }
  if (requestedInventory && results.inventoryResult.status === 'rejected') {
    notices.push({ level: 'info', code: 'inventory_unavailable', message: 'Инвентарь не показан: он закрыт, пуст или временно недоступен.' });
  }
  return notices;
}

function userMessage(error) {
  if (error instanceof ApiError) return error.message;
  return 'Не удалось получить данные. Повторите попытку через несколько секунд.';
}

function response(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
      ...extraHeaders
    }
  });
}

function withCors(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders())) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  };
}
