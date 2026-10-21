import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 只能由本機管理員執行；前端不可自行認領舊工作區。
export async function assignOwner(db, auth, uid, mapping, write = false) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('請提供合法 Firebase UID。');
  const user = await auth.getUser(uid);
  if (user.disabled || !user.emailVerified || !user.providerData.some(p => p.providerId === 'google.com'))
    throw new Error('目的 UID 必須是啟用中、已驗證的 Google 登入帳號。');
  const ids = Object.values(mapping);
  if (!ids.length || ids.some(id => !/^[A-Za-z0-9_-]{1,100}$/.test(id))) throw new Error('舊工作區 mapping 不正確。');
  return db.runTransaction(async transaction => {
    const references = ids.map(id => db.doc(`profiles/${id}`));
    const snapshots = await Promise.all(references.map(ref => transaction.get(ref)));
    let changed = 0;
    snapshots.forEach(snapshot => {
      if (!snapshot.exists) throw new Error('目的舊工作區不存在。');
      if (snapshot.data().ownerUid && snapshot.data().ownerUid !== uid)
        throw new Error('已有其他擁有者，禁止自動轉移。');
    });
    snapshots.forEach((snapshot, index) => {
      if (!snapshot.data().ownerUid) {
        changed++;
        if (write) transaction.update(references[index], { ownerUid: uid });
      }
    });
    return { dryRun: !write, verifiedGoogleAccount: true, profiles: ids.length, changed, gameDocumentsModified: 0 };
  });
}
async function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--uid');
  const uid = index >= 0 ? args[index + 1] : '';
  if (!uid || args.some((arg, i) => !['--uid','--write'].includes(arg) && i !== index + 1))
    throw new Error('用法：node scripts/assign-legacy-owner.mjs --uid UID [--write]');
  if (process.env.FIRESTORE_EMULATOR_HOST || process.env.FIREBASE_AUTH_EMULATOR_HOST)
    throw new Error('正式綁定不可使用 Emulator 環境變數。');
  const { initializeApp, applicationDefault, deleteApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ projectId: 'chickenbadminton', credential: applicationDefault() });
  try {
    const { mapping } = JSON.parse(await readFile(new URL('../docs/migration-record.json', import.meta.url), 'utf8'));
    const adminAuth = { async getUser(uid) {
      const token = (await app.options.credential.getAccessToken()).access_token;
      const response = await fetch('https://identitytoolkit.googleapis.com/v1/projects/chickenbadminton/accounts:lookup', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-goog-user-project': 'chickenbadminton' },
        body: JSON.stringify({ localId: [uid] }),
      });
      if (!response.ok) throw new Error(`無法驗證 Google 帳號（HTTP ${response.status}）。`);
      const user = (await response.json()).users?.[0];
      if (!user) throw new Error('UID 不存在，請本人先完成 Google 登入。');
      return { uid: user.localId, emailVerified: user.emailVerified, disabled: user.disabled,
        providerData: (user.providerUserInfo || []).map(item => ({ providerId: item.providerId })) };
    } };
    console.log(JSON.stringify(await assignOwner(getFirestore(app), adminAuth, uid, mapping, args.includes('--write')), null, 2));
  } finally { await deleteApp(app); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
