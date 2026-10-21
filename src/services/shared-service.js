import {
  DomainError, validateState, validatePlayers, text, identifier, assertRevision,
  applyMatchScore, toPublic
} from '../domain/validation.js';

const fail = (code, message) => { throw new DomainError(code, message); };
const pathId = (value, label) => {
  identifier(value, label);
  // 路徑片段不得使用點號跳脫；舊球員 ID 的小數點不會用作路徑。
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail('invalid-argument', `${label} 格式不正確。`);
  return value;
};
const authenticate = request => {
  if (!request.auth?.uid || request.auth.isAnonymous) fail('unauthenticated', '請重新整理頁面，建立連線後再操作。');
  return request.auth.uid;
};
const requireData = request => {
  authenticate(request);
  if (!request.data || typeof request.data !== 'object' || Array.isArray(request.data)) fail('invalid-argument', '請求資料不正確。');
  return request.data;
};
const activeGame = snapshot => {
  if (!snapshot.exists || snapshot.data().deletedAt) fail('not-found', '找不到比賽，或比賽已刪除。');
  return snapshot.data();
};
const requireProfile = snapshot => {
  if (!snapshot.exists) fail('not-found', '使用者不存在，請重新選取。');
  return snapshot.data();
};

/** 個人工作區操作；Firestore Rules 才是瀏覽器寫入的權限邊界。 */
export function createService(db, { now = () => new Date(), newId = () => crypto.randomUUID() } = {}) {
  const profileRef = profileId => db.doc(`profiles/${pathId(profileId, '使用者 ID')}`);
  const gameRef = (profileId, gameId) => db.doc(`profiles/${pathId(profileId, '使用者 ID')}/games/${pathId(gameId, '比賽 ID')}`);
  const rosterRef = profileId => db.doc(`profiles/${pathId(profileId, '使用者 ID')}/settings/frequentPlayers`);
  async function readProfile(transaction, profileId, uid) {
    const profile = requireProfile(await transaction.get(profileRef(profileId)));
    if (profile.ownerUid !== uid) fail('permission-denied', '這份資料不屬於目前登入的帳號。');
    return profile;
  }

  return {
    async createProfile(request) {
      const data = requireData(request);
      const name = text(data.name, '使用者名稱', 80);
      const id = newId();
      const date = now();
      const profile = { id, name, ownerUid: request.auth.uid, createdAt: date, updatedAt: date };
      await profileRef(id).create(profile);
      return toPublic(profile);
    },
    async createGame(request) {
      const data = requireData(request);
      const name = text(data.name, '比賽名稱', 120);
      const id = newId();
      return db.runTransaction(async transaction => {
        await readProfile(transaction, data.profileId, request.auth.uid);
        const date = now();
        const game = { id, name, date: date.toISOString(), ...validateState({}), revision: 1, deletedAt: null, createdAt: date, updatedAt: date, lastUpdated: date.toISOString() };
        transaction.create(gameRef(data.profileId, id), game);
        return toPublic(game);
      });
    },
    async saveGame(request) {
      const data = requireData(request);
      const state = validateState(data.state);
      const ref = gameRef(data.profileId, data.gameId);
      return db.runTransaction(async transaction => {
        await readProfile(transaction, data.profileId, request.auth.uid);
        const current = activeGame(await transaction.get(ref));
        assertRevision(data.expectedRevision, current.revision);
        const date = now();
        const result = { ...current, ...state, revision: current.revision + 1, updatedAt: date, lastUpdated: date.toISOString() };
        transaction.set(ref, result);
        return toPublic(result);
      });
    },
    async archiveGame(request) {
      const data = requireData(request);
      const ref = gameRef(data.profileId, data.gameId);
      return db.runTransaction(async transaction => {
        await readProfile(transaction, data.profileId, request.auth.uid);
        const current = activeGame(await transaction.get(ref));
        const date = now();
        transaction.update(ref, { deletedAt: date, updatedAt: date, lastUpdated: date.toISOString(), revision: current.revision + 1 });
        return { ok: true };
      });
    },
    async saveFrequentPlayers(request) {
      const data = requireData(request);
      const players = validatePlayers(data.players, { max: 200 });
      const ref = rosterRef(data.profileId);
      return db.runTransaction(async transaction => {
        await readProfile(transaction, data.profileId, request.auth.uid);
        const snapshot = await transaction.get(ref);
        const revision = snapshot.exists ? snapshot.data().revision : 0;
        assertRevision(data.expectedRevision, revision);
        const result = { players, revision: revision + 1, updatedAt: now() };
        transaction.set(ref, result);
        return toPublic(result);
      });
    },
    async saveMatchScore(request) {
      const data = requireData(request);
      if (data.token != null) fail('permission-denied', '公開協助計分連結已停用。');
      return db.runTransaction(async transaction => {
        await readProfile(transaction, data.profileId, request.auth.uid);
        const ref = gameRef(data.profileId, data.gameId);
        const current = activeGame(await transaction.get(ref));
        const scored = applyMatchScore(toPublic(current), data);
        const date = now();
        const result = { ...current, schedules: scored.schedules, revision: current.revision + 1, lastUpdated: date.toISOString(), updatedAt: date };
        transaction.update(ref, { schedules: scored.schedules, revision: result.revision, lastUpdated: result.lastUpdated, updatedAt: date });
        return toPublic(result);
      });
    }
  };
}
