import { readyUser } from '../services/auth.js';
import { getGame, saveGame, listFrequentPlayers, saveFrequentPlayers } from '../services/repository.js';
import { writeGameCache, gamesIndexKey, frequentPlayersKey } from '../services/cache.js';
import { el, exposeActions, showPageError } from '../services/ui.js';
import { parsePlayersCsv, validPlayerInput } from '../domain/players.js';
import { attachPlayerDrag } from '../domain/player-drag.js';

const GAME_ID = new URLSearchParams(window.location.search).get('gameId');
let currentUser = null;
let gameData = {};
let gameRevision = 0;
let localVersion = 0;
let initialized = false;
let syncError = '';
let fpRevision = 0;
let fpSaving = false;
let fpPending = false;
let fpSavePromise = Promise.resolve(false);

const MAX_PLAYERS = 20;
let players = [], frequentPlayers = [], hasFetchedFp = false, csvImportTarget = 'current';
let pendingTeams = [], pendingRestPlayer = null;
let playerSyncInFlight = false;
let pendingPlayerSync = false;
let playerSyncPromise = Promise.resolve(true);


function initGameTitle() {
    try { const idx = JSON.parse(localStorage.getItem(gamesIndexKey(currentUser))||'[]'); const f = idx.find(g=>g.id===GAME_ID); document.getElementById('gameTitle').innerText = f ? `🏸 ${f.name}` : '🏸 建立賽程'; } catch(e) {}
}

function getStorage() { return gameData; }
function setStorage(patch) {
    gameData = { ...gameData, ...patch };
    localVersion += 1;
    writeGameCache(currentUser, GAME_ID, gameData);
}


function normalizeGameData(data) {
    return {
        players: Array.isArray(data?.players) ? data.players : [],
        currentTeams: Array.isArray(data?.currentTeams) ? data.currentTeams : [],
        schedules: Array.isArray(data?.schedules) ? data.schedules : [],
        matchMode: data?.matchMode || 'single',
        pendingRestMsg: data?.pendingRestMsg || '',
        savedTeamDraft: Array.isArray(data?.savedTeamDraft) ? data.savedTeamDraft : [],
        savedDraftMode: data?.savedDraftMode || '',
        savedDraftRestMsg: data?.savedDraftRestMsg || '',
        savedDraftRestPlayer: data?.savedDraftRestPlayer || null,
        savedDraftUpdatedAt: data?.savedDraftUpdatedAt || null,
        lastUpdated: data?.lastUpdated || null,
        needsInitialSchedule: !!data?.needsInitialSchedule
    };
}

async function loadPlayersFromCloud() {
    const data = await getGame(GAME_ID);
    if (!data || data.deletedAt) throw new Error('找不到這場比賽，請回到賽程管理重新選擇。');
    gameData = data;
    gameRevision = data.revision;
    localVersion = 0;
    syncError = '';
    players = data.players || [];
    writeGameCache(currentUser, GAME_ID, data);
    document.getElementById('gameTitle').textContent = `🏸 ${data.name || '建立賽程'}`;
    updatePlayerUI();
    updateDraftUI();
    setPlayerSyncStatus('✅ 已載入雲端資料');
}

async function reloadGame() {
    if (playerSyncInFlight) return alert('請等候目前儲存完成。');
    if (syncError && !confirm('重新載入會捨棄尚未儲存的本機變更，是否繼續？')) return;
    try {
        await loadPlayersFromCloud();
        cancelTeamEdit();
    } catch (error) {
        setPlayerSyncStatus(`❌ ${error.message || '無法載入雲端資料'}`, true);
    }
}

function updateDraftUI() {
    const data = normalizeGameData(getStorage());
    const btn = document.getElementById('btnLoadDraft');
    const status = document.getElementById('draftStatus');
    const hasDraft = data.savedTeamDraft.length > 0;
    if (btn) btn.hidden = !hasDraft;
    if (!status) return;
    if (hasDraft) {
        const modeLabel = data.savedDraftMode === 'round-robin' ? '循環賽' : '單輪賽';
        status.innerText = `已儲存分組草稿（${modeLabel}）`;
    } else {
        status.innerText = '尚未儲存分組草稿';
    }
}

function setPlayerSyncStatus(message, isError = false) {
    const el = document.getElementById('playerSyncStatus');
    if (!el) return;
    el.innerText = message || '';
    el.style.color = isError ? 'var(--danger)' : 'var(--text-muted)';
}

async function savePlayersToStorage(options = {}) {
    const { awaitSync = true, silent = false } = options;
    setStorage({ players, lastUpdated: new Date().toISOString() });
    const success = await requestPlayerSync({ silent });
    if (awaitSync && !success && !silent) {
        alert(`⚠️ ${syncError || '球員名單尚未儲存，請稍後重試。'}`);
    }
    return success;
}

function buildGamePayload() {
    return { ...normalizeGameData(getStorage()), players, lastUpdated: new Date().toISOString() };
}

async function requestPlayerSync(options = {}) {
    const { silent = false } = options;
    pendingPlayerSync = true;
    if (playerSyncInFlight) return playerSyncPromise;

    playerSyncInFlight = true;
    playerSyncPromise = (async () => {
        let allSynced = true;
        if (!silent) setPlayerSyncStatus('☁️ 同步中...');
        try {
            while (pendingPlayerSync) {
                pendingPlayerSync = false;
                const synced = await syncPlayersToCloud();
                if (!synced) allSynced = false;
            }
        } finally {
            playerSyncInFlight = false;
            if (!silent) {
                if (allSynced) {
                    setPlayerSyncStatus(`✅ 已同步（${new Date().toLocaleTimeString('zh-TW', { hour12: false })}）`);
                    setTimeout(() => {
                        const el = document.getElementById('playerSyncStatus');
                        if (el && el.innerText.startsWith('✅')) setPlayerSyncStatus('');
                    }, 2500);
                } else {
                    setPlayerSyncStatus(`❌ ${syncError || '同步失敗，變更僅留在此裝置'}`, true);
                }
            }
        }
        return allSynced;
    })();
    return playerSyncPromise;
}

async function syncPlayersToCloud() {
    if (!initialized) return false;
    const version = localVersion;
    const payload = structuredClone(buildGamePayload());
    try {
        const saved = await saveGame(GAME_ID, payload, gameRevision);
        gameRevision = saved.revision;
        syncError = '';
        if (localVersion === version) gameData = saved;
        else gameData = { ...gameData, revision: saved.revision };
        writeGameCache(currentUser, GAME_ID, gameData);
        return true;
    } catch (error) {
        syncError = String(error.code || '').includes('aborted')
            ? '雲端資料已由其他裝置更新。請重新載入雲端資料後再編輯；本機變更尚未儲存。'
            : (error.message || '無法儲存，變更僅留在此裝置。');
        pendingPlayerSync = false;
        return false;
    }
}

async function addPlayer(name=null, gender=null, level=null) {
    if (players.length >= MAX_PLAYERS) return false;
    const n = name||document.getElementById('playerName').value.trim();
    const g = gender||document.getElementById('playerGender').value;
    const l = level||parseInt(document.getElementById('playerLevel').value);
    if (!validPlayerInput(n, g, l) || players.some(p => p.name === n)) { alert('請輸入姓名（最多 80 字）、性別與 1–18 級實力。'); return false; }
    players.push({id: crypto.randomUUID(), name:n, gender:g, level:l});
    if (!name) { document.getElementById('playerName').value=''; document.getElementById('playerLevel').value=''; }
    updatePlayerUI();
    await savePlayersToStorage();
    return true;
}
const idsEqual = (a, b) => String(a) === String(b);
async function removePlayer(id) {
    players=players.filter(p=>!idsEqual(p.id, id));
    updatePlayerUI();
    await savePlayersToStorage();
}
function updatePlayerUI() {
    const list = document.getElementById('playerList');
    list.replaceChildren(...players.map(p => {
        const remove = el('button', 'btn-danger', '✕');
        remove.type = 'button'; remove.setAttribute('aria-label', `移除${p.name}`);
        remove.addEventListener('click', () => removePlayer(p.id));
        return el('div', 'player-tag', null, el('div', 'player-info', null,
            el('span', 'player-name', p.name), el('span', 'player-details', `${p.gender} | 等級 ${p.level}`)), remove);
    }));
    document.getElementById('playerCount').innerText = players.length;
    document.getElementById('progressBar').style.width = `${(players.length / MAX_PLAYERS) * 100}%`;
}

async function generateMockPlayers() {
    for (const n of ["大谷","林書豪","戴資穎","周天成","李洋","王齊麟","安洗瑩","陳雨菲"].slice(0, 20-players.length)) {
        await addPlayer(n+(players.some(p=>p.name===n)?'2':''), "男", Math.floor(Math.random()*18)+1);
    }
}

// ── 分組 ──
function generateSchedule(mode) {
    if (players.length < 4) return alert("球員不足，請至少加入4名球員！");
    let pool = [...players].sort(()=>Math.random()-0.5).sort((a,b)=>b.level-a.level);
    pendingRestPlayer = null;
    if (pool.length%2!==0) pendingRestPlayer = pool.splice(Math.floor(pool.length/2),1)[0];
    pendingTeams = [];
    for (let i=0; i<pool.length/2; i++) pendingTeams.push({id:`Team_${Date.now()}_${i}`, mode, p1:pool[i], p2:pool[pool.length-1-i]});
    document.getElementById('teamEditorContainer').style.display = 'block';
    renderTeamEditor();
}
function cancelTeamEdit() { document.getElementById('teamEditorContainer').style.display='none'; pendingTeams=[]; pendingRestPlayer=null; }

function renderTeamEditor() {
    const grid = document.getElementById('teamsDragGrid');
    grid.replaceChildren(...pendingTeams.map((team, index) => {
        const node = el('div', 'team-slot', null,
            el('div', 'team-slot-label team-slot-heading', null, el('span', '', `隊伍 ${index + 1}`),
                el('span', 'team-level-badge', `Lv.${(team.p1?.level || 0) + (team.p2?.level || 0)}`)),
            el('div', 'team-slot-players', null, renderDragPlayer(team.p1, team.id, 'p1'), renderDragPlayer(team.p2, team.id, 'p2')));
        node.id = `slot-${team.id}`; return node;
    }));
    const target = pendingRestPlayer ? renderDragPlayer(pendingRestPlayer, 'bench', 'bench') : el('div', 'bench-drop-target', '拖曳到此休息');
    target.dataset.teamId = 'bench'; target.dataset.slot = 'bench';
    grid.append(el('div', 'team-slot bench-slot', null, el('div', 'team-slot-label', '😴 休息區'), el('div', 'team-slot-players', null, target)));
}
function renderDragPlayer(player, teamId, slot) {
    if (!player) return null;
    const node = el('div', 'drag-player', null, el('div', '', null,
        el('div', 'drag-player-name', player.name), el('div', 'drag-player-info', `${player.gender} · Lv.${player.level}`)), el('span', 'drag-handle', '⠿'));
    Object.assign(node.dataset, { playerId: String(player.id), teamId: String(teamId), slot });
    return node;
}

function swapPlayers(srcTeamId, srcSlot, dstTeamId, dstSlot) {
    if (srcTeamId === dstTeamId && srcSlot === dstSlot) return;
    const isSrcBench = srcTeamId === 'bench', isDstBench = dstTeamId === 'bench';
    const srcPlayer = isSrcBench ? pendingRestPlayer : (pendingTeams.find(t=>t.id===srcTeamId)||{})[srcSlot];
    const dstPlayer = isDstBench ? pendingRestPlayer : (pendingTeams.find(t=>t.id===dstTeamId)||{})[dstSlot];
    if (!srcPlayer) return;
    if (isSrcBench) pendingRestPlayer = dstPlayer || null;
    else { const st = pendingTeams.find(t=>t.id===srcTeamId); if (st) st[srcSlot] = dstPlayer || null; }
    if (isDstBench) pendingRestPlayer = srcPlayer;
    else { const dt = pendingTeams.find(t=>t.id===dstTeamId); if (dt) dt[dstSlot] = srcPlayer; }
    renderTeamEditor();
}

async function saveTeamDraft() {
    if (pendingTeams.length === 0) {
        alert('⚠️ 請先產生分組後再儲存草稿。');
        return;
    }
    const draftMode = pendingTeams[0]?.mode || 'single';
    const draftRestMsg = pendingRestPlayer ? `單數球員：${pendingRestPlayer.name} (本輪休息)` : '';
    setStorage({
        players,
        savedTeamDraft: pendingTeams,
        savedDraftMode: draftMode,
        savedDraftRestMsg: draftRestMsg,
        savedDraftRestPlayer: pendingRestPlayer,
        savedDraftUpdatedAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString()
    });
    const synced = await savePlayersToStorage({ awaitSync: true });
    if (synced) {
        updateDraftUI();
        alert('✅ 已儲存分組草稿，可之後再載入。');
    }
}

function loadSavedTeamDraft() {
    const data = normalizeGameData(getStorage());
    if (!data.savedTeamDraft.length) {
        alert('ℹ️ 目前沒有已儲存的分組草稿。');
        return;
    }
    pendingTeams = structuredClone(data.savedTeamDraft);
    pendingRestPlayer = data.savedDraftRestPlayer || null;
    document.getElementById('teamEditorContainer').style.display = 'block';
    renderTeamEditor();
}

// ── 確認分組 → 寫入 storage → 跳到 gamestart ──
async function confirmTeamsAndStart(mode) {
    if (pendingTeams.length < 2 || pendingTeams.some(team => !team.p1 || !team.p2)) return alert('請確認每一隊都有兩位球員，再開始比賽。');
    const currentTeams = pendingTeams.filter(t=>t.p1&&t.p2).map(t=>({id:t.id, name1:t.p1.name, name2:t.p2.name, totalLevel:t.p1.level+t.p2.level}));
    const restMsg = pendingRestPlayer ? `單數球員：${pendingRestPlayer.name} (本輪休息)` : "";
    setStorage({ players, currentTeams, matchMode: mode, schedules: [], pendingRestMsg: restMsg, savedTeamDraft: [], savedDraftMode: '', savedDraftRestMsg: '', savedDraftRestPlayer: null, savedDraftUpdatedAt: null, needsInitialSchedule: true, lastUpdated: new Date().toISOString() });
    updateDraftUI();
    const synced = await requestPlayerSync();
    if (!synced) {
        alert(`⚠️ ${syncError || '尚未儲存成功，請稍後重試。'}`);
        return;
    }
    window.location.href = `gamestart.html?gameId=${encodeURIComponent(GAME_ID)}&init=1`;
}

// ── Modal ──
function openLevelModal() { document.getElementById('levelModal').style.display='block'; }
function closeLevelModal() { document.getElementById('levelModal').style.display='none'; }
function openFrequentPlayersModal() { document.getElementById('frequentPlayersModal').style.display = 'block'; if (!hasFetchedFp) fetchFrequentPlayers(); else renderFrequentPlayersList(); }
function closeFrequentPlayersModal() { document.getElementById('frequentPlayersModal').style.display='none'; }
window.onclick = e => { if(e.target==document.getElementById('levelModal')) closeLevelModal(); if(e.target==document.getElementById('frequentPlayersModal')) closeFrequentPlayersModal(); };

// ── CSV ──
function triggerCSVImport(t) { csvImportTarget=t; document.getElementById('csvInput').click(); }
function handleCSVImport(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 1024 * 1024) { alert('CSV 檔案請小於 1 MB。'); event.target.value = ''; return; }
    const reader = new FileReader();
    reader.onerror = () => alert('無法讀取 CSV 檔案。');
    reader.onload = async eventData => {
        if (csvImportTarget === 'frequent' && !hasFetchedFp) { alert('請先成功載入常用選手名冊。'); return; }
        const target = csvImportTarget === 'current' ? players : frequentPlayers;
        const maximum = csvImportTarget === 'current' ? MAX_PLAYERS : 200;
        const additions = parsePlayersCsv(eventData.target.result, target, maximum);
        target.push(...additions);
        let saved = true;
        if (csvImportTarget === 'current') {
            updatePlayerUI();
            if (additions.length) saved = await savePlayersToStorage();
        } else {
            renderFrequentPlayersList();
            if (additions.length) saved = await saveFrequentPlayersToCloud();
        }
        if (saved) alert(additions.length ? `✅ 已匯入 ${additions.length} 位選手` : 'ℹ️ 無新增選手，請檢查格式、級數或是否重複。');
        event.target.value = '';
    };
    reader.readAsText(file);
}

// 常用選手以雲端 revision 保護跨裝置更新。
function saveFrequentPlayersLocally() {
    try { localStorage.setItem(frequentPlayersKey(currentUser), JSON.stringify({ players: frequentPlayers, revision: fpRevision })); } catch { /* The cloud remains authoritative. */ }
}
async function fetchFrequentPlayers() {
    if (fpSaving) return;
    const status = document.getElementById('fpSyncStatus');
    status.textContent = '⏳ 載入中...';
    try {
        const saved = await listFrequentPlayers();
        frequentPlayers = saved.players;
        fpRevision = saved.revision;
        hasFetchedFp = true;
        saveFrequentPlayersLocally();
        status.textContent = '✅ 已載入';
        renderFrequentPlayersList();
    } catch (error) {
        status.textContent = `❌ ${error.message || '名冊載入失敗，請重新載入。'}`;
    }
}
async function saveFrequentPlayersToCloud() {
    if (!hasFetchedFp) return false;
    fpPending = true;
    if (fpSaving) return fpSavePromise;
    fpSaving = true;
    const status = document.getElementById('fpSyncStatus');
    status.textContent = '⏳ 儲存中...';
    fpSavePromise = (async () => {
        try {
            while (fpPending) {
                fpPending = false;
                const saved = await saveFrequentPlayers(structuredClone(frequentPlayers), fpRevision);
                fpRevision = saved.revision;
            }
            saveFrequentPlayersLocally();
            status.textContent = '✅ 已儲存';
            return true;
        } catch (error) {
            fpPending = false;
            status.textContent = String(error.code || '').includes('aborted')
                ? '❌ 名冊已在其他裝置更新，請重新載入後再編輯。'
                : `❌ ${error.message || '儲存失敗，變更尚未同步。'}`;
            return false;
        } finally { fpSaving = false; }
    })();
    return fpSavePromise;
}

function renderFrequentPlayersList() {
    const list = document.getElementById('frequentPlayersList');
    if (!hasFetchedFp) return;
    list.replaceChildren();
    if (!frequentPlayers.length) { list.append(el('div', 'fp-empty', '尚無常用選手')); return; }
    frequentPlayers.forEach(player => {
        const inGame = players.some(item => item.name === player.name);
        const checkbox = el('input', 'fp-checkbox');
        Object.assign(checkbox, { type: 'checkbox', value: String(player.id), disabled: inGame, checked: inGame });
        const description = el('div', '', null, el('span', 'fp-player-name', player.name), el('span', 'player-details', ` (${player.gender})`));
        if (inGame) description.append(el('span', 'fp-added-note', ' 已在名單'));
        const label = el('label', `fp-label${inGame ? ' fp-already-added' : ''}`, null, checkbox, description);
        const select = el('select', 'level-select'); select.setAttribute('aria-label', `${player.name}的實力級數`);
        for (let level = 1; level <= 18; level++) select.add(new Option(String(level), String(level), false, player.level === level));
        select.addEventListener('change', () => updateFpLevel(player.id, select.value));
        const remove = el('button', 'btn-danger', '刪除');
        remove.addEventListener('click', () => removeFrequentPlayer(player.id));
        list.append(el('div', 'fp-item', null, label, el('div', 'fp-row-actions', null, select, remove)));
    });
}

async function updateFpLevel(id,val) { const p=frequentPlayers.find(p=>idsEqual(p.id, id)); if(!p) return; p.level=parseInt(val); saveFrequentPlayersLocally(); document.getElementById('fpSyncStatus').innerText="⏳ 同步中..."; await saveFrequentPlayersToCloud(); }
async function addFrequentPlayer() {
    const name=document.getElementById('fpName').value.trim(), gender=document.getElementById('fpGender').value, levelVal=document.getElementById('fpLevel').value;
    if (!hasFetchedFp) return alert('請先成功載入常用選手名冊。');
    if (!validPlayerInput(name, gender, Number(levelVal))) return alert('請輸入姓名（最多 80 字）、性別與 1–18 級實力。');
    if (frequentPlayers.length >= 200) return alert('常用選手名冊最多 200 位。');
    if(frequentPlayers.some(p=>p.name===name)) return alert('此選手已在常用名單！');
    frequentPlayers.push({id:crypto.randomUUID(),name,gender,level:parseInt(levelVal)});
    saveFrequentPlayersLocally(); renderFrequentPlayersList();
    document.getElementById('fpName').value=''; document.getElementById('fpLevel').value='';
    document.getElementById('btnAddFp').disabled=true; await saveFrequentPlayersToCloud(); document.getElementById('btnAddFp').disabled=false;
}
async function removeFrequentPlayer(id) {
    if(!confirm('確定要移除此選手嗎？')) return;
    frequentPlayers=frequentPlayers.filter(p=>!idsEqual(p.id, id)); saveFrequentPlayersLocally(); renderFrequentPlayersList();
    document.getElementById('fpSyncStatus').innerText="⏳ 刪除同步中..."; await saveFrequentPlayersToCloud();
}
async function addSelectedFrequentPlayers() {
    let addedCount = 0;
    document.querySelectorAll('.fp-checkbox:checked:not(:disabled)').forEach(cb=>{
        const fp=frequentPlayers.find(p=>idsEqual(p.id, cb.value));
        if(fp&&!players.some(p=>p.name===fp.name)&&players.length<MAX_PLAYERS){
            players.push({id: crypto.randomUUID(), name: fp.name, gender: fp.gender, level: fp.level});
            addedCount++;
        }
    });
    updatePlayerUI();
    if (addedCount > 0) await savePlayersToStorage();
    closeFrequentPlayersModal();
}


exposeActions({ addPlayer, removePlayer, generateMockPlayers, generateSchedule, cancelTeamEdit,
saveTeamDraft, loadSavedTeamDraft, confirmTeamsAndStart, openLevelModal, closeLevelModal,
openFrequentPlayersModal, closeFrequentPlayersModal, triggerCSVImport, handleCSVImport,
fetchFrequentPlayers, updateFpLevel, addFrequentPlayer, removeFrequentPlayer,
addSelectedFrequentPlayers, reloadGame });

attachPlayerDrag(document.getElementById('teamsDragGrid'), swapPlayers);

// Modules run after HTML parsing. Disable controls until authentication and cloud data are ready.
const startupControls = [...document.querySelectorAll('button, input, select')];
startupControls.forEach(control => { control.disabled = true; });
try {
const user = await readyUser();
if (!user) window.location.replace('index.html');
else {
    if (!GAME_ID) throw new Error('缺少比賽編號，請從賽程管理選擇比賽。');
    currentUser = user.uid;
    initGameTitle();
    await loadPlayersFromCloud();
    initialized = true;
    startupControls.forEach(control => { control.disabled = false; });
}
} catch (error) {
showPageError(error);
setPlayerSyncStatus(error.message || '初始化失敗，請重新整理。', true);
}
