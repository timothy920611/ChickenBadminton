import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createService } from '../src/services/shared-service.js';
import { validateState } from '../src/domain/validation.js';
import { transactionStore } from '../src/services/transaction-store.js';
import * as sdk from 'firebase/firestore';
const webStore = database => transactionStore(database, sdk);

const emulatorAvailable = Boolean(process.env.FIRESTORE_EMULATOR_HOST);
test('Firestore Spark rules enforce the shared transaction boundary', { skip: !emulatorAvailable }, async t => {
  const { initializeTestEnvironment, assertSucceeds, assertFails } = await import('@firebase/rules-unit-testing');
  const { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc, serverTimestamp, Timestamp } = await import('firebase/firestore');
  const [host,port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
  const env = await initializeTestEnvironment({projectId:'demo-chicken-badminton',firestore:{host,port:Number(port),rules:await readFile(new URL('../firestore.rules',import.meta.url),'utf8')}});
  t.after(() => env.cleanup());
  const a=env.authenticatedContext('a',{firebase:{sign_in_provider:'anonymous'}}).firestore();
  const b=env.authenticatedContext('b',{firebase:{sign_in_provider:'anonymous'}}).firestore();
  const unauth=env.unauthenticatedContext().firestore();
  const request=(data,uid='a')=>({auth:{uid},data});
  let n=0;
  const service=createService(webStore(a),{newId:()=>`id-${++n}`});
  const other=createService(webStore(b));
  const profile=await service.createProfile(request({name:'共用測試'}));
  const game=await service.createGame(request({profileId:profile.id,name:'練習'}));
  const p=`profiles/${profile.id}`, g=`${p}/games/${game.id}`, roster=`${p}/settings/frequentPlayers`;
  const ids={profileId:profile.id,gameId:game.id};
  const snapshot=async()=> (await getDoc(doc(a,g))).data();

  await t.test('anonymous sessions can intentionally read and manage the same profile',async()=>{
    await assertSucceeds(getDocs(collection(b,'profiles')));
    await assertSucceeds(getDocs(collection(b,`${p}/games`)));
    const value=await other.saveGame(request({...ids,state:validateState({}),expectedRevision:1},'b'));
    assert.equal(value.revision,2);
    await other.saveFrequentPlayers(request({profileId:profile.id,players:[],expectedRevision:0},'b'));
  });
  await t.test('unauthenticated reads, queries and writes fail',async()=>{
    for(const path of [p,g,roster]) {
      await assertFails(getDoc(doc(unauth,path)));
      await assertFails(setDoc(doc(unauth,path),{}));
    }
    await assertFails(getDocs(collection(unauth,'profiles')));
  });
  await t.test('create and update reject extra fields, wrong types and missing required fields',async()=>{
    const good=await snapshot();
    for(const change of [{role:'admin'},{name:'x'.repeat(121)},{players:'bad'},{players:Array(21).fill({})},{revision:-1},{updatedAt:'fake'},{createdAt:Timestamp.fromMillis(0)}]) {
      await assertFails(setDoc(doc(a,g),{...good,revision:good.revision+1,updatedAt:serverTimestamp(),...change}));
    }
    const missing={...good,revision:good.revision+1,updatedAt:serverTimestamp()}; delete missing.players;
    await assertFails(setDoc(doc(a,g),missing));
    await assertFails(setDoc(doc(a,`${p}/games/invalid`),{...good,id:'invalid',role:'admin',revision:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(doc(a,p),{role:'admin',updatedAt:serverTimestamp()}));
  });
  await t.test('stale revisions, immutable metadata changes and physical deletes fail',async()=>{
    const good=await snapshot();
    await assertFails(updateDoc(doc(a,g),{revision:good.revision,updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(doc(a,g),{revision:good.revision+2,updatedAt:serverTimestamp()}));
    await assertFails(updateDoc(doc(a,g),{name:'renamed',revision:good.revision+1,updatedAt:serverTimestamp()}));
    await assertFails(deleteDoc(doc(a,g)));
    await assertFails(deleteDoc(doc(a,p)));
    await assert.rejects(other.saveGame(request({...ids,state:{},expectedRevision:1},'b')),e=>e.code==='aborted');
  });
  await t.test('orphan data, undefined settings, extra fields and invalid roster types fail',async()=>{
    await assertFails(getDoc(doc(a,'profiles/missing/games/one')));
    await assertFails(setDoc(doc(a,`${p}/settings/roles`),{role:'admin'}));
    for(const value of [{players:'bad'},{players:Array(201).fill({})},{role:'admin'}]) {
      await assertFails(setDoc(doc(a,roster),{players:[],revision:2,updatedAt:serverTimestamp(),...value}));
    }
  });
  await t.test('concurrent score transactions keep both match updates',async()=>{
    const team=id=>({id,name1:id+'1',name2:id+'2',totalLevel:8});
    const matches=['m1','m2'].map(id=>({id,round:1,team1:team(id+'a'),team2:team(id+'b'),score1:null,score2:null,isFinished:false}));
    const current=await snapshot();
    await service.saveGame(request({...ids,expectedRevision:current.revision,state:{schedules:[{id:1,mode:'single',restMsg:'',matches}]}}));
    const results = await Promise.allSettled([
      service.saveMatchScore(request({...ids,scheduleId:1,matchId:'m1',score1:21,score2:15,isFinished:true})),
      other.saveMatchScore(request({...ids,scheduleId:1,matchId:'m2',score1:18,score2:21,isFinished:true},'b'))
    ]);
    assert.deepEqual(results.map(r=>r.status), ['fulfilled','fulfilled'], JSON.stringify(results));
    assert.deepEqual((await snapshot()).schedules[0].matches.map(m=>[m.score1,m.score2]),[[21,15],[18,21]]);
  });
  await t.test('share hashes cannot be listed; forged links and expiries fail',async()=>{
    await assertFails(getDocs(collection(a,'shareLinks')));
    await assertFails(getDocs(collection(a,`${p}/gameShares`)));
    await assertFails(setDoc(doc(a,'shareLinks/'+'a'.repeat(64)),{...ids,createdAt:serverTimestamp(),expiresAt:Timestamp.fromMillis(Date.now()+48*3600000)}));
  });
  await t.test('real client sharing, rotation, scoring and revocation work',async()=>{
    const first=await service.createShare(request(ids));
    assert.equal((await other.getSharedGame(request({token:first.token},'b'))).id,game.id);
    const second=await service.createShare(request(ids));
    await assert.rejects(other.getSharedGame(request({token:first.token},'b')),e=>e.code==='permission-denied');
    await other.saveMatchScore(request({token:second.token,scheduleId:1,matchId:'m1',score1:19,score2:21,isFinished:true},'b'));
    assert.equal((await snapshot()).schedules[0].matches[0].score1,19);
    await service.revokeShare(request(ids));
    await assert.rejects(other.getSharedGame(request({token:second.token},'b')),e=>e.code==='permission-denied');
  });
  await t.test('expired share reads and writes fail; archival preserves data and blocks updates',async()=>{
    const hash='f'.repeat(64);
    await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'shareLinks/'+hash),{...ids,expiresAt:Timestamp.fromMillis(0)}));
    await assertFails(getDoc(doc(a,'shareLinks/'+hash)));
    await service.archiveGame(request(ids));
    const archived=await snapshot(); assert.ok(archived.deletedAt); assert.equal(archived.schedules[0].matches.length,2);
    await assertFails(updateDoc(doc(a,g),{deletedAt:null,revision:archived.revision+1,updatedAt:serverTimestamp()}));
  });
});
