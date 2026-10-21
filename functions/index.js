import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { setGlobalOptions } from 'firebase-functions/v2';
import { DomainError } from './domain.js';
import { createService } from './service.js';

initializeApp();
setGlobalOptions({ region: 'asia-east1', maxInstances: 10 });
const service = createService(getFirestore());
const callable = name => onCall(async request => {
  try { return await service[name](request); }
  catch (error) {
    if (error instanceof DomainError) throw new HttpsError(error.code, error.message);
    // Never put tokens, game payloads, or other user data in logs or error messages.
    console.error('Callable operation failed', name, error.code || error.name);
    throw new HttpsError('internal', '儲存服務暫時無法使用，請稍後重試。');
  }
});
export const createProfile = callable('createProfile');
export const createGame = callable('createGame');
export const saveGame = callable('saveGame');
export const archiveGame = callable('archiveGame');
export const saveFrequentPlayers = callable('saveFrequentPlayers');
export const createShare = callable('createShare');
export const revokeShare = callable('revokeShare');
export const getSharedGame = callable('getSharedGame');
export const saveMatchScore = callable('saveMatchScore');
