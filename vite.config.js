import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// 相對資源路徑同時支援 GitHub Pages 專案子目錄與本機預覽。
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    rollupOptions: {
      external: id => id.startsWith('https://www.gstatic.com/firebasejs/'),
      input: Object.fromEntries(['index', 'dashboard', 'play', 'gamestart', 'helper', 'score']
        .map(name => [name, resolve(import.meta.dirname, `${name}.html`)])),
    },
  },
});
