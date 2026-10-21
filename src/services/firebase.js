import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

import { initializeAppCheck, ReCaptchaV3Provider } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app-check.js';

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
// 僅使用公開 site key；reCAPTCHA secret 只能存放在 Firebase 控制台。
if (app && env.VITE_APPCHECK_SITE_KEY && env.VITE_USE_FIREBASE_EMULATORS !== 'true') {
  initializeAppCheck(app, {
    provider: new ReCaptchaV3Provider(env.VITE_APPCHECK_SITE_KEY),
    isTokenAutoRefreshEnabled: true,
  });
}
export const auth = app ? getAuth(app) : null;
export const db = app ? getFirestore(app) : null;
if (app && env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
    throw new Error('Firebase Emulator 模式僅能在本機使用。');
  }
  connectAuthEmulator(auth, `http://127.0.0.1:${env.VITE_AUTH_EMULATOR_PORT || 9099}`, { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', Number(env.VITE_FIRESTORE_EMULATOR_PORT || 8080));
}
