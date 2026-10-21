import { readyUser } from '../services/auth.js';
import { configurationError } from '../services/firebase.js';
import { getSharedGame, saveMatchScore } from '../services/repository.js';
import { exposeActions, showPageError, enableStartupControls } from '../services/ui.js';
import { renderMatchSchedules, readScores } from '../ui/matches.js';

// Tokens stay in the URL fragment, which is not sent to Hosting or in referrers.
const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
let game = null;
let pollInterval = null;
let isSyncing = false;
let isLoading = false;

function status(message) { document.getElementById('syncStatus').textContent = message; }
function render() {
    renderMatchSchedules(document.getElementById('mainContent'), game?.schedules || [], { save: saveScore, edit: editMatch });
    document.getElementById('gameTitleBadge').textContent = game?.name || '協助計分';
}
function setBusy(value) {
    isSyncing = value;
    document.querySelectorAll('#mainContent button').forEach(button => { button.disabled = value; });
}
function stopPolling() { clearInterval(pollInterval); pollInterval = null; }
function startPolling() {
    if (!pollInterval && token && game && !document.hidden) pollInterval = setInterval(() => reloadGame(true), 10000);
}
function clearInaccessibleGame(message) {
    game = null;
    stopPolling();
    const box = document.createElement('div');
    box.className = 'state-box';
    box.textContent = message;
    document.getElementById('mainContent').replaceChildren(box);
}
async function reloadGame(quiet = false) {
    if (isSyncing || isLoading || !token) return;
    isLoading = true;
    if (!quiet) status('⏳ 載入比賽資料...');
    try {
        const incoming = await getSharedGame(token);
        if (!game || incoming.revision > game.revision) { game = incoming; render(); }
        status('✅ 已連線，每 10 秒更新');
        startPolling();
    } catch (error) {
        status(`❌ ${error.message}`);
        if (/permission-denied|not-found|unauthenticated|failed-precondition/.test(error.code || '')) {
            clearInaccessibleGame('分享連結已失效、撤銷或比賽已封存。請主辦人重新分享。');
        } else if (!game) clearInaccessibleGame('無法載入比賽，請確認連結及網路後重新整理。');
    } finally { isLoading = false; }
}
async function submitScore(scheduleId, matchId, score1, score2, isFinished) {
    if (isSyncing || !game) return;
    const schedule = game.schedules.find(item => item.id === scheduleId);
    if (isFinished && schedule?.mode === 'single-elimination' && score1 === score2) {
        alert('單敗淘汰賽不能平手，請輸入能分出勝負的比分。');
        return;
    }
    setBusy(true);
    status('☁️ 儲存比分中...');
    try {
        // The transaction changes only this match; concurrent scores remain intact.
        game = await saveMatchScore({ token, scheduleId, matchId, score1, score2, isFinished });
        render();
        status('✅ 比分已儲存');
    } catch (error) { status(`❌ 比分尚未儲存：${error.message}`); }
    finally { setBusy(false); }
}
async function saveScore(scheduleId, matchId) {
    try {
        const [score1, score2] = readScores(matchId);
        await submitScore(scheduleId, matchId, score1, score2, true);
    } catch (error) { alert(error.message); }
}
async function editMatch(scheduleId, matchId) { await submitScore(scheduleId, matchId, null, null, false); }
async function initialize() {
    try {
        const error = configurationError();
        if (error) throw new Error(error);
        if (!token) throw new Error('無效的分享連結，請主辦人重新分享。');
        await readyUser({ allowGuest: true });
        await reloadGame();
    } catch (error) { status(`❌ ${error.message}`); showPageError(error); }
    finally { enableStartupControls(); }
}
document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopPolling();
    else { reloadGame(true); startPolling(); }
});
window.addEventListener('pagehide', stopPolling);
exposeActions({ reloadGame });
initialize();
