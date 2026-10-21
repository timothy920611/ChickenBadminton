import { auth, db } from './firebase.js';
import { createService } from './shared-service.js';
import { webStore } from './firestore-store.js';

let service;
export async function runOperation(name, data) {
  service ||= createService(webStore(db));
  try {
    return await service[name]({ auth: auth.currentUser, data });
  } catch (error) {
    if (data.token && error.code === 'permission-denied') {
      error.message = '分享連結已失效，請向主辦人取得新連結。';
    }
    throw error;
  }
}
