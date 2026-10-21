import test from 'node:test';
import assert from 'node:assert/strict';
import { createService } from '../src/services/shared-service.js';
import { STATE_KEYS } from '../src/domain/validation.js';

/** A serializable test store: atomic commits, snapshots, and Firestore's reads-before-writes rule. */
function memoryFirestore() {
  const documents = new Map();
  let pending = Promise.resolve();
  const clone = (value) => value === undefined ? undefined : structuredClone(value);
  const ref = (path) => ({
    path,
    create(value) {
      return database.runTransaction(async (transaction) => transaction.create(ref(path), value));
    },
  });
  const database = {
    doc: ref,
    read: (path) => clone(documents.get(path)),
    entries: () => clone([...documents.entries()]),
    runTransaction(callback) {
      const operation = pending.then(async () => {
        const writes = [];
        const transaction = {
          async get(reference) {
            assert.equal(writes.length, 0, 'Firestore requires every transaction read before writes');
            const value = clone(documents.get(reference.path));
            return { exists: value !== undefined, data: () => clone(value) };
          },
          create: (reference, value) => writes.push(['create', reference.path, clone(value)]),
          set: (reference, value) => writes.push(['set', reference.path, clone(value)]),
          update: (reference, value) => writes.push(['update', reference.path, clone(value)]),
          delete: (reference) => writes.push(['delete', reference.path]),
        };
        const result = await callback(transaction);
        const committed = new Map(documents);
        for (const [kind, path, value] of writes) {
          if (kind === 'create' && committed.has(path)) throw new Error('already-exists');
          if (kind === 'update' && !committed.has(path)) throw new Error('not-found');
          if (kind === 'delete') committed.delete(path);
          else if (kind === 'update') committed.set(path, { ...committed.get(path), ...value });
          else committed.set(path, value);
        }
        documents.clear();
        for (const [path, value] of committed) documents.set(path, value);
        return result;
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
  return database;
}

const request = (data, uid = 'visitor-a') => ({ auth: { uid }, data });
const expectCode = (operation, code) => assert.rejects(operation, (error) => error.code === code);
const stateOf = (game) => Object.fromEntries(STATE_KEYS.filter((key) => game[key] !== undefined).map((key) => [key, structuredClone(game[key])]));
const team = (id) => ({ id, name1: `${id}-1`, name2: `${id}-2`, totalLevel: 8 });
const match = (id) => ({ id, round: 1, team1: team(`${id}-a`), team2: team(`${id}-b`), score1: null, score2: null, isFinished: false });

async function fixture() {
  const db = memoryFirestore();
  let sequence = 0, tokenSequence = 0;
  let nowMs = Date.parse('2026-10-21T00:00:00.000Z');
  const service = createService(db, {
    now: () => new Date(nowMs),
    newId: () => `id-${++sequence}`,
    newToken: () => String(++tokenSequence).padStart(43, 'A'),
  });
  const profile = await service.createProfile(request({ name: 'Shared Club' }));
  const created = await service.createGame(request({ profileId: profile.id, name: 'Practice' }));
  const game = await service.saveGame(request({
    profileId: profile.id, gameId: created.id, expectedRevision: created.revision,
    state: { schedules: [{ id: 1, mode: 'single', matches: [match('match-a'), match('match-b')], restMsg: '' }] },
  }));
  const ids = { profileId: profile.id, gameId: game.id };
  return { db, service, profile, game, ids, advance: (milliseconds) => { nowMs += milliseconds; } };
}

const matchUpdate = (matchId, score1 = 21, score2 = 15) => ({ scheduleId: 1, matchId, score1, score2, isFinished: true });

test('every operation rejects requests without a Firebase authentication session', async () => {
  const { service } = await fixture();
  for (const [name, operation] of Object.entries(service)) {
    await assert.rejects(operation({ data: {} }), (error) => error.code === 'unauthenticated', name);
  }
});

test('data mutations require an existing selected profile', async () => {
  const { service, game } = await fixture();
  await expectCode(service.createGame(request({ profileId: 'missing', name: 'Practice' })), 'not-found');
  await expectCode(service.saveFrequentPlayers(request({ profileId: 'missing', players: [], expectedRevision: 0 })), 'not-found');
  await expectCode(service.saveGame(request({ profileId: 'missing', gameId: game.id, state: {}, expectedRevision: game.revision })), 'not-found');
});

test('other accounts cannot mutate a profile or its data', async () => {
  const { service, game, ids } = await fixture();
  for (const [name, data] of [
    ['saveGame', { ...ids, state: stateOf(game), expectedRevision: game.revision }],
    ['createGame', { profileId: ids.profileId, name: 'Forbidden' }],
    ['saveFrequentPlayers', { profileId: ids.profileId, players: [], expectedRevision: 0 }],
    ['archiveGame', ids],
    ['saveMatchScore', { ...ids, ...matchUpdate('match-a') }],
  ]) await expectCode(service[name](request(data, 'visitor-b')), 'permission-denied');
});

test('stale whole-game and roster writes reject without changing current data', async () => {
  const { db, service, game, ids } = await fixture();
  await service.saveGame(request({ ...ids, state: stateOf(game), expectedRevision: game.revision }));
  await expectCode(service.saveGame(request({ ...ids, state: {}, expectedRevision: game.revision })), 'aborted');
  assert.equal(db.read(`profiles/${ids.profileId}/games/${ids.gameId}`).schedules[0].matches.length, 2);
  await service.saveFrequentPlayers(request({ profileId: ids.profileId, players: [], expectedRevision: 0 }));
  await expectCode(service.saveFrequentPlayers(request({ profileId: ids.profileId, players: [], expectedRevision: 0 })), 'aborted');
});

test('concurrent score submissions keep both matches and invalidate stale whole-game saves', async () => {
  const { db, service, game, ids } = await fixture();
  await Promise.all([
    service.saveMatchScore(request({ ...ids, ...matchUpdate('match-a', 21, 10) }, 'visitor-a')),
    service.saveMatchScore(request({ ...ids, ...matchUpdate('match-b', 18, 21) }, 'visitor-a')),
  ]);
  const saved = db.read(`profiles/${ids.profileId}/games/${ids.gameId}`);
  assert.equal(saved.schedules[0].matches[0].score1, 21);
  assert.equal(saved.schedules[0].matches[0].score2, 10);
  assert.equal(saved.schedules[0].matches[1].score1, 18);
  assert.equal(saved.schedules[0].matches[1].score2, 21);
  assert.equal(saved.revision, game.revision + 2);
  await expectCode(service.saveGame(request({ ...ids, state: stateOf(game), expectedRevision: game.revision })), 'aborted');
  assert.equal(db.read(`profiles/${ids.profileId}/games/${ids.gameId}`).schedules[0].matches[1].score2, 21);
});

test('public scoring capabilities are no longer accepted', async () => {
  const { service, ids } = await fixture();
  assert.equal(service.createShare, undefined);
  await expectCode(service.saveMatchScore(request({ ...ids, token: 'old-token', ...matchUpdate('match-a') })), 'permission-denied');
});

test('archiving a game preserves its data and invalidates both writes and sharing', async () => {
  const { db, service, game, ids } = await fixture();
  await service.archiveGame(request(ids));
  const stored = db.read(`profiles/${ids.profileId}/games/${ids.gameId}`);
  assert.ok(stored.deletedAt instanceof Date);
  assert.equal(stored.schedules[0].matches.length, 2);
  await expectCode(service.saveGame(request({ ...ids, state: stateOf(game), expectedRevision: stored.revision })), 'not-found');
  await expectCode(service.saveMatchScore(request({ ...ids, ...matchUpdate('match-a') })), 'not-found');
});

test('invalid profile IDs and share token formats cannot address unrelated documents', async () => {
  const { service, ids } = await fixture();
  for (const profileId of ['../other', 'profiles/other', '..', '']) {
    await expectCode(service.createGame(request({ profileId, name: 'Practice' })), 'invalid-argument');
  }
  await expectCode(service.saveMatchScore(request({ ...ids, token: 'bad', ...matchUpdate('match-a') })), 'permission-denied');
});
