import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      input: Object.fromEntries(['index', 'dashboard', 'play', 'gamestart', 'helper', 'score']
        .map(name => [name, resolve(import.meta.dirname, `${name}.html`)])),
      output: {
        manualChunks: {
          'firebase-auth': ['firebase/auth'],
          'firebase-firestore': ['firebase/firestore'],
          'firebase-functions': ['firebase/functions'],
        },
      },
    },
  },
});
