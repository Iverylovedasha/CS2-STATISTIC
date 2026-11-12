const STEAM_ID_64 = /^7656119\d{10}$/;
const VANITY = /^[a-zA-Z0-9_-]{2,64}$/;

export function parsePlayerQuery(input) {
  const value = String(input ?? '').trim();
  if (!value) return { kind: 'invalid', reason: 'Введите Steam ID, ссылку на профиль или никнейм FACEIT.' };
  if (value.length > 300) return { kind: 'invalid', reason: 'Слишком длинный поисковый запрос.' };

  if (STEAM_ID_64.test(value)) return { kind: 'steam-id', steamId: value };

  const urlValue = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(urlValue);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

    if (host === 'steamcommunity.com' && segments.length >= 2) {
      if (segments[0] === 'profiles' && STEAM_ID_64.test(segments[1])) {
        return { kind: 'steam-id', steamId: segments[1] };
      }
      if (segments[0] === 'id' && VANITY.test(segments[1])) {
        return { kind: 'steam-vanity', vanity: segments[1] };
      }
    }

    if ((host === 'faceit.com' || host.endsWith('.faceit.com')) && segments.length >= 2) {
      const marker = segments.findIndex((segment) => segment.toLowerCase() === 'players');
      if (marker >= 0 && VANITY.test(segments[marker + 1] ?? '')) {
        return { kind: 'faceit-nickname', nickname: segments[marker + 1] };
      }
    }
  } catch {
    // A bare nickname is handled below. Other malformed URLs get a clear error.
  }

  if (VANITY.test(value)) return { kind: 'ambiguous-nickname', nickname: value };
  return { kind: 'invalid', reason: 'Поддерживаются Steam ID64, ссылки Steam / FACEIT и никнеймы без пробелов.' };
}

export function numberFrom(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  if (!normalized || normalized === '-' || normalized === '.') return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function pickMetric(metrics = {}, names = []) {
  for (const name of names) {
    if (metrics[name] !== undefined && metrics[name] !== null) return numberFrom(metrics[name]);
  }
  const desired = new Set(names.map((name) => name.toLowerCase().replace(/[^a-z0-9]/g, '')));
  for (const [key, value] of Object.entries(metrics)) {
    if (desired.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) return numberFrom(value);
  }
  return null;
}

export function normalizeFaceit(player, statistics, matchStatistics) {
  const lifetime = statistics?.lifetime ?? {};
  const matches = pickMetric(lifetime, ['Matches', 'Total Matches']);
  const wins = pickMetric(lifetime, ['Wins', 'Total Wins']);
  const losses = matches !== null && wins !== null ? Math.max(matches - wins, 0) : null;
  const kills = pickMetric(lifetime, ['Kills', 'Total Kills']);
  const deaths = pickMetric(lifetime, ['Deaths', 'Total Deaths']);
  const suppliedKd = pickMetric(lifetime, ['K/D Ratio', 'Average K/D Ratio', 'KD Ratio']);
  const suppliedWinRate = pickMetric(lifetime, ['Win Rate %', 'Win Rate', 'Winrate']);
  const game = player?.games?.cs2 ?? player?.games?.csgo ?? {};

  return {
    id: player?.player_id ?? null,
    nickname: player?.nickname ?? null,
    avatar: player?.avatar ?? null,
    country: player?.country ?? null,
    steamId: game?.game_player_id ?? null,
    elo: numberFrom(game?.faceit_elo),
    level: numberFrom(game?.skill_level),
    summary: {
      matches,
      wins,
      losses,
      kills,
      deaths,
      kd: suppliedKd ?? (kills !== null && deaths ? Math.round((kills / deaths) * 100) / 100 : null),
      winRate: suppliedWinRate ?? (matches && wins !== null ? Math.round((wins / matches) * 1000) / 10 : null),
      headshots: pickMetric(lifetime, ['Headshots %', 'Headshots']),
      longestWinStreak: pickMetric(lifetime, ['Longest Win Streak']),
      averageKills: pickMetric(lifetime, ['Average Kills']),
      averageDeaths: pickMetric(lifetime, ['Average Deaths'])
    },
    matches: (matchStatistics?.items ?? []).slice(0, 20).map(normalizeMatch)
  };
}

function normalizeMatch(match) {
  const stats = match?.stats ?? {};
  const result = String(stats.Result ?? stats.result ?? '').toLowerCase();
  const map = stats.Map ?? stats.map ?? 'Неизвестная карта';
  const score = stats['Score'] ?? stats.Score ?? null;
  return {
    id: match?.match_id ?? match?.matchId ?? null,
    finishedAt: stats['Match Finished At'] ?? stats.finished_at ?? match?.finished_at ?? null,
    map: typeof map === 'string' ? map.replace(/^de_/, '') : 'Неизвестная карта',
    result: result.includes('win') || result === '1' ? 'win' : result.includes('loss') || result === '0' ? 'loss' : 'unknown',
    score: typeof score === 'string' || typeof score === 'number' ? String(score) : null,
    kills: pickMetric(stats, ['Kills']),
    deaths: pickMetric(stats, ['Deaths']),
    assists: pickMetric(stats, ['Assists']),
    kd: pickMetric(stats, ['K/D Ratio', 'K/D']),
    headshots: pickMetric(stats, ['Headshots %', 'Headshots']),
    adr: pickMetric(stats, ['ADR', 'Average Damage per Round'])
  };
}

export function normalizeSteamInventory(payload, limit = 100) {
  const descriptions = new Map(
    (payload?.descriptions ?? []).map((description) => [
      `${description.classid}_${description.instanceid}`,
      description
    ])
  );
  const assets = payload?.assets ?? [];
  return {
    total: numberFrom(payload?.total_inventory_count) ?? assets.length,
    items: assets.slice(0, limit).flatMap((asset) => {
      const item = descriptions.get(`${asset.classid}_${asset.instanceid}`);
      if (!item) return [];
      return [{
        id: `${asset.classid}_${asset.instanceid}_${asset.assetid}`,
        name: item.market_name ?? item.name ?? 'Предмет без названия',
        type: item.type ?? null,
        rarity: item.tags?.find((tag) => tag.category === 'Rarity')?.localized_tag_name ?? null,
        icon: item.icon_url
          ? `https://community.cloudflare.steamstatic.com/economy/image/${item.icon_url}/150fx150f`
          : null,
        tradable: Boolean(item.tradable)
      }];
    })
  };
}
