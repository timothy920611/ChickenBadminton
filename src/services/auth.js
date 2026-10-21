import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { collection, doc, getDocFromServer, getDocs, query, where } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';
import { runOperation } from './client-store.js';
import { auth, db, configurationError } from './firebase.js';

const PROFILE_KEY = 'chicken:selectedProfile';
function clearPrivateCache() {
  for (const key of Object.keys(localStorage)) {
    if (/^(chicken:|scoreboard_)/.test(key)) localStorage.removeItem(key);
  }
}
export async function accountUser() {
  if (configurationError()) throw new Error(configurationError());
  await auth.authStateReady();
  return auth.currentUser && !auth.currentUser.isAnonymous ? auth.currentUser : null;
}
export async function loginGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  return (await signInWithPopup(auth, provider)).user;
}
export async function getConnectionUser() {
  const user = await accountUser();
  if (!user) throw Object.assign(new Error('請先使用 Google 帳號登入。'), { code: 'unauthenticated' });
  return user;
}
function profileView(data, id = data.id) {
  return { id, uid: id, ownerUid: data.ownerUid, name: data.name, displayName: data.name, isAnonymous: false };
}
export async function listProfiles() {
  const user = await getConnectionUser();
  // Rules 不是結果篩選器；查詢必須明確限制 ownerUid。
  const snapshot = await getDocs(query(collection(db, 'profiles'), where('ownerUid', '==', user.uid)));
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
export async function readyUser() {
  const user = await accountUser();
  if (!user) return null;
  const id = localStorage.getItem(PROFILE_KEY);
  if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
  try {
    const profile = await getDocFromServer(doc(db, 'profiles', id));
    if (profile.exists() && profile.data().ownerUid === user.uid) return profileView(profile.data(), id);
  } catch (error) {
    if (error.code !== 'permission-denied') throw error;
  }
  localStorage.removeItem(PROFILE_KEY);
  return null;
}
export async function logout() {
  await signOut(auth);
  clearPrivateCache();
}
export function authErrorMessage(error) {
  const code = error?.code || '';
  if (code.includes('popup-closed-by-user')) return '已取消登入，可以再試一次。';
  if (code.includes('popup-blocked')) return '瀏覽器封鎖登入視窗，請允許彈出視窗後再試。';
  if (code.includes('unauthorized-domain')) return '這個網域尚未加入 Firebase Authentication 授權網域。';
  if (code.includes('operation-not-allowed')) return 'Firebase 尚未啟用 Google 登入。';
  if (code.includes('network-request-failed') || code.includes('unavailable')) return '連線失敗，請檢查網路後重試。';
  if (code.includes('permission-denied')) return '你沒有存取這份資料的權限，請確認登入帳號。';
  return error?.message || '操作失敗，請稍後重試。';
}
// 帳號切換時清除本機草稿；既有頁面重新載入，避免前一帳號的內容留在畫面上。
if (auth) {
  let previousUid;
  onAuthStateChanged(auth, user => {
    const uid = user && !user.isAnonymous ? user.uid : null;
    const storedUid = localStorage.getItem('chicken:accountUid');
    if (storedUid && storedUid !== uid) clearPrivateCache();
    if (uid) localStorage.setItem('chicken:accountUid', uid);
    if (previousUid && previousUid !== uid) {
      clearPrivateCache();
      location.replace(new URL('index.html', location.href));
    }
    previousUid = uid;
  });
}
