import test from 'node:test';
import assert from 'node:assert/strict';
import { assignOwner } from '../scripts/assign-legacy-owner.mjs';

// 只測管理員歸屬遷移的不可逆邊界，不使用正式 Firebase。
function fixture(ownerUid) {
  const writes = [];
  const db = { doc: path => path, runTransaction: cb => cb({
    get: async path => ({ exists: true, data: () => ({ ownerUid }) }),
    update: (path, data) => writes.push({ path, data }),
  }) };
  const auth = { getUser: async uid => ({ uid, emailVerified: true, disabled: false, providerData: [{ providerId: 'google.com' }] }) };
  return { db, auth, writes };
}
test('舊資料預設 dry-run，只可綁定已驗證 Google UID', async () => {
  const { db, auth, writes } = fixture();
  const map = { Timothy: 'one', guest: 'two' };
  const result = await assignOwner(db, auth, 'owner', map);
  assert.equal(result.changed, 2); assert.equal(writes.length, 0);
  await assignOwner(db, auth, 'owner', map, true);
  assert.equal(writes.length, 2); assert.deepEqual(writes[0].data, { ownerUid: 'owner' });
  await assert.rejects(assignOwner(db, { getUser: async () => ({ emailVerified: false, providerData: [] }) }, 'owner', map, true));
});
test('不轉移既有擁有者，重跑同一 UID 不重寫任何文件', async () => {
  const { db, auth, writes } = fixture('someone-else');
  await assert.rejects(assignOwner(db, auth, 'owner', { Timothy: 'one' }, true));
  assert.equal(writes.length, 0);
  const same = fixture('owner');
  assert.equal((await assignOwner(same.db, same.auth, 'owner', { Timothy: 'one' }, true)).changed, 0);
  assert.equal(same.writes.length, 0);
});
