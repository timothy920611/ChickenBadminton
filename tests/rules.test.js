import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createService } from '../src/services/shared-service.js';
import { transactionStore } from '../src/services/transaction-store.js';
import * as sdk from 'firebase/firestore';

// 測試實際 Rules，不以前端隱藏按鈕取代跨帳號授權測試。
test('Firestore 僅允許 Google 帳號擁有者存取', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
  const { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp, Timestamp, query, where } = sdk;
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({ projectId: 'demo-chicken-badminton', firestore: { host, port: Number(port), rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8') } });
  t.after(() => env.cleanup());
  const google = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' } }).firestore();
  const a = google('a'), sameAccount = google('a'), b = google('b');
  const anonymous = env.authenticatedContext('anon', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  const unauth = env.unauthenticatedContext().firestore();
  const request = (data, uid = 'a') => ({ auth: { uid }, data });
  let n = 0;
  const service = createService(transactionStore(a, sdk), { newId: () => `owner-${Date.now()}-${++n}` });
  const second = createService(transactionStore(sameAccount, sdk));
  const profile = await service.createProfile(request({ name: '我的工作區' }));
  const game = await service.createGame(request({ profileId: profile.id, name: '練習' }));
  const p = `profiles/${profile.id}`, g = `${p}/games/${game.id}`, roster = `${p}/settings/frequentPlayers`;
  const ids = { profileId: profile.id, gameId: game.id };
  const snapshot = async () => (await getDoc(doc(a, g))).data();
  await service.saveFrequentPlayers(request({ profileId: profile.id, players: [], expectedRevision: 0 }));

  await t.test('未登入、匿名及其他帳號不能直接讀寫或列出子資料', async () => {
    for (const db of [unauth, anonymous, b]) {
      for (const path of [p, g, roster]) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), {}));
        await assertFails(updateDoc(doc(db, path), { ownerUid: 'b' }));
        await assertFails(deleteDoc(doc(db, path)));
      }
      await assertFails(getDocs(collection(db, `${p}/games`)));
      await assertFails(getDocs(collection(db, `${p}/settings`)));
    }
    await assertFails(getDocs(collection(a, 'profiles')));
    await assertSucceeds(getDocs(query(collection(a, 'profiles'), where('ownerUid', '==', 'a'))));
    const others = await assertSucceeds(getDocs(query(collection(b, 'profiles'), where('ownerUid', '==', 'b'))));
    assert.equal(others.docs.some(d => d.id === profile.id), false);
  });
  await t.test('不可偽造或變更擁有者，舊文件不能自行認領', async () => {
    const good = (await getDoc(doc(a, p))).data();
    await assertFails(setDoc(doc(b, 'profiles/forged'), { ...good, id: 'forged', ownerUid: 'a', createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(a, p), { ownerUid: 'b', updatedAt: serverTimestamp() }));
    const removed = { ...good, updatedAt: serverTimestamp() }; delete removed.ownerUid;
    await assertFails(setDoc(doc(a, p), removed));
    await env.withSecurityRulesDisabled(async c => setDoc(doc(c.firestore(), 'profiles/unclaimed'), { id: 'unclaimed', name: '舊資料', createdAt: Timestamp.now(), updatedAt: Timestamp.now() }));
    await assertFails(getDoc(doc(a, 'profiles/unclaimed')));
    await assertFails(updateDoc(doc(a, 'profiles/unclaimed'), { ownerUid: 'a', updatedAt: serverTimestamp() }));
  });
  await t.test('建立及更新都拒絕額外欄位、錯誤型別、過長文字、缺必填與偽造時間', async () => {
    const good = await snapshot();
    for (const change of [{ role: 'admin' }, { name: 'x'.repeat(121) }, { players: 'bad' }, { players: Array(21).fill({}) }, { revision: -1 }, { updatedAt: 'fake' }, { createdAt: Timestamp.fromMillis(0) }]) {
      await assertFails(setDoc(doc(a, g), { ...good, revision: good.revision + 1, updatedAt: serverTimestamp(), ...change }));
      await assertFails(setDoc(doc(a, `${p}/games/invalid`), { ...good, id: 'invalid', revision: 1, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...change }));
    }
    const missing = { ...good, revision: good.revision + 1, updatedAt: serverTimestamp() }; delete missing.players;
    await assertFails(setDoc(doc(a, g), missing));
    await assertFails(updateDoc(doc(a, p), { role: 'admin', updatedAt: serverTimestamp() }));
    for (const value of [{ players: 'bad' }, { players: Array(201).fill({}) }, { role: 'admin' }])
      await assertFails(setDoc(doc(a, roster), { players: [], revision: 2, updatedAt: serverTimestamp(), ...value }));
  });
  await t.test('拒絕舊 revision、不可變資料、未知路徑及所有分享憑證', async () => {
    const good = await snapshot();
    for (const change of [{ revision: good.revision }, { revision: good.revision + 2 }, { name: 'renamed' }])
      await assertFails(updateDoc(doc(a, g), { revision: good.revision + 1, updatedAt: serverTimestamp(), ...change }));
    await assertFails(deleteDoc(doc(a, g))); await assertFails(deleteDoc(doc(a, p)));
    for (const path of [`${p}/settings/roles`, `${p}/gameShares/one`, 'shareLinks/old', 'admin/secret']) {
      await assertFails(getDoc(doc(a, path))); await assertFails(setDoc(doc(a, path), {}));
    }
  });
  await t.test('同一帳號跨裝置交易保留兩筆計分，封存後不可修改', async () => {
    const team = id => ({ id, name1: id + '1', name2: id + '2', totalLevel: 8 });
    const matches = ['m1', 'm2'].map(id => ({ id, round: 1, team1: team(id + 'a'), team2: team(id + 'b'), score1: null, score2: null, isFinished: false }));
    const current = await snapshot();
    await service.saveGame(request({ ...ids, expectedRevision: current.revision, state: { schedules: [{ id: 1, mode: 'single', restMsg: '', matches }] } }));
    await Promise.all([
      service.saveMatchScore(request({ ...ids, scheduleId: 1, matchId: 'm1', score1: 21, score2: 15, isFinished: true })),
      second.saveMatchScore(request({ ...ids, scheduleId: 1, matchId: 'm2', score1: 18, score2: 21, isFinished: true })),
    ]);
    assert.deepEqual((await snapshot()).schedules[0].matches.map(m => [m.score1, m.score2]), [[21, 15], [18, 21]]);
    await service.archiveGame(request(ids));
    const archived = await snapshot(); assert.ok(archived.deletedAt);
    await assertFails(updateDoc(doc(a, g), { deletedAt: null, revision: archived.revision + 1, updatedAt: serverTimestamp() }));
  });
});
