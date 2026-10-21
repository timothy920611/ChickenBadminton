import assert from 'node:assert/strict';
import { createService } from '../../src/services/shared-service.js';
import { toPublic } from '../../src/domain/validation.js';

// Optional browser fixture: real page and shared domain operations with a
// serializable in-memory store. Firebase transport/rules require emulator mode.
const authModule = `
const key = 'chicken:selectedProfile';
export async function rpc(action, values = {}) {
  const response = await fetch('/__mock-api', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({action, profileId:localStorage.getItem(key), ...values})});
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message), {code:'functions/' + result.code});
  return result;
}
export const listProfiles = () => rpc('listProfiles');
export const createProfile = name => rpc('createProfile', {name});
export function selectProfile(profile) {localStorage.setItem(key, profile.id); return profile;}
export async function readyUser({allowGuest=false}={}) {return localStorage.getItem(key) ? rpc('getProfile') : (allowGuest ? {uid:'anonymous-browser'} : null);}
export const getConnectionUser = async () => ({uid:'anonymous-browser'});
export async function logout() {localStorage.removeItem(key);}
export const authErrorMessage = error => error.message;
`;
const repositoryModule = `
import { rpc } from './auth.js';
const keys = ['players','currentTeams','schedules','matchMode','pendingRestMsg','needsInitialSchedule','lastUpdated','savedTeamDraft','savedDraftMode','savedDraftRestMsg','savedDraftRestPlayer','savedDraftUpdatedAt'];
export const listGames = () => rpc('listGames');
export const getGame = gameId => rpc('getGame', {gameId});
export const createGame = name => rpc('createGame', {name});
export const saveGame = (gameId,state,expectedRevision) => rpc('saveGame',{gameId,state:Object.fromEntries(keys.filter(key=>state[key]!==undefined).map(key=>[key,state[key]])),expectedRevision});
export const archiveGame = gameId => rpc('archiveGame',{gameId});
export const listFrequentPlayers = () => rpc('listFrequentPlayers');
export const saveFrequentPlayers = (players,expectedRevision) => rpc('saveFrequentPlayers',{players,expectedRevision});
export const createShare = gameId => rpc('createShare',{gameId});
export const revokeShare = gameId => rpc('revokeShare',{gameId});
export const getSharedGame = token => rpc('getSharedGame',{token});
export const saveMatchScore = values => rpc('saveMatchScore',values);
export function watchGame(id,onGame,onError) {
 let stopped=false,loading=false;
 async function update(){if(stopped||loading)return;loading=true;try{const game=await getGame(id);if(!stopped)onGame(game);}catch(error){if(!stopped)onError(error);}finally{loading=false;}}
 update(); const timer=setInterval(update,100);return()=>{stopped=true;clearInterval(timer);};
}
`;

function memoryFirestore() {
  const documents = new Map();
  let pending = Promise.resolve();
  const clone = (value) => value === undefined ? undefined : structuredClone(value);
  const ref = (path) => ({
    path,
    create(value) {
      return database.runTransaction(async (transaction) => transaction.create(ref(path), value));
    },
  });
  const database = {
    doc: ref,
    read: (path) => clone(documents.get(path)),
    entries: () => clone([...documents.entries()]),
    runTransaction(callback) {
      const operation = pending.then(async () => {
        const writes = [];
        const transaction = {
          async get(reference) {
            assert.equal(writes.length, 0, 'Firestore requires every transaction read before writes');
            const value = clone(documents.get(reference.path));
            return { exists: value !== undefined, data: () => clone(value) };
          },
          create: (reference, value) => writes.push(['create', reference.path, clone(value)]),
          set: (reference, value) => writes.push(['set', reference.path, clone(value)]),
          update: (reference, value) => writes.push(['update', reference.path, clone(value)]),
          delete: (reference) => writes.push(['delete', reference.path]),
        };
        const result = await callback(transaction);
        const committed = new Map(documents);
        for (const [kind, path, value] of writes) {
          if (kind === 'create' && committed.has(path)) throw new Error('already-exists');
          if (kind === 'update' && !committed.has(path)) throw new Error('not-found');
          if (kind === 'delete') committed.delete(path);
          else if (kind === 'update') committed.set(path, { ...committed.get(path), ...value });
          else committed.set(path, value);
        }
        documents.clear();
        for (const [path, value] of committed) documents.set(path, value);
        return result;
      });
      pending = operation.catch(() => {});
      return operation;
    },
  };
  return database;
}

export function createMockBackend() {
  if (process.env.E2E_MOCK_BACKEND !== '1') return async () => {};
  const db = memoryFirestore();
  const service = createService(db);
  const profileView = profile => profile ? { ...toPublic(profile), uid: profile.id, isAnonymous: false } : null;
  async function perform(data) {
    const { action, profileId, gameId, ...payload } = data;
    if (action === 'listProfiles') return db.entries().filter(([path]) => /^profiles\/[^/]+$/.test(path)).map(([,profile])=>profileView(profile));
    if (action === 'getProfile') return profileView(db.read(`profiles/${profileId}`));
    if (action === 'listGames') return db.entries().filter(([path, game]) => path.startsWith(`profiles/${profileId}/games/`) && !game.deletedAt).map(([,game])=>toPublic(game));
    if (action === 'getGame') {
      const game = db.read(`profiles/${profileId}/games/${gameId}`);
      return game && !game.deletedAt ? toPublic(game) : null;
    }
    if (action === 'listFrequentPlayers') return toPublic(db.read(`profiles/${profileId}/settings/frequentPlayers`) || {players:[],revision:0});
    if (!service[action]) throw new Error(`Unknown mock action ${action}`);
    return service[action]({ auth: { uid: 'test-browser-visitor' }, data: { ...payload, profileId, gameId } });
  }
  return async context => {
    await context.route('https://cdnjs.cloudflare.com/**', route => route.abort());
    await context.route('**/src/services/firebase.js*', route => route.fulfill({contentType:'text/javascript',body:'export const configurationError = () => null;'}));
    await context.route('**/src/services/auth.js*', route => route.fulfill({contentType:'text/javascript',body:authModule}));
    await context.route('**/src/services/repository.js*', route => route.fulfill({contentType:'text/javascript',body:repositoryModule}));
    await context.route('**/__mock-api', async route => {
      try {
        const value = await perform(route.request().postDataJSON());
        await route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
      } catch (error) {
        await route.fulfill({status:400,contentType:'application/json',body:JSON.stringify({code:error.code||'internal',message:error.message})});
      }
    });
  };
}
