import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFaceit, normalizeSteamInventory, parsePlayerQuery } from '../api/src/normalize.js';

test('recognises supported profile queries', () => {
  assert.deepEqual(parsePlayerQuery('76561198000000000'), { kind: 'steam-id', steamId: '76561198000000000' });
  assert.deepEqual(parsePlayerQuery('https://steamcommunity.com/id/example_user/'), { kind: 'steam-vanity', vanity: 'example_user' });
  assert.deepEqual(parsePlayerQuery('https://www.faceit.com/en/players/example-user'), { kind: 'faceit-nickname', nickname: 'example-user' });
});

test('normalises FACEIT lifetime metrics without trusting a fixed response order', () => {
  const result = normalizeFaceit(
    { player_id: 'p1', nickname: 'player', games: { cs2: { skill_level: 8, faceit_elo: 1850, game_player_id: '76561198000000000' } } },
    { lifetime: { Matches: '40', Wins: '25', Kills: '700', Deaths: '500' } },
    { items: [] }
  );
  assert.equal(result.summary.winRate, 62.5);
  assert.equal(result.summary.kd, 1.4);
  assert.equal(result.summary.losses, 15);
  assert.equal(result.level, 8);
});

test('maps Steam descriptions to assets and enforces the visible item limit', () => {
  const result = normalizeSteamInventory({
    total_inventory_count: 7,
    assets: [{ classid: '1', instanceid: '0', assetid: 'a1' }],
    descriptions: [{ classid: '1', instanceid: '0', name: 'AK-47', type: 'Rifle', icon_url: 'abc' }]
  });
  assert.equal(result.total, 7);
  assert.equal(result.items[0].name, 'AK-47');
  assert.match(result.items[0].icon, /steamstatic/);
});
