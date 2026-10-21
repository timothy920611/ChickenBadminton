import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

test('Firestore: shared profiles require authentication and server-only mutations', { skip: !emulatorAvailable }, async (t) => {
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
  const { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, where } = await import('firebase/firestore');
  const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
  const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const environment = await initializeTestEnvironment({
    projectId: 'demo-chickenbadminton-rules',
    firestore: { host, port: Number(port), rules },
  });
  t.after(() => environment.cleanup());
  const gamePath = 'profiles/club/games/game-1';
  const profilePath = 'profiles/club';
  const settingsPath = 'profiles/club/settings/frequentPlayers';
  const privatePaths = ['profiles/club/gameShares/game-1', 'shareLinks/token-hash'];
  await environment.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, profilePath), { id: 'club', name: 'Club', createdAt: '2026-10-21' });
    await setDoc(doc(db, gamePath), { id: 'game-1', name: 'Practice', deletedAt: null, revision: 1, players: [] });
    await setDoc(doc(db, settingsPath), { players: [], revision: 1 });
    for (const path of privatePaths) await setDoc(doc(db, path), { tokenHash: 'secret' });
  });
  const owner = environment.authenticatedContext('owner').firestore();
  const other = environment.authenticatedContext('other').firestore();
  const guest = environment.authenticatedContext('guest', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
  const publicDb = environment.unauthenticatedContext().firestore();

  await t.test('all signed-in visitors can read shared profiles, games, and settings', async () => {
    for (const db of [owner, other, guest]) {
      await assertSucceeds(getDoc(doc(db, profilePath)));
      const profiles = await assertSucceeds(getDocs(collection(db, 'profiles')));
      assert.equal(profiles.size, 1);
      const game = await assertSucceeds(getDoc(doc(db, gamePath)));
      assert.equal(game.data().name, 'Practice');
      const games = await assertSucceeds(getDocs(query(collection(db, 'profiles/club/games'), where('deletedAt', '==', null))));
      assert.equal(games.size, 1);
      await assertSucceeds(getDoc(doc(db, settingsPath)));
    }
  });

  await t.test('unauthenticated clients cannot read or list shared data', async () => {
    for (const db of [publicDb]) {
      await assertFails(getDoc(doc(db, profilePath)));
      await assertFails(getDocs(collection(db, 'profiles')));
      await assertFails(getDoc(doc(db, gamePath)));
      await assertFails(getDocs(collection(db, 'profiles/club/games')));
      await assertFails(getDoc(doc(db, settingsPath)));
    }
  });

  await t.test('all client creates, updates, and deletes are rejected, including anonymous authenticated clients', async () => {
    for (const db of [owner, other, guest, publicDb]) {
      await assertFails(setDoc(doc(db, 'profiles/injected'), { id: 'injected', name: 'Injected' }));
      await assertFails(updateDoc(doc(db, profilePath), { name: 'Changed' }));
      await assertFails(deleteDoc(doc(db, profilePath)));
      await assertFails(setDoc(doc(db, 'profiles/club/games/injected'), { name: 'injected', ownerId: 'other' }));
      await assertFails(updateDoc(doc(db, gamePath), { revision: 100, role: 'admin' }));
      await assertFails(updateDoc(doc(db, gamePath), { name: 'x'.repeat(10000) }));
      await assertFails(deleteDoc(doc(db, gamePath)));
      await assertFails(setDoc(doc(db, settingsPath), { players: [], revision: 999 }));
    }
  });

  await t.test('share hashes and internal authorization documents are never exposed to clients', async () => {
    for (const db of [owner, other, guest, publicDb]) {
      for (const path of privatePaths) {
        await assertFails(getDoc(doc(db, path)));
        await assertFails(setDoc(doc(db, path), { tokenHash: 'replacement' }));
        await assertFails(deleteDoc(doc(db, path)));
      }
    }
  });

  await t.test('unrecognized paths and private user data remain denied', async () => {
    for (const path of ['users/owner', 'profiles/club/settings/roles', 'games/game-1', 'profiles/club/games/game-1/private/note']) {
      await assertFails(getDoc(doc(owner, path)));
      await assertFails(setDoc(doc(owner, path), { role: 'admin' }));
    }
  });
});
