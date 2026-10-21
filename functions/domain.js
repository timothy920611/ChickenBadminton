/** Shared server-side validation and match operations. No browser-supplied identity is trusted. */
export class DomainError extends Error {
  constructor(code, message) { super(message); this.name = 'DomainError'; this.code = code; }
}
const invalid = message => { throw new DomainError('invalid-argument', message); };
const modes = ['single', 'round-robin', 'single-elimination'];
export const STATE_KEYS = [
  'players', 'currentTeams', 'schedules', 'matchMode', 'pendingRestMsg', 'needsInitialSchedule',
  'savedTeamDraft', 'savedDraftMode', 'savedDraftRestMsg', 'savedDraftRestPlayer', 'savedDraftUpdatedAt', 'lastUpdated'
];
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} 必須是物件。`);
  return value;
}
function keysOnly(value, keys, label) {
  object(value, label);
  if (Object.keys(value).some(key => !keys.includes(key))) invalid(`${label} 包含不支援的欄位。`);
}
export function text(value, label, max, allowEmpty = false) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) invalid(`${label} 長度不正確。`);
  return value.trim();
}
export function identifier(value, label = 'ID') {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) return value;
  if (typeof value !== 'string' || !/^[A-Za-z0-9_.-]{1,100}$/.test(value)) invalid(`${label} 格式不正確。`);
  return value;
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid(`${label} 超出範圍。`);
  return value;
}
function boolean(value, label) {
  if (typeof value !== 'boolean') invalid(`${label} 必須是布林值。`);
  return value;
}
function list(value, max, label) {
  if (!Array.isArray(value) || value.length > max) invalid(`${label} 數量超過上限 ${max}。`);
  return value;
}
function uniqueIds(items, label) {
  if (new Set(items.map(item => String(item.id))).size !== items.length) invalid(`${label} ID 重複。`);
  return items;
}
function player(value) {
  keysOnly(value, ['id', 'name', 'gender', 'level'], '球員');
  if (!['男', '女'].includes(value.gender)) invalid('球員性別不正確。');
  return { id: identifier(value.id), name: text(value.name, '球員名稱', 80), gender: value.gender, level: integer(value.level, 1, 18, '球員等級') };
}
export function validatePlayers(value, { max = 20 } = {}) {
  return uniqueIds(list(value, max, '球員').map(player), '球員');
}
function team(value) {
  if (value === null) return null;
  keysOnly(value, ['id', 'name1', 'name2', 'totalLevel'], '隊伍');
  return { id: identifier(value.id), name1: text(value.name1, '隊員名稱', 80), name2: text(value.name2, '隊員名稱', 80), totalLevel: integer(value.totalLevel, 0, 36, '隊伍等級') };
}
function score(value) { return value === null ? null : integer(value, 0, 999, '比分'); }
function match(value) {
  keysOnly(value, ['id', 'round', 'matchNumber', 'team1', 'team2', 'score1', 'score2', 'isFinished', 'nextMatchId', 'slotInNext'], '場次');
  const result = {
    id: identifier(value.id), round: integer(value.round, 1, 1000, '輪次'),
    team1: team(value.team1), team2: team(value.team2),
    score1: score(value.score1 ?? null), score2: score(value.score2 ?? null),
    isFinished: boolean(value.isFinished ?? false, '完成狀態')
  };
  if (value.matchNumber !== undefined) result.matchNumber = integer(value.matchNumber, 1, 1000, '場次序號');
  if (value.nextMatchId != null) {
    result.nextMatchId = identifier(value.nextMatchId);
    if (!['team1', 'team2'].includes(value.slotInNext)) invalid('下一輪位置不正確。');
    result.slotInNext = value.slotInNext;
  } else if (value.slotInNext != null) invalid('下一輪連結不完整。');
  if (result.isFinished && (!result.team1 || !result.team2 || result.score1 === null || result.score2 === null)) invalid('完成的場次必須有兩隊與完整比分。');
  return result;
}
function schedule(value) {
  keysOnly(value, ['id', 'mode', 'matches', 'restMsg'], '賽程');
  if (!modes.includes(value.mode)) invalid('賽程模式不正確。');
  const result = {
    id: integer(value.id, 1, 10000, '賽程 ID'), mode: value.mode,
    matches: uniqueIds(list(value.matches, 1000, '場次').map(match), '場次'),
    restMsg: text(value.restMsg ?? '', '休息說明', 4000, true)
  };
  const byId = new Map(result.matches.map(item => [String(item.id), item]));
  const occupied = new Set();
  for (const item of result.matches) {
    if (item.nextMatchId != null) {
      const next = byId.get(String(item.nextMatchId));
      if (result.mode !== 'single-elimination' || !next || next.round !== item.round + 1) invalid('淘汰賽連結不正確。');
      const slot = `${item.nextMatchId}:${item.slotInNext}`;
      if (occupied.has(slot)) invalid('淘汰賽晉級位置重複。');
      occupied.add(slot);
    }
    if (result.mode === 'single-elimination' && item.isFinished && item.score1 === item.score2) invalid('單敗淘汰賽不能平手。');
  }
  if (result.mode === 'single-elimination') recomputeBracket(result);
  return result;
}
function isoDate(value, label) {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 40 || !Number.isFinite(Date.parse(value))) invalid(`${label} 日期不正確。`);
  return new Date(value).toISOString();
}
function draft(value) {
  keysOnly(value, ['id', 'p1', 'p2', 'mode'], '分組草稿');
  if (value.mode !== undefined && !modes.includes(value.mode)) invalid('草稿模式不正確。');
  const result = { id: identifier(value.id), p1: value.p1 == null ? null : player(value.p1), p2: value.p2 == null ? null : player(value.p2) };
  if (value.mode !== undefined) result.mode = value.mode;
  return result;
}
export function validateState(value) {
  keysOnly(value, STATE_KEYS, '比賽資料');
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 700000) invalid('比賽資料過大，請建立另一個比賽。');
  const result = {
    players: validatePlayers(value.players ?? []),
    currentTeams: uniqueIds(list(value.currentTeams ?? [], 20, '隊伍').map(item => { if (item == null) invalid('隊伍不可為空。'); return team(item); }), '隊伍'),
    schedules: uniqueIds(list(value.schedules ?? [], 100, '賽程').map(schedule), '賽程'),
    matchMode: value.matchMode ?? 'single',
    pendingRestMsg: text(value.pendingRestMsg ?? '', '休息說明', 4000, true),
    needsInitialSchedule: boolean(value.needsInitialSchedule ?? false, '初始賽程狀態'),
    savedTeamDraft: uniqueIds(list(value.savedTeamDraft ?? [], 20, '草稿隊伍').map(draft), '草稿隊伍'),
    savedDraftMode: value.savedDraftMode ?? '',
    savedDraftRestMsg: text(value.savedDraftRestMsg ?? '', '草稿休息說明', 4000, true),
    savedDraftRestPlayer: value.savedDraftRestPlayer == null ? null : player(value.savedDraftRestPlayer),
    savedDraftUpdatedAt: isoDate(value.savedDraftUpdatedAt ?? null, '草稿更新時間')
  };
  if (!modes.includes(result.matchMode) || !['', ...modes].includes(result.savedDraftMode)) invalid('比賽模式不正確。');
  if (result.schedules.reduce((sum, item) => sum + item.matches.length, 0) > 2000) invalid('場次總數超過上限 2000。');
  // lastUpdated is always generated by the server; accept legacy client input only to validate its shape.
  if (value.lastUpdated != null) isoDate(value.lastUpdated, '更新時間');
  return result;
}
export function assertRevision(expected, actual) {
  integer(expected, 0, Number.MAX_SAFE_INTEGER, '資料版本');
  if (expected !== actual) throw new DomainError('aborted', '資料已由另一個視窗更新。請重新載入後再操作。');
}
export function assertShareActive(share, nowMs = Date.now()) {
  const expiry = share?.expiresAt?.toMillis?.() ?? (share?.expiresAt instanceof Date ? share.expiresAt.getTime() : Date.parse(share?.expiresAt));
  if (!share || share.revoked || !Number.isFinite(expiry) || expiry <= nowMs) throw new DomainError('permission-denied', '分享連結已失效，請向主辦人取得新連結。');
}
function teamKey(value) { return value ? `${value.id}:${value.name1}:${value.name2}` : ''; }
/** Resolve byes only when all upstream matches are resolved, never while a feeder is still playing. */
export function recomputeBracket(schedule) {
  if (schedule.mode !== 'single-elimination') return schedule;
  const ordered = [...schedule.matches].sort((a, b) => a.round - b.round);
  const outcomes = new Map();
  for (const item of ordered) {
    const feeders = ordered.filter(candidate => String(candidate.nextMatchId) === String(item.id));
    for (const feeder of feeders) {
      const outcome = outcomes.get(String(feeder.id));
      const winner = outcome?.resolved ? outcome.winner : null;
      if (teamKey(item[feeder.slotInNext]) !== teamKey(winner)) {
        item[feeder.slotInNext] = winner ? { ...winner } : null;
        item.score1 = null; item.score2 = null; item.isFinished = false;
      }
    }
    const ready = feeders.every(feeder => outcomes.get(String(feeder.id))?.resolved);
    let resolved = false, winner = null;
    if (ready && item.team1 && item.team2 && item.isFinished && item.score1 !== item.score2) {
      resolved = true; winner = item.score1 > item.score2 ? item.team1 : item.team2;
    } else if (ready && (!item.team1 || !item.team2)) {
      // Empty initial slots represent actual byes; an unresolved feeder is never a bye.
      resolved = true; winner = item.team1 || item.team2 || null;
    }
    outcomes.set(String(item.id), { resolved, winner });
  }
  return schedule;
}
export function applyMatchScore(game, update) {
  const result = structuredClone(game);
  const targetSchedule = result.schedules.find(item => String(item.id) === String(update.scheduleId));
  const target = targetSchedule?.matches.find(item => String(item.id) === String(update.matchId));
  if (!target || !target.team1 || !target.team2) throw new DomainError('failed-precondition', '場次不存在或隊伍尚未確定。');
  const finished = boolean(update.isFinished, '完成狀態');
  const score1 = score(update.score1), score2 = score(update.score2);
  if ((score1 === null) !== (score2 === null) || (finished && score1 === null)) invalid('請輸入完整比分。');
  if (finished && targetSchedule.mode === 'single-elimination' && score1 === score2) invalid('單敗淘汰賽不能平手。');
  target.score1 = score1; target.score2 = score2; target.isFinished = finished;
  recomputeBracket(targetSchedule);
  return result;
}
export function toPublic(value) {
  if (value === null || value === undefined) return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(toPublic);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toPublic(child)]));
  return value;
}
export function sharedGame(game) {
  const { id, name, schedules, matchMode, revision, lastUpdated } = game;
  return toPublic({ id, name, schedules, matchMode, revision, lastUpdated });
}
