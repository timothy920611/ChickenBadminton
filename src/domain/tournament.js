// Pure tournament operations shared by schedule creation and rendering.
    function getModeLabel(mode) {
        if (mode === 'round-robin') return '循環賽';
        if (mode === 'single-elimination') return '單敗淘汰賽';
        return '單輪配對賽';
    }

    function teamSignature(team) {
        return team?.id || getTeamStatsKey(team);
    }

    function getScheduleRoundMatches(schedule, round) {
        return schedule.matches.filter(match => match.round === round);
    }

    // A later-round missing opponent may still be playing, so only resolved
    // empty branches count as byes.
    function isEmptyBranch(schedule, match, visited = new Set()) {
        if (!match || visited.has(match.id)) return false;
        if (match.team1 || match.team2) return false;
        if (match.round === 1) return true;
        const feeders = schedule.matches.filter(item => item.nextMatchId === match.id);
        return feeders.length === 2 && feeders.every(item => isEmptyBranch(schedule, item, new Set([...visited, match.id])));
    }

    function isAutomaticAdvance(schedule, match) {
        if (!match || (!!match.team1 === !!match.team2)) return false;
        if (match.round === 1) return true;
        const missingSlot = match.team1 ? 'team2' : 'team1';
        const feeder = schedule.matches.find(item => item.nextMatchId === match.id && item.slotInNext === missingSlot);
        return isEmptyBranch(schedule, feeder);
    }

    function getSingleEliminationWinner(match, schedule) {
        if (!match) return null;
        if (match.isFinished && match.team1 && match.team2) {
            if (match.score1 === match.score2) return null;
            return match.score1 > match.score2 ? match.team1 : match.team2;
        }
        if (isAutomaticAdvance(schedule, match)) return match.team1 || match.team2;
        return null;
    }

    function updateSingleEliminationProgress(schedule, match) {
        if (!schedule || schedule.mode !== 'single-elimination' || !match?.nextMatchId) return;
        const nextMatch = schedule.matches.find(item => item.id === match.nextMatchId);
        if (!nextMatch) return;

        const winner = getSingleEliminationWinner(match, schedule);
        const slot = match.slotInNext === 'team2' ? 'team2' : 'team1';
        const previousTeam = nextMatch[slot];
        const changed = teamSignature(previousTeam) !== teamSignature(winner);
        nextMatch[slot] = winner ? { ...winner } : null;

        if (changed) {
            nextMatch.score1 = null;
            nextMatch.score2 = null;
            nextMatch.isFinished = false;
        }

        updateSingleEliminationProgress(schedule, nextMatch);
    }

    function initializeSingleEliminationSchedule(schedule) {
        if (!schedule || schedule.mode !== 'single-elimination') return;
        schedule.matches.filter(match => match.round === 1).forEach(match => updateSingleEliminationProgress(schedule, match));
    }

    function getTeamStatsKey(team) {
        if (!team) return '';
        return [team.name1, team.name2].map(name => String(name || '').trim()).sort().join(' & ');
    }

    function getTeamDisplayName(team) {
        if (!team) return '未定';
        return `${team.name1} & ${team.name2}`;
    }

    function normalizePlayerName(name) {
        return String(name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase('zh-Hant');
    }

    function getTeamPlayerKeys(team) {
        if (!team) return [];
        return [team.name1, team.name2].map(normalizePlayerName).filter(Boolean);
    }

    function teamsSharePlayer(teamA, teamB) {
        if (!teamA || !teamB) return false;
        const playerKeysA = new Set(getTeamPlayerKeys(teamA));
        return getTeamPlayerKeys(teamB).some(key => playerKeysA.has(key));
    }

    function generateStandardSeedOrder(size) {
        let seeds = [1, 2];
        while (seeds.length < size) {
            const nextSize = seeds.length * 2;
            seeds = seeds.flatMap(seed => [seed, nextSize + 1 - seed]);
        }
        return seeds.slice(0, size);
    }

    function createBracketSlotsFromRankings(rankedTeams, bracketSize) {
        return generateStandardSeedOrder(bracketSize).map(seed => (seed <= rankedTeams.length ? { ...rankedTeams[seed - 1] } : null));
    }

    function buildSingleEliminationMatchesFromSlots(slots, scheduleId) {
        const matches = [];
        let counter = 0;
        for (let index = 0; index < slots.length; index += 2) {
            matches.push({
                id: `M_${scheduleId}_${counter++}`,
                round: 1,
                matchNumber: (index / 2) + 1,
                team1: slots[index] ? { ...slots[index] } : null,
                team2: slots[index + 1] ? { ...slots[index + 1] } : null,
                score1: null,
                score2: null,
                isFinished: false
            });
        }

        let previousRound = matches.slice();
        let round = 2;
        while (previousRound.length > 1) {
            const nextRound = [];
            for (let index = 0; index < previousRound.length; index += 2) {
                const nextMatch = {
                    id: `M_${scheduleId}_${counter++}`,
                    round,
                    matchNumber: (index / 2) + 1,
                    team1: null,
                    team2: null,
                    score1: null,
                    score2: null,
                    isFinished: false
                };
                previousRound[index].nextMatchId = nextMatch.id;
                previousRound[index].slotInNext = 'team1';
                previousRound[index + 1].nextMatchId = nextMatch.id;
                previousRound[index + 1].slotInNext = 'team2';
                nextRound.push(nextMatch);
            }
            matches.push(...nextRound);
            previousRound = nextRound;
            round += 1;
        }
        return matches;
    }

    function findPlayerConflictMatches(schedule) {
        if (!schedule) return [];
        return schedule.matches.filter(match => match.team1 && match.team2 && teamsSharePlayer(match.team1, match.team2));
    }

    function evaluateBracketSlots(slots, scheduleId, idealSlotIndexes) {
        const schedule = { id: scheduleId, mode: 'single-elimination', matches: buildSingleEliminationMatchesFromSlots(slots, scheduleId) };
        initializeSingleEliminationSchedule(schedule);
        const conflictCount = findPlayerConflictMatches(schedule).length;
        const displacement = slots.reduce((sum, team, slotIndex) => {
            if (!team) return sum;
            const idealSlotIndex = idealSlotIndexes.get(teamSignature(team));
            return sum + (Number.isInteger(idealSlotIndex) ? Math.abs(slotIndex - idealSlotIndex) : 0);
        }, 0);
        return { conflictCount, displacement };
    }

    function optimizeBracketSlots(slots, scheduleId) {
        const idealSlotIndexes = new Map();
        slots.forEach((team, slotIndex) => {
            const signature = teamSignature(team);
            if (signature) idealSlotIndexes.set(signature, slotIndex);
        });

        const scoreSlots = candidateSlots => evaluateBracketSlots(candidateSlots, scheduleId, idealSlotIndexes);
        let bestScore = scoreSlots(slots);
        let improved = true;

        while (bestScore.conflictCount > 0 && improved) {
            improved = false;
            let bestSwap = null;
            for (let i = 0; i < slots.length - 1; i++) {
                for (let j = i + 1; j < slots.length; j++) {
                    if (!slots[i] && !slots[j]) continue;
                    const candidateSlots = slots.slice();
                    [candidateSlots[i], candidateSlots[j]] = [candidateSlots[j], candidateSlots[i]];
                    const candidateScore = scoreSlots(candidateSlots);
                    const isBetter = candidateScore.conflictCount < bestScore.conflictCount ||
                        (candidateScore.conflictCount === bestScore.conflictCount && candidateScore.displacement < bestScore.displacement);
                    if (isBetter) {
                        bestScore = candidateScore;
                        bestSwap = [i, j];
                        improved = true;
                    }
                }
            }
            if (bestSwap) [slots[bestSwap[0]], slots[bestSwap[1]]] = [slots[bestSwap[1]], slots[bestSwap[0]]];
        }

        return { slots, conflictCount: bestScore.conflictCount };
    }

    function sortStandingRows(rows) {
        return rows.sort((a, b) => {
            if (b.win !== a.win) return b.win - a.win;
            const diffA = a.ptsFor - a.ptsAgainst;
            const diffB = b.ptsFor - b.ptsAgainst;
            if (diffB !== diffA) return diffB - diffA;
            if (b.ptsFor !== a.ptsFor) return b.ptsFor - a.ptsFor;
            return a.name.localeCompare(b.name, 'zh-Hant');
        });
    }

    function buildStandingsTableRows(schedules, currentTeams, teamPool = null) {
        const stats = {};
        const allowKeys = teamPool ? new Set(teamPool.map(getTeamStatsKey).filter(Boolean)) : null;

        function ensureTeam(team) {
            const key = getTeamStatsKey(team);
            if (!key || (allowKeys && !allowKeys.has(key))) return null;
            if (!stats[key]) {
                stats[key] = {
                    id: key,
                    name: getTeamDisplayName(team),
                    team,
                    win: 0,
                    loss: 0,
                    ptsFor: 0,
                    ptsAgainst: 0
                };
            }
            return stats[key];
        }

        (teamPool || currentTeams).forEach(ensureTeam);

        schedules.forEach(schedule => schedule.matches.forEach(match => {
            const stat1 = ensureTeam(match.team1);
            const stat2 = ensureTeam(match.team2);
            if (!match.team1 || !match.team2 || !match.isFinished || !stat1 || !stat2) return;

            const score1 = Number(match.score1) || 0;
            const score2 = Number(match.score2) || 0;
            stat1.ptsFor += score1;
            stat1.ptsAgainst += score2;
            stat2.ptsFor += score2;
            stat2.ptsAgainst += score1;
            if (score1 > score2) {
                stat1.win++;
                stat2.loss++;
            } else if (score2 > score1) {
                stat2.win++;
                stat1.loss++;
            }
        }));

        return sortStandingRows(Object.values(stats));
    }

    function cloneTeamForBracket(team) {
        return team ? { ...team } : null;
    }

    function getRankedTeamsByStandings(schedules, currentTeams) {
        return buildStandingsTableRows(schedules, currentTeams)
            .map(row => row.team)
            .filter(Boolean)
            .map(cloneTeamForBracket);
    }

    function buildSingleEliminationSchedule(schedules, currentTeams) {
        const rankedTeams = getRankedTeamsByStandings(schedules, currentTeams);
        if (rankedTeams.length < 2) return null;

        const bracketSize = 2 ** Math.ceil(Math.log2(rankedTeams.length));
        const scheduleId = schedules.length + 1;
        const initialSlots = createBracketSlotsFromRankings(rankedTeams, bracketSize);
        const { slots, conflictCount } = optimizeBracketSlots(initialSlots, scheduleId);
        const matches = buildSingleEliminationMatchesFromSlots(slots, scheduleId);

        const seededNames = rankedTeams.map((team, index) => `${index + 1}. ${getTeamDisplayName(team)}`);
        const schedule = {
            id: scheduleId,
            mode: 'single-elimination',
            matches,
            restMsg: `依目前總戰績最新排名建立 ${rankedTeams.length} 隊單敗淘汰賽種子：${seededNames.join('、')}`
        };
        initializeSingleEliminationSchedule(schedule);

        const conflicts = findPlayerConflictMatches(schedule);
        if (conflictCount > 0 || conflicts.length > 0) {
            const conflictNames = conflicts.map(match => `${getTeamDisplayName(match.team1)} vs ${getTeamDisplayName(match.team2)}`).join('、');
            return {
                error: 'player-conflict',
                message: `目前總戰績表的隊伍無法產生不重複選手的單敗淘汰賽，請先調整隊伍。衝突場次：${conflictNames || '未知場次'}`
            };
        }

        return schedule;
    }


export { getModeLabel, teamSignature, getScheduleRoundMatches, isEmptyBranch, isAutomaticAdvance, getSingleEliminationWinner, updateSingleEliminationProgress, initializeSingleEliminationSchedule, getTeamStatsKey, getTeamDisplayName, normalizePlayerName, getTeamPlayerKeys, teamsSharePlayer, generateStandardSeedOrder, createBracketSlotsFromRankings, buildSingleEliminationMatchesFromSlots, findPlayerConflictMatches, evaluateBracketSlots, optimizeBracketSlots, sortStandingRows, buildStandingsTableRows, cloneTeamForBracket, getRankedTeamsByStandings, buildSingleEliminationSchedule };
