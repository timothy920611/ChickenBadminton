import { collection, doc, getDoc, getDocs, onSnapshot } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from './firebase.js';
import { readyUser, getConnectionUser } from './auth.js';

const stateKeys = ['players', 'currentTeams', 'schedules', 'matchMode', 'pendingRestMsg',
  'needsInitialSchedule', 'lastUpdated', 'savedTeamDraft', 'savedDraftMode', 'savedDraftRestMsg',
  'savedDraftRestPlayer', 'savedDraftUpdatedAt'];
// A tab must never save a loaded profile's data into a profile selected by another tab.
let boundProfileId;
async function currentProfile() {
  const profile = await readyUser();
  if (!profile) throw new Error('請先回首頁選擇使用者。');
  if (boundProfileId && boundProfileId !== profile.id) {
    throw new Error('其他分頁已切換使用者，請重新載入此頁後再操作。');
  }
  boundProfileId ||= profile.id;
  return profile.id;
}
function plain(value) {
  if (value?.toDate) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
  return value;
}
async function call(name, payload = {}, withProfile = true) {
  await getConnectionUser();
  if (withProfile) payload = { ...payload, profileId: await currentProfile() };
  try { return (await httpsCallable(functions, name)(payload)).data; }
  catch (error) {
    if (error.code === 'functions/aborted' || error.code === 'functions/failed-precondition') {
      error.message = '資料已由其他裝置更新，請重新載入後再編輯。本機草稿尚未上傳。';
    }
    throw error;
  }
}
export async function listGames() {
  const profileId = await currentProfile();
  const result = await getDocs(collection(db, 'profiles', profileId, 'games'));
  return result.docs.map(item => ({ ...plain(item.data()), id: item.id }))
    .filter(game => !game.deletedAt)
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)));
}
export async function getGame(id) {
  const profileId = await currentProfile();
  const snapshot = await getDoc(doc(db, 'profiles', profileId, 'games', String(id)));
  const game = snapshot.exists() ? { ...plain(snapshot.data()), id: snapshot.id } : null;
  return game?.deletedAt ? null : game;
}
export function watchGame(id, onGame, onError) {
  let stopped = false;
  let unsubscribe;
  currentProfile().then(profileId => {
    if (stopped) return;
    unsubscribe = onSnapshot(doc(db, 'profiles', profileId, 'games', String(id)), snapshot => {
      const game = snapshot.exists() ? { ...plain(snapshot.data()), id: snapshot.id } : null;
      onGame(game?.deletedAt ? null : game);
    }, onError);
  }).catch(onError);
  return () => { stopped = true; unsubscribe?.(); };
}
export const createGame = name => call('createGame', { name });
export const archiveGame = gameId => call('archiveGame', { gameId });
export const saveGame = (gameId, state, expectedRevision) => call('saveGame', {
  gameId, expectedRevision,
  state: Object.fromEntries(stateKeys.filter(key => state[key] !== undefined).map(key => [key, state[key]])),
});
export async function listFrequentPlayers() {
  const profileId = await currentProfile();
  const snapshot = await getDoc(doc(db, 'profiles', profileId, 'settings', 'frequentPlayers'));
  return snapshot.exists() ? plain(snapshot.data()) : { players: [], revision: 0 };
}
export const saveFrequentPlayers = (players, expectedRevision) => call('saveFrequentPlayers', { players, expectedRevision });
export const createShare = gameId => call('createShare', { gameId });
export const revokeShare = gameId => call('revokeShare', { gameId });
export const getSharedGame = token => call('getSharedGame', { token }, false);
export const saveMatchScore = payload => call('saveMatchScore', payload, !payload.token);
