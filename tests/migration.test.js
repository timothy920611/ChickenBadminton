import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalizeLegacyGame, planMigration, writeMigration, parseArgs } from '../scripts/migrate-legacy.mjs';

test('migration defaults to dry-run and requires an explicit project before writes', () => {
  assert.equal(parseArgs(['--source', 'json', '--map', 'map.json']).write, false);
  assert.throws(() => parseArgs(['--source', 'json', '--map', 'map.json', '--write']));
  assert.throws(() => parseArgs(['--source', 'json', '--map', 'map.json', '--unknown']));
});
test('legacy normalization preserves scores, teams and resting information', () => {
  const a = { id: 'a', name1: 'A', name2: 'B', totalLevel: 10 };
  const b = { id: 'b', name1: 'C', name2: 'D', totalLevel: 12 };
  const state = normalizeLegacyGame({ players: [], restingInfo: 'rest', matches: [{ id: 'm', round: 1,
    team1: a, team2: b, score1: 21, score2: 15, isFinished: true }] });
  assert.equal(state.currentTeams.length, 2);
  assert.equal(state.schedules[0].matches[0].score1, 21);
  assert.equal(state.schedules[0].restMsg, 'rest');
  assert.equal(state.pendingRestMsg, 'rest');
});
test('planning reads indexed games only, retains empty indexed games, and rejects path traversal', async t => {
  const root = await mkdtemp(join(tmpdir(), 'badminton-migration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'legacy'));
  await writeFile(join(root, 'legacy', 'games_index.json'), JSON.stringify([{ id: 'one', name: 'Game' }]));
  await writeFile(join(root, 'legacy', 'game_orphan.json'), 'invalid JSON never opened');
  const plan = await planMigration(root, { legacy: 'profile' });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].path, 'profiles/profile/games/one');
  await assert.rejects(planMigration(root, { '../legacy': 'profile' }));
});
test('migration skips existing destinations and requires the profile to exist', async () => {
  const store = new Map([['profiles/p', {}], ['profiles/p/games/old', { revision: 8 }]]);
  const db = { doc: path => path, async runTransaction(run) {
    return run({ get: async path => ({ exists: store.has(path) }), create: (path, data) => store.set(path, data) });
  } };
  const results = await writeMigration([
    { profileId: 'p', path: 'profiles/p/games/old', data: { revision: 1 } },
    { profileId: 'p', path: 'profiles/p/games/new', data: { revision: 1 } },
  ], db);
  assert.deepEqual(results, { created: 1, skipped: 1 });
  assert.equal(store.get('profiles/p/games/old').revision, 8);
  await assert.rejects(writeMigration([{ profileId: 'missing', path: 'profiles/missing/games/new', data: {} }], db));
});
