import { readyUser } from '../services/auth.js';
import { configurationError } from '../services/firebase.js';
import { getGame, watchGame, saveGame, saveMatchScore } from '../services/repository.js';
import { writeGameCache, scoreboardResultKey } from '../services/cache.js';
import { el, exposeActions, showPageError, enableStartupControls } from '../services/ui.js';
import { buildStandingsTableRows, buildSingleEliminationSchedule } from '../domain/tournament.js';
import { renderMatchSchedules, readScores } from '../ui/matches.js';

const GAME_ID = new URLSearchParams(window.location.search).get('gameId');
let currentUser = null;
let players = [], currentTeams = [], schedules = [], matchMode = 'single', pendingRestMsg = '', needsInitialSchedule = false;
let currentGame = null;
let revision = 0;
let isSyncing = false;
let hasUnsavedChanges = false;
let stopWatching = null;
let pendingRemote = null;
const scoreboardSessions = new Map();
let scoreQueue = Promise.resolve();

function status(message) { document.getElementById('syncStatus').textContent = message; }
function snapshot() { return { ...currentGame, players, currentTeams, schedules, matchMode, pendingRestMsg, needsInitialSchedule }; }
function saveStorage() {
    hasUnsavedChanges = true;
    writeGameCache(currentUser.uid, GAME_ID, snapshot());
}
function setBusy(value) {
    isSyncing = value;
    document.querySelectorAll('#rematchContainer button, #regroupModal button, #schedulesWrapper button, #btnSync').forEach(button => { button.disabled = value; });
}
function canChangeStructure() {
    if (!currentGame || isSyncing || hasUnsavedChanges) {
        status('請先完成儲存；若有衝突，請重新載入雲端資料。');
        return false;
    }
    return true;
}
function applyGame(game) {
    if (!game || game.deletedAt) throw new Error('此比賽不存在或已封存。');
    currentGame = structuredClone(game);
    revision = game.revision;
    players = game.players || [];
    currentTeams = game.currentTeams || [];
    schedules = game.schedules || [];
    matchMode = game.matchMode || 'single';
    pendingRestMsg = game.pendingRestMsg || '';
    needsInitialSchedule = !!game.needsInitialSchedule;
    document.getElementById('gameTitle').textContent = `🏸 ${game.name || '賽程計分'}`;
    writeGameCache(currentUser.uid, GAME_ID, game);
    renderAll();
}
async function reloadGame() {
    if (isSyncing) return;
    if (hasUnsavedChanges && !confirm('重新載入會放棄本頁尚未同步的變更，是否繼續？')) return;
    status('⏳ 載入雲端資料...');
    try {
        const game = await getGame(GAME_ID);
        applyGame(game);
        hasUnsavedChanges = false;
        status('✅ 已載入雲端資料');
    } catch (error) { status(`❌ ${error.message}`); }
}
function startWatching() {
    if (stopWatching || !currentUser || !currentGame) return;
    stopWatching = watchGame(GAME_ID, game => {
        if (!game || game.deletedAt) {
            stopWatching?.(); stopWatching = null;
            currentGame = null;
            setBusy(true);
            status('此比賽已封存或無法存取。');
            return;
        }
        if (game.revision <= revision) return;
        if (isSyncing || hasUnsavedChanges) {
            pendingRemote = game;
            if (!isSyncing) status('⚠️ 雲端已有更新；請先重新載入，避免覆蓋他人修改。');
            return;
        }
        applyGame(game);
        status('🔄 已接收雲端更新');
    }, error => status(`❌ 即時同步中斷：${error.message}`));
}
async function initialize() {
    try {
        const error = configurationError();
        if (error) throw new Error(error);
        if (!GAME_ID) throw new Error('缺少比賽 ID，請回賽程管理選擇比賽。');
        currentUser = await readyUser();
        if (!currentUser) { window.location.replace('index.html'); return; }
        // Read the server before writing; local cache is only for recovery.
        const game = await getGame(GAME_ID);
        applyGame(game);
        if (!schedules.length && currentTeams.length && needsInitialSchedule) {
            generateMatchesForCurrentTeams(pendingRestMsg);
        } else if (!schedules.length && !currentTeams.length && players.length) {
            window.location.replace(`play.html?gameId=${encodeURIComponent(GAME_ID)}`);
            return;
        }
        enableStartupControls();
        setBusy(isSyncing);
        startWatching();
        if (!isSyncing) status('✅ 已連線');
    } catch (error) {
        status(`❌ ${error.message}`);
        showPageError(error);
    }
}
    function generateMatchesForCurrentTeams(restPlayersMsg="") {
        if (!canChangeStructure()) return;
        const newScheduleId = schedules.length + 1;
        const newMatches = [];
        const restMsgArr = [];
        if (restPlayersMsg) restMsgArr.push(restPlayersMsg);

        if (matchMode === 'single') {
            const tempTeams = [...currentTeams];
            if (tempTeams.length % 2 !== 0) {
                const restingTeam = tempTeams.splice(Math.floor(Math.random() * tempTeams.length), 1)[0];
                restMsgArr.push(`單數隊伍：${restingTeam.name1} & ${restingTeam.name2} (本輪輪空)`);
            }
            tempTeams.sort(() => Math.random() - 0.5);
            for (let index = 0; index < tempTeams.length; index += 2) {
                newMatches.push({
                    id: `M_${newScheduleId}_${index}`,
                    round: 1,
                    matchNumber: (index / 2) + 1,
                    team1: tempTeams[index],
                    team2: tempTeams[index + 1],
                    score1: null,
                    score2: null,
                    isFinished: false
                });
            }
        } else {
            const rrTeams = [...currentTeams];
            if (rrTeams.length % 2 !== 0) rrTeams.push({ id: 'BYE', name1: '輪空', name2: '休息', totalLevel: 0 });
            const numTeams = rrTeams.length;
            let matchCounter = 0;
            for (let round = 0; round < numTeams - 1; round++) {
                for (let index = 0; index < numTeams / 2; index++) {
                    const team1 = rrTeams[index];
                    const team2 = rrTeams[numTeams - 1 - index];
                    if (team1.id !== 'BYE' && team2.id !== 'BYE') {
                        newMatches.push({
                            id: `M_${newScheduleId}_${matchCounter++}`,
                            round: round + 1,
                            matchNumber: matchCounter,
                            team1,
                            team2,
                            score1: null,
                            score2: null,
                            isFinished: false
                        });
                    }
                }
                rrTeams.splice(1, 0, rrTeams.pop());
            }
        }

        schedules.push({ id: newScheduleId, mode: matchMode, matches: newMatches, restMsg: restMsgArr.join('\n') });
        pendingRestMsg = '';
        needsInitialSchedule = false;
        renderAll();
        saveStorage();
        autoSync();
    }

    function generateRematch() { generateMatchesForCurrentTeams(''); }

    // ── 重新分組功能 ──
    let regroupTeams = [];      // 目前 modal 中的分組 (陣列of組, 每組是陣列of player)
    let regroupSelected = null; // 點選中等待互換的 {teamIdx, playerIdx}

    function openRegroupModal() {
        if (!canChangeStructure()) return;
        // 從 players 重新自動分組一次
        autoRegroup();
        document.getElementById('regroupModal').style.display = 'block';
    }

    function closeRegroupModal() {
        document.getElementById('regroupModal').style.display = 'none';
        regroupSelected = null;
    }

    window.addEventListener('click', e => {
        if (e.target === document.getElementById('regroupModal')) closeRegroupModal();
    });

    function autoRegroup() {
        // 依實力均衡分組，每組2人，同 play.html 的邏輯
        const activePlayers = [...players].sort((a, b) => b.level - a.level);
        const restMsg = [];
        const teams = [];

        // 若單數，隨機一人輪空
        if (activePlayers.length % 2 !== 0) {
            const restIdx = Math.floor(Math.random() * activePlayers.length);
            const restPlayer = activePlayers.splice(restIdx, 1)[0];
            restMsg.push(`單數球員：${restPlayer.name} 本輪輪空`);
        }

        // Snake draft：高低搭配
        const sorted = [...activePlayers].sort((a, b) => b.level - a.level);
        const paired = [];
        let left = 0, right = sorted.length - 1;
        while (left < right) {
            paired.push([sorted[left], sorted[right]]);
            left++; right--;
        }
        // 若有中間單人（偶數情況不會有），可忽略

        regroupTeams = paired;
        regroupRestMsg_text = restMsg.join('\n');

        const restEl = document.getElementById('regroupRestMsg');
        if (restMsg.length > 0) {
            restEl.textContent = restMsg.join('\n');
            restEl.style.display = 'block';
        } else {
            restEl.style.display = 'none';
        }

        regroupSelected = null;
        renderRegroupGrid();
    }

    let regroupRestMsg_text = '';

    function renderRegroupGrid() {
        const grid = document.getElementById('regroupGrid');
        grid.replaceChildren(...regroupTeams.map((pair, teamIdx) => {
            const team = el('div', 'regroup-team', null, el('div', 'regroup-team-heading', `組 ${teamIdx + 1}　Lv.${pair.reduce((sum, player) => sum + player.level, 0)}`));
            pair.forEach((player, playerIdx) => {
                const selected = regroupSelected?.teamIdx === teamIdx && regroupSelected?.playerIdx === playerIdx;
                const button = el('button', `regroup-player${selected ? ' selected' : ''}`, null,
                    el('div', 'regroup-player-name', player.name), el('div', 'regroup-player-detail', `${player.gender}・Lv.${player.level}`));
                button.type = 'button'; button.setAttribute('aria-pressed', String(selected));
                button.addEventListener('click', () => regroupSelectPlayer(teamIdx, playerIdx)); team.append(button);
            });
            return team;
        }));
    }

    function regroupSelectPlayer(teamIdx, playerIdx) {
        if (!regroupSelected) {
            regroupSelected = { teamIdx, playerIdx };
            renderRegroupGrid();
            return;
        }
        // 互換
        const a = regroupSelected, b = { teamIdx, playerIdx };
        if (a.teamIdx === b.teamIdx && a.playerIdx === b.playerIdx) {
            regroupSelected = null;
            renderRegroupGrid();
            return;
        }
        const tmp = regroupTeams[a.teamIdx][a.playerIdx];
        regroupTeams[a.teamIdx][a.playerIdx] = regroupTeams[b.teamIdx][b.playerIdx];
        regroupTeams[b.teamIdx][b.playerIdx] = tmp;
        regroupSelected = null;
        renderRegroupGrid();
    }

    function confirmRegroupAndStart(mode) {
        if (!canChangeStructure()) return;
        if (regroupTeams.length === 0) {
            alert('請先點「自動重新分組」產生分組。');
            return;
        }

        // 將 regroupTeams 轉成 currentTeams 格式
        const newTeams = regroupTeams.map((pair, i) => ({
            id: `T_${Date.now()}_${i}`,
            name1: pair[0].name,
            name2: pair[1].name,
            totalLevel: pair[0].level + pair[1].level
        }));

        currentTeams = newTeams;
        matchMode = mode;

        const newScheduleId = schedules.length + 1;
        const newMatches = [];
        const restMsgArr = [];
        if (regroupRestMsg_text) restMsgArr.push(regroupRestMsg_text);

        if (mode === 'single') {
            const tempTeams = [...currentTeams].sort(() => Math.random() - 0.5);
            if (tempTeams.length % 2 !== 0) {
                const restingTeam = tempTeams.splice(Math.floor(Math.random() * tempTeams.length), 1)[0];
                restMsgArr.push(`單數隊伍：${restingTeam.name1} & ${restingTeam.name2} (本輪輪空)`);
            }
            for (let i = 0; i < tempTeams.length; i += 2) {
                newMatches.push({
                    id: `M_${newScheduleId}_${i}`,
                    round: 1,
                    matchNumber: (i / 2) + 1,
                    team1: tempTeams[i],
                    team2: tempTeams[i + 1],
                    score1: null, score2: null, isFinished: false
                });
            }
        } else {
            const rrTeams = [...currentTeams];
            if (rrTeams.length % 2 !== 0) rrTeams.push({ id: 'BYE', name1: '輪空', name2: '休息', totalLevel: 0 });
            const numTeams = rrTeams.length;
            let matchCounter = 0;
            for (let round = 0; round < numTeams - 1; round++) {
                for (let i = 0; i < numTeams / 2; i++) {
                    const t1 = rrTeams[i], t2 = rrTeams[numTeams - 1 - i];
                    if (t1.id !== 'BYE' && t2.id !== 'BYE') {
                        newMatches.push({
                            id: `M_${newScheduleId}_${matchCounter++}`,
                            round: round + 1, matchNumber: matchCounter,
                            team1: t1, team2: t2,
                            score1: null, score2: null, isFinished: false
                        });
                    }
                }
                rrTeams.splice(1, 0, rrTeams.pop());
            }
        }

        schedules.push({ id: newScheduleId, mode, matches: newMatches, restMsg: restMsgArr.join('\n') });
        pendingRestMsg = '';
        needsInitialSchedule = false;
        closeRegroupModal();
        renderAll();
        saveStorage();
        autoSync();
    }

    function generateRankedSingleElimination() {
        if (!canChangeStructure()) return;
        const schedule = buildSingleEliminationSchedule(schedules, currentTeams);
        if (!schedule) {
            alert('至少需要 2 隊才能產生單敗淘汰賽。');
            return;
        }
        if (schedule.error) {
            alert(schedule.message);
            return;
        }
        schedules.push(schedule);
        renderAll();
        saveStorage();
        autoSync();
    }

    function renderAll() { renderStandings(); renderSchedules(); updateRematchUI(); }

    function updateRematchUI() {
        const container = document.getElementById('rematchContainer');
        if (schedules.length > 0 && currentTeams.length > 0) {
            container.style.display = 'block';
            document.getElementById('nextScheduleNum').innerText = schedules.length + 1;
        } else {
            container.style.display = 'none';
        }
    }

    function renderStandings() {
        const area = document.getElementById('standingsArea'); area.replaceChildren();
        if (!schedules.length) return;
        const table = el('table', 'standings-table');
        table.append(el('thead', '', null, el('tr', '', null, ...['名次','隊伍','勝','負','得分','失分','淨勝分'].map(text => el('th', '', text)))));
        const body = el('tbody');
        buildStandingsTableRows(schedules, currentTeams).forEach((item, index) => {
            const diff = item.ptsFor - item.ptsAgainst;
            body.append(el('tr', '', null, ...[index + 1, item.name, item.win, item.loss, item.ptsFor, item.ptsAgainst, diff > 0 ? `+${diff}` : diff].map((value, col) => el('td', col === 1 ? 'standings-name' : '', value))));
        });
        table.append(body);
        area.append(el('h3', 'standings-heading', '📊 總戰績表', el('span', 'standings-subtitle', '(所有分組組合，結算至目前所有賽程)')), el('div', 'standings-scroll', null, table));
    }


function renderSchedules() {
    renderMatchSchedules(document.getElementById('schedulesWrapper'), schedules,
        { save: saveScore, edit: editMatch, scoreboard: openScoreboard }, { scoreboard: true });
    if (isSyncing) document.querySelectorAll('#schedulesWrapper button').forEach(button => { button.disabled = true; });
}

function openScoreboard(scheduleId, matchId) {
    if (!canChangeStructure()) return;
    const schedule = schedules.find(item => item.id === scheduleId);
    const match = schedule?.matches.find(item => item.id === matchId);
    if (!match?.team1 || !match.team2) return;
    const sessionId = crypto.randomUUID();
    scoreboardSessions.set(sessionId, { scheduleId, matchId, lastSequence: 0 });
    const params = new URLSearchParams({
        ownerUid: currentUser.uid,
        sessionId,
        gameId: GAME_ID,
        scheduleId: String(scheduleId),
        matchId,
        team1: `${match.team1.name1} / ${match.team1.name2}`,
        team2: `${match.team2.name1} / ${match.team2.name2}`,
        score1: String(match.score1 ?? 0),
        score2: String(match.score2 ?? 0),
        mode: schedule.mode || 'single'
    });
    window.open(`score.html?${params}`, '_blank', 'noopener');
}

function applyScoreboardResult(payload) {
    if (!currentUser || !payload || payload.ownerUid !== currentUser.uid || payload.gameId !== GAME_ID) return;
    const session = scoreboardSessions.get(payload.sessionId);
    if (!session || session.scheduleId !== Number(payload.scheduleId) || session.matchId !== payload.matchId) return;
    if (!Number.isSafeInteger(payload.sequence) || payload.sequence <= session.lastSequence) return;
    if (![payload.score1, payload.score2].every(value => Number.isInteger(value) && value >= 0 && value <= 999)) return;
    if (typeof payload.isFinished !== 'boolean') return;
    session.lastSequence = payload.sequence;
    // Keep updates in order, including the final result after rapid scoring.
    scoreQueue = scoreQueue.then(async () => {
        if (hasUnsavedChanges) {
            status('⚠️ 請先處理尚未儲存的賽程變更，再重新送出計分結果。');
            return;
        }
        await submitScore(session.scheduleId, session.matchId, payload.score1, payload.score2, payload.isFinished);
    });
}

async function submitScore(scheduleId, matchId, score1, score2, isFinished) {
    if (hasUnsavedChanges || !currentGame) return false;
    const schedule = schedules.find(item => item.id === scheduleId);
    if (isFinished && schedule?.mode === 'single-elimination' && score1 === score2) {
        alert('單敗淘汰賽不能平手，請輸入能分出勝負的比分。');
        return false;
    }
    setBusy(true);
    status('☁️ 儲存比分中...');
    try {
        const game = await saveMatchScore({ gameId: GAME_ID, scheduleId, matchId, score1, score2, isFinished });
        applyGame(game);
        status('✅ 比分已儲存');
        return true;
    } catch (error) {
        status(`❌ 比分尚未儲存：${error.message}`);
        return false;
    } finally {
        setBusy(false);
        if (pendingRemote && pendingRemote.revision > revision) applyGame(pendingRemote);
        pendingRemote = null;
    }
}

async function saveScore(scheduleId, matchId) {
    if (isSyncing || hasUnsavedChanges) return;
    try {
        const [score1, score2] = readScores(matchId);
        await submitScore(scheduleId, matchId, score1, score2, true);
    } catch (error) { alert(error.message); }
}

async function editMatch(scheduleId, matchId) {
    if (isSyncing || hasUnsavedChanges) return;
    await submitScore(scheduleId, matchId, null, null, false);
}

async function autoSync() {
    if (isSyncing || !currentGame) return false;
    const state = structuredClone(snapshot());
    const expectedRevision = revision;
    setBusy(true);
    status('☁️ 儲存賽程中...');
    try {
        const game = await saveGame(GAME_ID, state, expectedRevision);
        hasUnsavedChanges = false;
        applyGame(game);
        status('✅ 賽程已儲存');
        return true;
    } catch (error) {
        hasUnsavedChanges = true;
        status(`❌ 尚未儲存：${error.message}。可重試儲存，或重新載入雲端資料。`);
        return false;
    } finally {
        setBusy(false);
        if (!hasUnsavedChanges && pendingRemote && pendingRemote.revision > revision) applyGame(pendingRemote);
        pendingRemote = null;
    }
}

async function syncToCloud() {
    if (isSyncing) return;
    if (!hasUnsavedChanges) { status('✅ 目前資料已同步'); return; }
    await autoSync();
}

window.addEventListener('storage', event => {
    if (!currentUser || event.key !== scoreboardResultKey(currentUser.uid) || !event.newValue) return;
    try { applyScoreboardResult(JSON.parse(event.newValue)); } catch { status('無法讀取計分板回傳的資料。'); }
});
window.addEventListener('pagehide', () => { stopWatching?.(); stopWatching = null; });
document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopWatching?.(); stopWatching = null; }
    else startWatching();
});
window.addEventListener('beforeunload', event => {
    if (hasUnsavedChanges || isSyncing) { event.preventDefault(); event.returnValue = ''; }
});
exposeActions({ generateRematch, openRegroupModal, closeRegroupModal, autoRegroup, regroupSelectPlayer,
    confirmRegroupAndStart, generateRankedSingleElimination, syncToCloud, reloadGame });
initialize();
