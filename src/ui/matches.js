import { escapeHtml } from '../services/ui.js';
import { getModeLabel, isAutomaticAdvance } from '../domain/tournament.js';

const teamLabel = team => team ? `${escapeHtml(team.name1)}<br>&amp; ${escapeHtml(team.name2)}` : '待定';
const note = value => escapeHtml(String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/?strong>/gi, '')).replace(/\n/g, '<br>');

/** Render by index and bind events after insertion; IDs never become JavaScript. */
export function renderMatchSchedules(container, schedules, actions, { scoreboard = false } = {}) {
    // Keep actual local edits while allowing untouched fields to reflect remote scores.
    const drafts = new Map([...container.querySelectorAll('input[data-score-key]')]
        .filter(input => input.value !== input.dataset.serverScore)
        .map(input => [input.dataset.scoreKey, input.value]));
    const expanded = new Map([...container.querySelectorAll('details[data-schedule]')].map(details => [details.dataset.schedule, details.open]));
    if (!schedules.length) {
        container.innerHTML = '<div class="schedule-empty">🏸 尚未產生賽程，請安排分組。</div>';
        return;
    }
    container.innerHTML = schedules.map((schedule, scheduleIndex) => {
        const open = expanded.has(String(schedule.id)) ? expanded.get(String(schedule.id)) : scheduleIndex === schedules.length - 1;
        let currentRound = 0;
        let roundCount = 0;
        return `<details class="schedule-details" data-schedule="${escapeHtml(schedule.id)}" ${open ? 'open' : ''}>
            <summary class="schedule-summary">🏸 賽程 ${escapeHtml(schedule.id)} (${getModeLabel(schedule.mode)})</summary>
            <div class="schedule-content">${schedule.restMsg ? `<div class="info-box">${note(schedule.restMsg)}</div>` : ''}
            <div class="matches-grid">${schedule.matches.map((match, matchIndex) => {
                let roundHeader = '';
                if (schedule.mode !== 'single' && match.round !== currentRound) {
                    const final = schedule.mode === 'single-elimination' && schedule.matches.filter(item => item.round === match.round).length === 1;
                    roundHeader = `<div class="round-header">${final ? '🏆 冠軍戰' : `第 ${escapeHtml(match.round)} 輪`}</div>`;
                    currentRound = match.round;
                    roundCount = 0;
                }
                roundCount++;
                const ready = !!(match.team1 && match.team2);
                const bye = schedule.mode === 'single-elimination' && isAutomaticAdvance(schedule, match);
                const header = schedule.mode === 'single' ? `場次 ${matchIndex + 1}` : `第 ${escapeHtml(match.round)} 輪・第 ${roundCount} 場`;
                const teamView = (team, slot) => {
                    const score = match[`score${slot}`];
                    const key = `${schedule.id}:${match.id}:${slot}`;
                    return `<div class="team"><div class="team-name">${teamLabel(team)}</div>
                        <div class="lv-badge">Lv.${escapeHtml(team?.totalLevel ?? '?')}</div>
                        ${match.isFinished ? `<div class="score-display ${score > match[`score${slot === 1 ? 2 : 1}`] ? 'winner' : ''}">${escapeHtml(score)}</div>` : ready
                            ? `<input type="number" id="s${slot}-${escapeHtml(match.id)}" data-score-key="${escapeHtml(key)}" data-server-score="${escapeHtml(score ?? '')}" class="score-input" min="0" max="999" step="1" value="${escapeHtml(drafts.get(key) ?? score ?? '')}" aria-label="${slot === 1 ? '第一隊' : '第二隊'}分數">`
                            : `<div class="match-pending">${bye && team ? '輪空晉級' : '等待上一輪結果'}</div>`}
                        </div>`;
                };
                const button = (action, text, className) => `<button class="${className}" data-match-action="${action}" data-schedule-index="${scheduleIndex}" data-match-index="${matchIndex}">${text}</button>`;
                let footer;
                if (match.isFinished) footer = button('edit', '✏️ 修改分數', 'btn-edit');
                else if (bye) footer = '<span class="match-hint">此場因輪空自動晉級。</span>';
                else if (!ready) footer = '<span class="match-hint">等待上一輪完成後才可輸入分數。</span>';
                else footer = `<div class="match-actions">${scoreboard ? button('scoreboard', '🎯 專業計分板', 'btn-scoreboard') : ''}${button('save', '✅ 確認分數', 'btn-confirm')}</div>`;
                return `${roundHeader}<div class="match-card ${match.isFinished ? 'done' : ''}"><div class="match-header">${header}</div>
                    <div class="match-body">${teamView(match.team1, 1)}<div class="vs-badge">${bye ? '輪空' : 'VS'}</div>${teamView(match.team2, 2)}</div>
                    <div class="match-footer">${footer}</div></div>`;
            }).join('')}</div></div></details>`;
    }).join('');
    container.querySelectorAll('[data-match-action]').forEach(button => {
        button.addEventListener('click', () => {
            const schedule = schedules[Number(button.dataset.scheduleIndex)];
            const match = schedule?.matches[Number(button.dataset.matchIndex)];
            if (match) actions[button.dataset.matchAction]?.(schedule.id, match.id);
        });
    });
}

export function readScores(matchId) {
    const values = [1, 2].map(slot => document.getElementById(`s${slot}-${matchId}`)?.value);
    if (values.some(value => value == null || value === '')) throw new Error('請填入兩隊分數。');
    const scores = values.map(Number);
    if (scores.some(score => !Number.isInteger(score) || score < 0 || score > 999)) throw new Error('分數必須是 0 到 999 的整數。');
    return scores;
}
