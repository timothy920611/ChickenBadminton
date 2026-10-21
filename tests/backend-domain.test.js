import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyMatchScore,
  assertRevision,
  assertShareActive,
  recomputeBracket,
  validatePlayers,
  validateState,
} from '../functions/domain.js';

const team = (id) => ({ id, name1: `${id}-1`, name2: `${id}-2`, totalLevel: 8 });
const match = (id, round, team1, team2, overrides = {}) => ({
  id, round, matchNumber: 1, team1, team2, score1: null, score2: null, isFinished: false, ...overrides,
});
const player = (id = 1) => ({ id, name: 'Player', gender: '男', level: 4 });
const fails = (action, code = 'invalid-argument') => assert.throws(action, (error) => error.code === code);

function knockout() {
  return {
    id: 1,
    mode: 'single-elimination',
    restMsg: '',
    matches: [
      match('semi-a', 1, team('a'), team('b'), { nextMatchId: 'final', slotInNext: 'team1' }),
      match('semi-b', 1, team('c'), team('d'), { nextMatchId: 'final', slotInNext: 'team2' }),
      match('final', 2, null, null),
    ],
  };
}

function game(schedules = [knockout()]) {
  return { id: 'game-1', name: 'Practice', revision: 1, players: [player()], schedules, currentTeams: [], matchMode: 'single-elimination' };
}

function score(gameData, matchId, score1, score2, isFinished = true) {
  return applyMatchScore(gameData, { scheduleId: 1, matchId, score1, score2, isFinished });
}

test('state validation rejects schema injection and invalid nested data', () => {
  fails(() => validateState({ role: 'admin' }));
  fails(() => validateState({ ownerId: 'another-user' }));
  fails(() => validateState({ players: [player(), { ...player(2), level: 19 }] }));
  fails(() => validateState({ players: [{ ...player(), name: 'x'.repeat(1000) }] }));
  fails(() => validateState({ matchMode: 'unknown' }));
  fails(() => validateState({ schedules: [{ ...knockout(), unexpected: true }] }));
  fails(() => validateState({ schedules: [{ ...knockout(), matches: [{ ...knockout().matches[0], score1: -1 }] }] }));
});

test('player validation accepts legacy numeric and string IDs, but rejects malformed rosters', () => {
  assert.equal(validatePlayers([player(), player('p2')]).length, 2);
  fails(() => validatePlayers(Array.from({ length: 21 }, (_, i) => player(i + 1))));
  fails(() => validatePlayers([player(), player()]));
  fails(() => validatePlayers([{ ...player(), level: 4.5 }]));
  fails(() => validatePlayers([{ ...player(), gender: 'invalid' }]));
  fails(() => validatePlayers([{ ...player(), admin: true }]));
});

test('saved team drafts survive validation with their players and rest metadata', () => {
  const input = {
    players: [player(1), player(2), player(3)],
    savedTeamDraft: [{ id: 'draft-1', p1: player(1), p2: player(2) }],
    savedDraftMode: 'round-robin',
    savedDraftRestMsg: 'One player rests',
    savedDraftRestPlayer: player(3),
    savedDraftUpdatedAt: '2026-10-21T00:00:00.000Z',
  };
  const result = validateState(input);
  assert.deepEqual(result.savedTeamDraft, input.savedTeamDraft);
  assert.deepEqual(result.savedDraftRestPlayer, input.savedDraftRestPlayer);
  assert.equal(result.savedDraftMode, 'round-robin');
});

test('whole-game saves require the exact current revision', () => {
  assert.doesNotThrow(() => assertRevision(4, 4));
  fails(() => assertRevision(3, 4), 'aborted');
  fails(() => assertRevision(5, 4), 'aborted');
  fails(() => assertRevision(undefined, 4));
});

test('sharing expires at the deadline and missing or revoked links never authorize access', () => {
  const now = Date.parse('2026-10-21T00:00:00.000Z');
  assert.doesNotThrow(() => assertShareActive({ expiresAt: new Date(now + 1) }, now));
  assert.throws(() => assertShareActive({ expiresAt: new Date(now) }, now));
  assert.throws(() => assertShareActive({ expiresAt: new Date(now - 1) }, now));
  assert.throws(() => assertShareActive(null, now));
  assert.throws(() => assertShareActive({ expiresAt: 'invalid' }, now));
  assert.throws(() => assertShareActive({ expiresAt: new Date(now + 10000), revoked: true }, now));
});

test('scoring applies to the selected match and leaves input state untouched', () => {
  const initial = game();
  const before = structuredClone(initial);
  const result = score(initial, 'semi-a', 21, 15);
  assert.deepEqual(initial, before);
  assert.equal(result.schedules[0].matches[0].score1, 21);
  assert.equal(result.schedules[0].matches[0].isFinished, true);
  assert.equal(result.schedules[0].matches[2].team1.id, 'a');
  assert.equal(result.schedules[0].matches[2].team2, null);
});

test('subsequent scores start from current state and retain scores of other matches', () => {
  const first = score(game(), 'semi-a', 21, 15);
  const second = score(first, 'semi-b', 19, 21);
  assert.equal(second.schedules[0].matches[0].score1, 21);
  assert.equal(second.schedules[0].matches[1].score2, 21);
  assert.equal(second.schedules[0].matches[2].team1.id, 'a');
  assert.equal(second.schedules[0].matches[2].team2.id, 'd');
});

test('changing the upstream winner clears results that depend on the old participant', () => {
  let result = score(game(), 'semi-a', 21, 15);
  result = score(result, 'semi-b', 19, 21);
  result = score(result, 'final', 21, 18);
  result = score(result, 'semi-a', 15, 21);
  const final = result.schedules[0].matches[2];
  assert.equal(final.team1.id, 'b');
  assert.equal(final.team2.id, 'd');
  assert.equal(final.isFinished, false);
  assert.equal(final.score1, null);
  assert.equal(final.score2, null);
});

test('reopening an upstream match clears its downstream participant and finished result', () => {
  let result = score(game(), 'semi-a', 21, 15);
  result = score(result, 'semi-b', 19, 21);
  result = score(result, 'final', 21, 18);
  result = score(result, 'semi-a', null, null, false);
  const final = result.schedules[0].matches[2];
  assert.equal(final.team1, null);
  assert.equal(final.team2.id, 'd');
  assert.equal(final.isFinished, false);
});

test('unfinished knockout matches may temporarily tie, completed knockout matches cannot', () => {
  assert.doesNotThrow(() => score(game(), 'semi-a', 10, 10, false));
  fails(() => score(game(), 'semi-a', 21, 21));
});

test('scores reject noninteger, negative, unbounded, and partial-null inputs', () => {
  for (const invalid of [-1, 1.5, Infinity, NaN, '21', 1000000]) {
    fails(() => score(game(), 'semi-a', invalid, 0));
  }
  fails(() => score(game(), 'semi-a', null, 1, false));
  fails(() => score(game(), 'semi-a', null, null, true));
  assert.throws(() => score(game(), 'missing', 21, 0));
  assert.throws(() => score(game(), 'final', 21, 0));
});

test('a genuine first-round bye advances, without skipping a pending semifinal opponent', () => {
  const schedule = {
    id: 1, mode: 'single-elimination', restMsg: '',
    matches: [
      match('quarter-a', 1, team('a'), null, { nextMatchId: 'semi-a', slotInNext: 'team1' }),
      match('quarter-b', 1, team('b'), team('c'), { nextMatchId: 'semi-a', slotInNext: 'team2' }),
      match('quarter-c', 1, team('d'), team('e'), { nextMatchId: 'semi-b', slotInNext: 'team1' }),
      match('quarter-d', 1, team('f'), team('g'), { nextMatchId: 'semi-b', slotInNext: 'team2' }),
      match('semi-a', 2, null, null, { nextMatchId: 'final', slotInNext: 'team1' }),
      match('semi-b', 2, null, null, { nextMatchId: 'final', slotInNext: 'team2' }),
      match('final', 3, null, null),
    ],
  };
  recomputeBracket(schedule);
  assert.equal(schedule.matches[4].team1.id, 'a');
  assert.equal(schedule.matches[4].team2, null);
  assert.equal(schedule.matches[6].team1, null, 'a known semifinalist is not a semifinal winner');
  assert.throws(() => score(game([schedule]), 'semi-a', 21, 0));
});
