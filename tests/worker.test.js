import test from 'node:test';
import assert from 'node:assert/strict';

const cache = new Map();
globalThis.caches = {
  default: {
    async match(request) { return cache.get(request.url)?.clone() ?? undefined; },
    async put(request, response) { cache.set(request.url, response.clone()); }
  }
};

const { default: worker } = await import('../api/src/index.js');

test('returns a unified dashboard without exposing provider keys', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const target = String(url);
    if (target.includes('GetPlayerSummaries')) return json({ response: { players: [{ personaname: 'TestPlayer', profileurl: 'https://steamcommunity.com/profiles/76561198000000000/', avatarfull: 'https://avatars.example/player.jpg' }] } });
    if (target.includes('GetOwnedGames')) return json({ response: { games: [{ playtime_forever: 1234 }] } });
    if (target.includes('open.faceit.com') && target.includes('game_player_id')) return json({ player_id: 'faceit-player', nickname: 'faceit-player', games: { cs2: { game_player_id: '76561198000000000', skill_level: 7, faceit_elo: 1600 } } });
    if (target.includes('/stats/cs2')) return json({ lifetime: { Matches: '12', Wins: '9', Kills: '200', Deaths: '150' } });
    if (target.includes('/games/cs2/stats')) return json({ items: [{ stats: { Map: 'de_mirage', Result: '1', Kills: '20', Deaths: '15', Assists: '5' } }] });
    throw new Error(`Unexpected URL: ${target}`);
  };

  try {
    const response = await worker.fetch(
      new Request('https://api.example/v1/profile?query=76561198000000000'),
      { STEAM_API_KEY: 'steam-secret', FACEIT_API_KEY: 'faceit-secret' },
      { waitUntil() {} }
    );
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.profile.name, 'TestPlayer');
    assert.equal(body.steam.playtimeMinutes, 1234);
    assert.equal(body.faceit.summary.kd, 1.33);
    assert.equal(body.faceit.matches[0].map, 'mirage');
    assert.equal(JSON.stringify(body).includes('steam-secret'), false);
    assert.equal(JSON.stringify(body).includes('faceit-secret'), false);
  } finally {
    globalThis.fetch = originalFetch;
    cache.clear();
  }
});

function json(value) {
  return new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
}
