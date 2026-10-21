import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};
const missing = Object.entries(config).filter(([, value]) => !value).map(([key]) => key);
export function configurationError() {
  return missing.length ? '尚未設定 Firebase。請依 README 填寫 .env.local，或使用 npm run dev -- --mode emulator 啟動本機模式。' : null;
}
const app = missing.length ? null : initializeApp(config);
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
export const functions = app ? getFunctions(app, env.VITE_FIREBASE_FUNCTIONS_REGION || 'asia-east1') : null;
if (app && env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    throw new Error('Firebase Emulator 模式僅能在本機使用。');
  }
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
