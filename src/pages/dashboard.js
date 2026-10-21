import { readyUser, logout as clearSelection } from '../services/auth.js';
import {
    listGames, getGame, createGame as createGameRecord, archiveGame,
    listFrequentPlayers, saveFrequentPlayers,
} from '../services/repository.js';
import { writeGameCache, removeGameCache, gamesIndexKey, frequentPlayersKey } from '../services/cache.js';
import { el, exposeActions, showPageError } from '../services/ui.js';

let currentUser = null;
let gamesList = [];
let frequentPlayers = [];
let rosterRevision = 0;
let rosterReady = false;
let rosterBusy = false;

function errorMessage(error) {
    if (error?.code === 'functions/aborted' || error?.code === 'aborted') {
        return '資料已在其他裝置更新，請從雲端重新載入後再操作。';
    }
    return error?.message || '連線失敗，請稍後重試。';
}

function cacheValue(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Cache is optional. */ }
}

async function logout() {
    try {
        await clearSelection();
        window.location.href = 'index.html';
    } catch (error) { showPageError(error); }
}

async function loadGames() {
    const container = document.getElementById('gamesList');
    try {
        gamesList = await listGames();
        renderGames();
    } catch (error) {
        container.replaceChildren();
        const message = document.createElement('p');
        message.className = 'error-message';
        message.textContent = `❌ 無法讀取賽事：${errorMessage(error)}`;
        const retry = document.createElement('button');
        retry.className = 'btn-primary btn-sm';
        retry.textContent = '重新載入';
        retry.addEventListener('click', loadGames);
        container.append(message, retry);
    }
}

function renderGames() {
    cacheValue(gamesIndexKey(currentUser.uid), gamesList.map(({ id, name, date }) => ({ id, name, date })));
    const container = document.getElementById('gamesList');
    container.replaceChildren();
    if (gamesList.length === 0) {
        container.append(el('div', 'empty-state', '目前還沒有比賽紀錄喔！趕快在上方建立一場吧 🏸'));
        return;
    }
    gamesList.forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card';
        card.append(el('div', '', null, el('h3', '', game.name), el('p', 'game-date', `建立時間：${game.date || ''}`)));
        const actions = document.createElement('div');
        actions.className = 'game-actions';
        const enter = document.createElement('button');
        enter.className = 'btn-primary btn-enter-game';
        enter.textContent = '進入計分板';
        enter.addEventListener('click', () => enterGame(game.id, enter));
        const remove = document.createElement('button');
        remove.className = 'btn-danger';
        remove.textContent = '刪除';
        remove.addEventListener('click', () => deleteGame(game.id, game.name, remove));
        actions.append(enter, remove);
        card.append(actions);
        container.append(card);
    });
}

async function createGame() {
    if (!currentUser) return;
    const input = document.getElementById('newGameName');
    const name = input.value.trim();
    if (!name || name.length > 120) return alert('請輸入 1–120 字的比賽名稱。');
    const button = document.getElementById('createGameBtn');
    button.disabled = true;
    button.textContent = '⏳ 建立中...';
    try {
        const game = await createGameRecord(name);
        writeGameCache(currentUser.uid, game.id, game);
        window.location.href = `play.html?gameId=${encodeURIComponent(game.id)}`;
    } catch (error) {
        alert(`❌ 建立失敗：${errorMessage(error)}`);
    } finally {
        button.disabled = false;
        button.textContent = '➕ 新增並進入計分板';
    }
}

async function deleteGame(id, name, button) {
    if (!confirm(`確定要刪除「${name}」嗎？賽事會封存並保留雲端資料。`)) return;
    button.disabled = true;
    try {
        await archiveGame(id);
        removeGameCache(currentUser.uid, id);
        gamesList = gamesList.filter(game => game.id !== id);
        renderGames();
    } catch (error) {
        alert(`❌ 刪除失敗：${errorMessage(error)}`);
        button.disabled = false;
    }
}

function getGameRouteFromData(game) {
    const hasProgress = ['schedules', 'currentTeams', 'matches'].some(key => Array.isArray(game?.[key]) && game[key].length > 0);
    return hasProgress ? 'gamestart' : 'play';
}

async function enterGame(id, button) {
    button.disabled = true;
    try {
        // Always consult the server: a cached game may have been archived elsewhere.
        const game = await getGame(id);
        if (!game || game.deletedAt) throw new Error('這場比賽已不存在或已封存。');
        writeGameCache(currentUser.uid, id, game);
        window.location.href = `${getGameRouteFromData(game)}.html?gameId=${encodeURIComponent(id)}`;
    } catch (error) {
        alert(`❌ 無法開啟比賽：${errorMessage(error)}`);
        button.disabled = false;
    }
}

function setRosterBusy(busy) {
    rosterBusy = busy;
    document.querySelectorAll('.fp-add-form input, .fp-add-form select, .fp-add-form button, .fp-toolbar button, #fpList button, #fpList select')
        .forEach(element => { element.disabled = busy || !rosterReady; });
    // Reload remains available after an initial failure.
    document.getElementById('reloadFpButton').disabled = busy;
}

async function loadFrequentPlayers() {
    if (!currentUser || rosterBusy) return;
    setRosterBusy(true);
    const status = document.getElementById('fpSyncStatus');
    status.textContent = '⏳ 雲端同步中...';
    try {
        const result = await listFrequentPlayers();
        frequentPlayers = result.players;
        rosterRevision = result.revision;
        rosterReady = true;
        cacheValue(frequentPlayersKey(currentUser.uid), frequentPlayers);
        status.textContent = '✅ 已同步雲端';
        renderFpList();
    } catch (error) {
        rosterReady = false;
        status.textContent = `❌ ${errorMessage(error)}`;
        if (!frequentPlayers.length) document.getElementById('fpList').textContent = '名冊讀取失敗，請重新載入。';
    } finally { setRosterBusy(false); }
}

async function persistRoster(next, actionLabel) {
    if (!rosterReady || rosterBusy) return false;
    if (next.length > 200) { alert('常用選手名冊最多可存 200 位。'); return false; }
    setRosterBusy(true);
    const status = document.getElementById('fpSyncStatus');
    status.textContent = `⏳ ${actionLabel}同步中...`;
    try {
        const result = await saveFrequentPlayers(next, rosterRevision);
        frequentPlayers = result.players;
        rosterRevision = result.revision;
        cacheValue(frequentPlayersKey(currentUser.uid), frequentPlayers);
        status.textContent = `✅ 已${actionLabel}`;
        renderFpList();
        return true;
    } catch (error) {
        status.textContent = `❌ 未儲存：${errorMessage(error)}`;
        if (['functions/aborted', 'aborted'].includes(error?.code)) rosterReady = false;
        renderFpList();
        return false;
    } finally { setRosterBusy(false); }
}

function renderFpList() {
    const list = document.getElementById('fpList');
    list.replaceChildren();
    if (!frequentPlayers.length) {
        list.append(el('div', 'fp-empty', '尚無常用選手，請從上方新增或匯入 CSV 📋'));
        return;
    }
    frequentPlayers.forEach(player => {
        const row = document.createElement('div');
        row.className = 'fp-item';
        row.append(el('div', '', null, el('div', 'fp-name', player.name), el('div', 'fp-meta', `${player.gender} · 實力 Lv.${player.level}`)));
        const actions = document.createElement('div');
        actions.className = 'fp-actions';
        const select = document.createElement('select');
        select.className = 'level-select';
        select.setAttribute('aria-label', `${player.name}的實力級數`);
        for (let level = 1; level <= 18; level++) select.add(new Option(String(level), String(level), false, Number(player.level) === level));
        select.addEventListener('change', () => updateFpLevel(player.id, Number(select.value)));
        const remove = document.createElement('button');
        remove.className = 'btn-sm-danger';
        remove.textContent = '刪除';
        remove.addEventListener('click', () => removeFrequentPlayer(player.id));
        actions.append(select, remove);
        row.append(actions);
        list.append(row);
    });
}

function validPlayer({ name, gender, level }) {
    return name.length > 0 && name.length <= 80 && ['男', '女'].includes(gender) && Number.isInteger(level) && level >= 1 && level <= 18;
}

async function addFrequentPlayer() {
    const player = {
        id: `FP_${crypto.randomUUID()}`,
        name: document.getElementById('fpName').value.trim(),
        gender: document.getElementById('fpGender').value,
        level: Number(document.getElementById('fpLevel').value),
    };
    if (!validPlayer(player)) return alert('請填寫 1–80 字姓名、性別與 1–18 級實力。');
    if (frequentPlayers.some(existing => existing.name === player.name)) return alert('此選手已在常用名單中！');
    if (await persistRoster([...frequentPlayers, player], '新增')) {
        document.getElementById('fpName').value = '';
        document.getElementById('fpLevel').value = '';
    }
}

async function removeFrequentPlayer(id) {
    if (!confirm('確定要移除此選手嗎？')) return;
    await persistRoster(frequentPlayers.filter(player => String(player.id) !== String(id)), '刪除');
}

async function updateFpLevel(id, level) {
    if (!Number.isInteger(level) || level < 1 || level > 18) { renderFpList(); return; }
    await persistRoster(frequentPlayers.map(player => String(player.id) === String(id) ? { ...player, level } : player), '級數更新');
}

async function handleFpCsvImport(event) {
    const input = event.target;
    const file = input.files[0];
    if (!file) return;
    try {
        if (!rosterReady || rosterBusy) return;
        if (file.size > 1024 * 1024) throw new Error('CSV 檔案不可超過 1 MB。');
        const contents = await file.text();
        if (!rosterReady || rosterBusy) return;
        const next = [...frequentPlayers];
        let count = 0;
        for (const line of contents.split(/\r?\n/)) {
            const columns = line.replace(/^\uFEFF/, '').trim().split(',');
            if (columns.length < 3) continue;
            const player = { id: `FP_${crypto.randomUUID()}`, name: columns[0].trim(), gender: columns[1].trim(), level: Number(columns[2].trim()) };
            if (!validPlayer(player) || next.some(existing => existing.name === player.name)) continue;
            next.push(player);
            count++;
        }
        if (!count) return alert('沒有可匯入的新選手，請檢查姓名、性別及 1–18 級實力。');
        if (await persistRoster(next, `匯入 ${count} 位選手`)) alert(`✅ 已匯入 ${count} 位選手！`);
    } catch (error) { alert(`❌ 匯入失敗：${errorMessage(error)}`); }
    finally { input.value = ''; }
}

exposeActions({ logout, createGame, loadFrequentPlayers, addFrequentPlayer, handleFpCsvImport });

async function initialize() {
    document.querySelectorAll('button, input, select').forEach(element => { element.disabled = true; });
    try {
        currentUser = await readyUser();
        if (!currentUser) { window.location.replace('index.html'); return; }
        document.getElementById('displayUser').textContent = currentUser.name || '已選取使用者';
        document.querySelectorAll('button, input, select').forEach(element => { element.disabled = false; });
        await Promise.all([loadGames(), loadFrequentPlayers()]);
    } catch (error) {
        showPageError(error);
        document.getElementById('gamesList').textContent = '無法載入，請先完成 Firebase 設定。';
        document.getElementById('fpList').textContent = '尚未連線。';
    }
}

initialize();
