import { loadEnv } from 'vite';
import { readdir, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
const config = loadEnv('production', process.cwd(), 'VITE_');
if (config.VITE_FIREBASE_PROJECT_ID !== 'chickenbadminton' || config.VITE_USE_FIREBASE_EMULATORS !== 'false'
  || !config.VITE_FIREBASE_API_KEY || !config.VITE_FIREBASE_APP_ID || !config.VITE_FIREBASE_AUTH_DOMAIN) {
  throw new Error('Production build requires the chickenbadminton Web config and emulator mode=false.');
}
async function inspect(directory) {
  for (const entry of await readdir(directory)) {
    const path = join(directory, entry);
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || /^(json|users|scripts|functions|node_modules)$/.test(entry)
      || entry.startsWith('.') || /service.account|credential|\.json$|\.map$/i.test(entry)) {
      throw new Error(`Unexpected Hosting file: ${path}`);
    }
    if (stat.isDirectory()) await inspect(path);
    else if (/\.(js|html|css)$/.test(entry)) {
      const source = await readFile(path, 'utf8');
      if (/github_pat_|-----BEGIN (RSA )?PRIVATE KEY-----|demo-chicken-badminton|127\.0\.0\.1:9099/.test(source)) {
        throw new Error(`Non-production content in ${path}`);
      }
    }
  }
}
await inspect('dist');
console.log('Production config and dist-only Hosting content verified.');
