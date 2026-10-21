import {
  DomainError, validateState, validatePlayers, text, identifier, assertRevision,
  assertShareActive, applyMatchScore, toPublic, sharedGame
} from '../domain/validation.js';

const SHARE_LIFETIME_MS = 24 * 60 * 60 * 1000;
const fail = (code, message) => { throw new DomainError(code, message); };
const tokenHash = async token => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const pathId = (value, label) => {
  identifier(value, label);
  // Path segments must not allow dot segments, even though legacy player IDs can contain dots.
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail('invalid-argument', `${label} 格式不正確。`);
  return value;
};
const authenticate = request => {
  if (!request.auth?.uid) fail('unauthenticated', '請重新整理頁面，建立連線後再操作。');
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

/**
 * Shared application operations, backed by Firestore client transactions on Spark.
 * Profiles intentionally are shared workspaces: every authenticated visitor may manage all profiles.
 * Firebase anonymous Auth establishes a session, not ownership of a selected profile.
 */
export function createService(db, { now = () => new Date(), newId = () => crypto.randomUUID(), newToken = randomToken } = {}) {
  const profileRef = profileId => db.doc(`profiles/${pathId(profileId, '使用者 ID')}`);
  const gameRef = (profileId, gameId) => db.doc(`profiles/${pathId(profileId, '使用者 ID')}/games/${pathId(gameId, '比賽 ID')}`);
  const rosterRef = profileId => db.doc(`profiles/${pathId(profileId, '使用者 ID')}/settings/frequentPlayers`);
  const activeShareRef = (profileId, gameId) => db.doc(`profiles/${pathId(profileId, '使用者 ID')}/gameShares/${pathId(gameId, '比賽 ID')}`);
  async function shareRef(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail('permission-denied', '分享連結格式不正確。');
    return db.doc(`shareLinks/${await tokenHash(token)}`);
  }
  async function readProfile(transaction, profileId) { return requireProfile(await transaction.get(profileRef(profileId))); }
  async function readShared(transaction, token) {
    const snapshot = await transaction.get(await shareRef(token));
    const link = snapshot.exists ? snapshot.data() : null;
    assertShareActive(link, now().getTime());
    await readProfile(transaction, link.profileId);
    const ref = gameRef(link.profileId, link.gameId);
    const game = activeGame(await transaction.get(ref));
    return { link, ref, game };
  }

  return {
    async createProfile(request) {
      const data = requireData(request);
      const name = text(data.name, '使用者名稱', 80);
      const id = newId();
      const date = now();
      const profile = { id, name, createdAt: date, updatedAt: date };
      await profileRef(id).create(profile);
      return toPublic(profile);
    },
    async createGame(request) {
      const data = requireData(request);
      const name = text(data.name, '比賽名稱', 120);
      const id = newId();
      return db.runTransaction(async transaction => {
        await readProfile(transaction, data.profileId);
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
        await readProfile(transaction, data.profileId);
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
      const activeRef = activeShareRef(data.profileId, data.gameId);
      return db.runTransaction(async transaction => {
        await readProfile(transaction, data.profileId);
        const current = activeGame(await transaction.get(ref));
        const share = await transaction.get(activeRef);
        const date = now();
        transaction.update(ref, { deletedAt: date, updatedAt: date, lastUpdated: date.toISOString(), revision: current.revision + 1 });
        if (share.exists) {
          transaction.delete(db.doc(`shareLinks/${share.data().tokenHash}`));
          transaction.delete(activeRef);
        }
        return { ok: true };
      });
    },
    async saveFrequentPlayers(request) {
      const data = requireData(request);
      const players = validatePlayers(data.players, { max: 200 });
      const ref = rosterRef(data.profileId);
      return db.runTransaction(async transaction => {
        await readProfile(transaction, data.profileId);
        const snapshot = await transaction.get(ref);
        const revision = snapshot.exists ? snapshot.data().revision : 0;
        assertRevision(data.expectedRevision, revision);
        const result = { players, revision: revision + 1, updatedAt: now() };
        transaction.set(ref, result);
        return toPublic(result);
      });
    },
    async createShare(request) {
      const data = requireData(request);
      const ref = gameRef(data.profileId, data.gameId);
      const activeRef = activeShareRef(data.profileId, data.gameId);
      const token = newToken();
      const hash = await tokenHash(token);
      const expiry = new Date(now().getTime() + SHARE_LIFETIME_MS);
      return db.runTransaction(async transaction => {
        await readProfile(transaction, data.profileId);
        activeGame(await transaction.get(ref));
        const previous = await transaction.get(activeRef);
        if (previous.exists) transaction.delete(db.doc(`shareLinks/${previous.data().tokenHash}`));
        transaction.set(db.doc(`shareLinks/${hash}`), { profileId: data.profileId, gameId: data.gameId, expiresAt: expiry, createdAt: now() });
        transaction.set(activeRef, { tokenHash: hash, expiresAt: expiry });
        return { token, expiresAt: expiry.toISOString() };
      });
    },
    async revokeShare(request) {
      const data = requireData(request);
      const ref = gameRef(data.profileId, data.gameId);
      const activeRef = activeShareRef(data.profileId, data.gameId);
      return db.runTransaction(async transaction => {
        await readProfile(transaction, data.profileId);
        activeGame(await transaction.get(ref));
        const current = await transaction.get(activeRef);
        if (current.exists) {
          transaction.delete(db.doc(`shareLinks/${current.data().tokenHash}`));
          transaction.delete(activeRef);
        }
        return { ok: true };
      });
    },
    async getSharedGame(request) {
      const data = requireData(request);
      return db.runTransaction(async transaction => sharedGame((await readShared(transaction, data.token)).game));
    },
    async saveMatchScore(request) {
      const data = requireData(request);
      const viaShare = data.token != null;
      return db.runTransaction(async transaction => {
        let ref, current;
        if (viaShare) {
          const shared = await readShared(transaction, data.token);
          ref = shared.ref; current = shared.game;
        } else {
          await readProfile(transaction, data.profileId);
          ref = gameRef(data.profileId, data.gameId);
          current = activeGame(await transaction.get(ref));
        }
        const scored = applyMatchScore(toPublic(current), data);
        const date = now();
        const result = { ...current, schedules: scored.schedules, revision: current.revision + 1, lastUpdated: date.toISOString(), updatedAt: date };
        transaction.update(ref, { schedules: scored.schedules, revision: result.revision, lastUpdated: result.lastUpdated, updatedAt: date });
        return viaShare ? sharedGame(result) : toPublic(result);
      });
    }
  };
}
