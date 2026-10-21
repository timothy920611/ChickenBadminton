import { signInAnonymously } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { collection, doc, getDoc, getDocs } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { runOperation } from './client-store.js';
import { auth, db, configurationError } from './firebase.js';

const PROFILE_KEY = 'chicken:selectedProfile';
let connectionPromise;
export async function getConnectionUser() {
  if (configurationError()) throw new Error(configurationError());
  if (!connectionPromise) {
    connectionPromise = (async () => {
      await auth.authStateReady();
      return auth.currentUser || (await signInAnonymously(auth)).user;
    })().catch(error => { connectionPromise = null; throw error; });
  }
  return connectionPromise;
}
function profileView(data, id = data.id) {
  return { id, uid: id, name: data.name, displayName: data.name, isAnonymous: false };
}
export async function listProfiles() {
  await getConnectionUser();
  const snapshot = await getDocs(collection(db, 'profiles'));
  return snapshot.docs.map(item => profileView(item.data(), item.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
}
export async function createProfile(name) {
  await getConnectionUser();
  return profileView(await runOperation('createProfile', { name }));
}
export function selectProfile(profile) {
  localStorage.setItem(PROFILE_KEY, profile.id || profile.uid);
  return profileView(profile, profile.id || profile.uid);
}
export async function readyUser({ allowGuest = false } = {}) {
  const connectionUser = await getConnectionUser();
  const id = localStorage.getItem(PROFILE_KEY);
  if (!id) return allowGuest ? connectionUser : null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) {
    localStorage.removeItem(PROFILE_KEY);
    return null;
  }
  const profile = await getDoc(doc(db, 'profiles', id));
  if (!profile.exists()) {
    localStorage.removeItem(PROFILE_KEY);
    return allowGuest ? connectionUser : null;
  }
  return profileView(profile.data(), id);
}
export async function logout() {
  localStorage.removeItem(PROFILE_KEY);
}
export function authErrorMessage(error) {
  const code = error?.code || '';
  if (code.includes('operation-not-allowed')) return 'Firebase 尚未啟用匿名驗證，請依設定文件啟用。';
  if (code.includes('network-request-failed') || code.includes('unavailable')) return '連線失敗，請檢查網路後重試。';
  if (code.includes('permission-denied')) return '目前無法存取資料，請確認 Firebase 設定與安全規則。';
  return error?.message || '操作失敗，請稍後重試。';
}
