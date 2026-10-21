import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { STATE_KEYS, validateState, validatePlayers } from '../src/domain/validation.js';

// Password records in users/ are deliberately never opened by this tool.
export function normalizeLegacyGame(raw) {
  const state = Object.fromEntries(STATE_KEYS.filter(key => raw[key] !== undefined).map(key => [key, raw[key]]));
  if (!state.schedules && Array.isArray(raw.matches) && raw.matches.length) {
    state.schedules = [{ id: 1, mode: raw.matchMode || 'single', matches: raw.matches,
      restMsg: typeof raw.restingInfo === 'string' ? raw.restingInfo : '' }];
    state.currentTeams ||= [...new Map(raw.matches.flatMap(match => [match.team1, match.team2])
      .filter(Boolean).map(team => [String(team.id), team])).values()];
  }
  if (!state.pendingRestMsg && typeof raw.restingInfo === 'string') state.pendingRestMsg = raw.restingInfo;
  return validateState(state);
}
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
async function optionalJson(path) {
  try { return await readJson(path); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function planMigration(source, mapping) {
  if (!mapping || Array.isArray(mapping) || typeof mapping !== 'object') throw new Error('Mapping 必須是舊名稱到 profileId 的 JSON 物件。');
  const root = await realpath(source);
  const entries = [];
  for (const [legacyName, profileId] of Object.entries(mapping)) {
    if (!legacyName || ['.', '..'].includes(legacyName) || /[/\\]/.test(legacyName)
      || !/^[A-Za-z0-9_-]{1,100}$/.test(profileId)) throw new Error('Mapping 含不合法的名稱或 profileId。');
    const directory = await realpath(resolve(root, legacyName));
    if (!directory.startsWith(root + sep)) throw new Error('來源資料夾必須位於 --source 中。');
    const index = await optionalJson(resolve(directory, 'games_index.json')) || [];
    if (!Array.isArray(index)) throw new Error('games_index 必須是陣列。');
    const seen = new Set();
    for (const item of index) {
      const id = String(item.id);
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(id)) throw new Error('舊比賽 ID 不合法。');
      if (seen.has(id)) continue;
      seen.add(id);
      const raw = await optionalJson(resolve(directory, `game_${id}.json`))
        || await optionalJson(resolve(directory, 'games', `${id}.json`));
      const state = normalizeLegacyGame(raw || {});
      entries.push({ profileId, path: `profiles/${profileId}/games/${id}`,
        data: { id, name: String(item.name || '未命名比賽').slice(0, 120), date: String(item.date || ''),
          ...state, revision: 1, deletedAt: null } });
    }
    const roster = await optionalJson(resolve(directory, 'frequent_players.json'));
    if (roster) entries.push({ profileId, path: `profiles/${profileId}/settings/frequentPlayers`,
      data: { players: validatePlayers(roster, { max: 200 }), revision: 1 } });
  }
  if (new Set(entries.map(entry => entry.path)).size !== entries.length) throw new Error('多個來源映射到相同目的文件，請分開遷移。');
  return entries;
}
export async function writeMigration(entries, database, now = () => new Date()) {
  let created = 0, skipped = 0;
  for (const entry of entries) {
    const result = await database.runTransaction(async transaction => {
      const profile = await transaction.get(database.doc(`profiles/${entry.profileId}`));
      if (!profile.exists) throw new Error('目的使用者不存在，請先在網站建立使用者。');
      const reference = database.doc(entry.path);
      if ((await transaction.get(reference)).exists) return false;
      const date = now();
      const data = { ...entry.data, updatedAt: date };
      if (entry.path.includes('/games/')) {
        // Legacy IDs were generated with Date.now(); retain their chronology
        // instead of sorting all imported games by this migration's write time.
        data.createdAt = /^\d{13}$/.test(String(entry.data.id))
          ? new Date(Number(entry.data.id)) : date;
        data.lastUpdated = date.toISOString();
      }
      transaction.create(reference, data);
      return true;
    });
    if (result) created++; else skipped++;
  }
  return { created, skipped };
}
export function parseArgs(args) {
  const options = { write: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--write') options.write = true;
    else if (['--source', '--map', '--project'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) {
      options[args[i].slice(2)] = args[++i];
    } else throw new Error('支援參數：--source DIR --map FILE [--project PROJECT_ID] [--write]');
  }
  if (!options.source || !options.map || (options.write && !options.project)) throw new Error('必須提供 --source、--map；--write 另需 --project。');
  return options;
}
async function main() {
  const options = parseArgs(process.argv.slice(2));
  const entries = await planMigration(options.source, await readJson(options.map));
  console.log(`已驗證 ${entries.length} 份目的文件。`);
  if (!options.write) { console.log('Dry-run：未連線 Firebase、未寫入資料。加上 --project 與 --write 才會執行。'); return; }
  const { initializeApp, applicationDefault, deleteApp } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const app = initializeApp({ projectId: options.project, credential: applicationDefault() });
  const result = await writeMigration(entries, getFirestore(app));
  console.log(`已建立 ${result.created} 份文件，略過 ${result.skipped} 份既有文件；來源未修改。`);
  await deleteApp(app);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(() => { console.error('遷移失敗：請檢查參數、資料格式、目的使用者及管理員權限。來源未修改；已匯入文件可安全重跑。'); process.exitCode = 1; });
}
