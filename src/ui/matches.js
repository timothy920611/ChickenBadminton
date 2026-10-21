import { el } from '../services/ui.js';
import { getModeLabel, isAutomaticAdvance } from '../domain/tournament.js';

/** 使用 DOM 與 textContent 呈現資料，不解析來自雲端的 HTML。 */
export function renderMatchSchedules(container, schedules, actions, { scoreboard = false } = {}) {
    const drafts = new Map([...container.querySelectorAll('input[data-score-key]')]
        .filter(input => input.value !== input.dataset.serverScore)
        .map(input => [input.dataset.scoreKey, input.value]));
    const expanded = new Map([...container.querySelectorAll('details[data-schedule]')].map(details => [details.dataset.schedule, details.open]));
    container.replaceChildren();
    if (!schedules.length) { container.append(el('div', 'schedule-empty', '🏸 尚未產生賽程，請安排分組。')); return; }
    schedules.forEach((schedule, scheduleIndex) => {
        const details = el('details', 'schedule-details');
        details.dataset.schedule = String(schedule.id);
        details.open = expanded.has(String(schedule.id)) ? expanded.get(String(schedule.id)) : scheduleIndex === schedules.length - 1;
        details.append(el('summary', 'schedule-summary', `🏸 賽程 ${schedule.id} (${getModeLabel(schedule.mode)})`));
        const content = el('div', 'schedule-content');
        if (schedule.restMsg) {
            const note = el('div', 'info-box', String(schedule.restMsg).replace(/<br\s*\/?\s*>/gi, '\n').replace(/<\/?strong>/gi, ''));
            note.style.whiteSpace = 'pre-line'; content.append(note);
        }
        const grid = el('div', 'matches-grid');
        let currentRound = 0, roundCount = 0;
        schedule.matches.forEach((match, matchIndex) => {
            if (schedule.mode !== 'single' && match.round !== currentRound) {
                const final = schedule.mode === 'single-elimination' && schedule.matches.filter(item => item.round === match.round).length === 1;
                grid.append(el('div', 'round-header', final ? '🏆 冠軍戰' : `第 ${match.round} 輪`));
                currentRound = match.round; roundCount = 0;
            }
            roundCount++;
            const ready = !!(match.team1 && match.team2);
            const bye = schedule.mode === 'single-elimination' && isAutomaticAdvance(schedule, match);
            const card = el('div', `match-card ${match.isFinished ? 'done' : ''}`);
            card.append(el('div', 'match-header', schedule.mode === 'single' ? `場次 ${matchIndex + 1}` : `第 ${match.round} 輪・第 ${roundCount} 場`));
            const teamView = (team, slot) => {
                const view = el('div', 'team');
                const label = el('div', 'team-name');
                if (team) label.append(el('span', '', team.name1), el('br'), document.createTextNode('& '), el('span', '', team.name2));
                else label.textContent = '待定';
                view.append(label, el('div', 'lv-badge', `Lv.${team?.totalLevel ?? '?'}`));
                const score = match[`score${slot}`];
                if (match.isFinished) view.append(el('div', `score-display ${score > match[`score${slot === 1 ? 2 : 1}`] ? 'winner' : ''}`, score));
                else if (ready) {
                    const key = `${schedule.id}:${match.id}:${slot}`;
                    const input = el('input', 'score-input');
                    Object.assign(input, { type: 'number', id: `s${slot}-${match.id}`, min: '0', max: '999', step: '1', value: drafts.get(key) ?? score ?? '' });
                    input.dataset.scoreKey = key; input.dataset.serverScore = String(score ?? '');
                    input.setAttribute('aria-label', slot === 1 ? '第一隊分數' : '第二隊分數');
                    view.append(input);
                } else view.append(el('div', 'match-pending', bye && team ? '輪空晉級' : '等待上一輪結果'));
                return view;
            };
            card.append(el('div', 'match-body', null, teamView(match.team1, 1), el('div', 'vs-badge', bye ? '輪空' : 'VS'), teamView(match.team2, 2)));
            const footer = el('div', 'match-footer');
            const button = (action, text, className) => {
                const node = el('button', className, text); node.type = 'button';
                node.addEventListener('click', () => actions[action]?.(schedule.id, match.id));
                return node;
            };
            if (match.isFinished) footer.append(button('edit', '✏️ 修改分數', 'btn-edit'));
            else if (bye) footer.append(el('span', 'match-hint', '此場因輪空自動晉級。'));
            else if (!ready) footer.append(el('span', 'match-hint', '等待上一輪完成後才可輸入分數。'));
            else footer.append(el('div', 'match-actions', null,
                scoreboard ? button('scoreboard', '🎯 專業計分板', 'btn-scoreboard') : null,
                button('save', '✅ 確認分數', 'btn-confirm')));
            card.append(footer); grid.append(card);
        });
        content.append(grid); details.append(content); container.append(details);
    });
}
export function readScores(matchId) {
    const values = [1, 2].map(slot => document.getElementById(`s${slot}-${matchId}`)?.value);
    if (values.some(value => value == null || value === '')) throw new Error('請填入兩隊分數。');
    const scores = values.map(Number);
    if (scores.some(score => !Number.isInteger(score) || score < 0 || score > 999)) throw new Error('分數必須是 0 到 999 的整數。');
    return scores;
}
