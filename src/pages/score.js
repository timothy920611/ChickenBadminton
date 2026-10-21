import { scoreboardResultKey } from '../services/cache.js';
import { exposeActions, enableStartupControls } from '../services/ui.js';

// 狀態設定
    let scoreA = 0;
    let scoreB = 0;
    let nameA = "主隊";
    let nameB = "客隊";
    let colorA = "#3b82f6"; // 藍色
    let colorB = "#ef4444"; // 紅色
    let isSwapped = false; // 是否已交換場地

    let targetScore = 11;
    let enableSound = true;
    let enableVibrate = true;

    const scoreboardQuery = new URLSearchParams(window.location.search);
    const sessionMeta = {
      ownerUid: scoreboardQuery.get('ownerUid') || '',
      sessionId: scoreboardQuery.get('sessionId') || '',
      gameId: scoreboardQuery.get('gameId') || '',
      scheduleId: scoreboardQuery.get('scheduleId') || '',
      matchId: scoreboardQuery.get('matchId') || '',
      mode: scoreboardQuery.get('mode') || 'single'
    };

    const linkedSession = ['ownerUid', 'sessionId', 'gameId', 'scheduleId', 'matchId']
      .every(key => Boolean(sessionMeta[key]));

    const sequenceKey = `scoreboard_sequence_${sessionMeta.sessionId}`;
    let scoreSequence = 0;
    if (linkedSession) {
      try { scoreSequence = Number(sessionStorage.getItem(sequenceKey)) || 0; } catch {}
    }

    // 音效依使用者操作才啟動；沒有 Web Audio API 時仍可計分。
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = AudioContextClass ? new AudioContextClass() : null;

    // 初始化 Lucide 圖示
    window.lucide?.createIcons();

    // 載入 localStorage 的設定與狀態 (若有的話)
    function loadSavedState() {
      const savedTarget = localStorage.getItem('score_target');
      if (savedTarget !== null) {
        targetScore = parseInt(savedTarget, 10);
        document.getElementById('target-score').value = targetScore;
      }
      const savedSound = localStorage.getItem('score_sound');
      if (savedSound !== null) {
        enableSound = savedSound === 'true';
        document.getElementById('sound-toggle').checked = enableSound;
      }
      const savedVibrate = localStorage.getItem('score_vibrate');
      if (savedVibrate !== null) {
        enableVibrate = savedVibrate === 'true';
        document.getElementById('vibrate-toggle').checked = enableVibrate;
      }

      const savedNameA = localStorage.getItem('score_name_a');
      const savedNameB = localStorage.getItem('score_name_b');
      const queryNameA = scoreboardQuery.get('team1');
      const queryNameB = scoreboardQuery.get('team2');
      document.getElementById('name-a').value = queryNameA || savedNameA || '主隊';
      document.getElementById('name-b').value = queryNameB || savedNameB || '客隊';

      const initialScoreA = parseInt(scoreboardQuery.get('score1') || '0', 10);
      const initialScoreB = parseInt(scoreboardQuery.get('score2') || '0', 10);
      if (!Number.isNaN(initialScoreA) && initialScoreA >= 0) scoreA = Math.min(999, initialScoreA);
      if (!Number.isNaN(initialScoreB) && initialScoreB >= 0) scoreB = Math.min(999, initialScoreB);
    }

    // 儲存設定至 localStorage
    function saveSettings() {
      targetScore = parseInt(document.getElementById('target-score').value, 10) || 0;
      enableSound = document.getElementById('sound-toggle').checked;
      enableVibrate = document.getElementById('vibrate-toggle').checked;

      localStorage.setItem('score_target', targetScore);
      localStorage.setItem('score_sound', enableSound);
      localStorage.setItem('score_vibrate', enableVibrate);

      localStorage.setItem('score_name_a', document.getElementById('name-a').value);
      localStorage.setItem('score_name_b', document.getElementById('name-b').value);

      checkWinnerState();
    }

    // 快捷設定預設分數
    function setTargetScorePreset(score) {
      document.getElementById('target-score').value = score;
      saveSettings();
      showToast(`已設定勝利分數為 ${score} 分`);
    }

    // 播放提示聲 (使用 Web Audio API，無需外載音檔)
    function playBeep(type) {
      if (!enableSound || !audioContext) return;
      try {
        if (audioContext.state === 'suspended') void audioContext.resume();
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.connect(gain);
        gain.connect(audioContext.destination);

        if (type === 'add') {
          osc.frequency.setValueAtTime(587.33, audioContext.currentTime); // D5
          gain.gain.setValueAtTime(0.1, audioContext.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
          osc.start();
          osc.stop(audioContext.currentTime + 0.15);
        } else if (type === 'minus') {
          osc.frequency.setValueAtTime(293.66, audioContext.currentTime); // D4
          gain.gain.setValueAtTime(0.1, audioContext.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
          osc.start();
          osc.stop(audioContext.currentTime + 0.2);
        } else if (type === 'win') {
          // 贏球和弦
          const freqs = [523.25, 659.25, 783.99, 1046.50]; // C 和弦
          freqs.forEach((f, i) => {
            const o = audioContext.createOscillator();
            const g = audioContext.createGain();
            o.connect(g);
            g.connect(audioContext.destination);
            o.frequency.setValueAtTime(f, audioContext.currentTime + i * 0.08);
            g.gain.setValueAtTime(0.08, audioContext.currentTime + i * 0.08);
            g.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + i * 0.08 + 0.4);
            o.start(audioContext.currentTime + i * 0.08);
            o.stop(audioContext.currentTime + i * 0.08 + 0.4);
          });
        }
      } catch (e) {
        console.log('Audio Autoplay policy block handled');
      }
    }

    // 震動回饋
    function triggerVibrate(pattern = 50) {
      if (enableVibrate && navigator.vibrate) {
        navigator.vibrate(pattern);
      }
    }

    // 更新分數與介面
    function updateDisplay() {
      document.getElementById('score-a').innerText = scoreA;
      document.getElementById('score-b').innerText = scoreB;
      checkWinnerState();
    }

    // 變更分數 (A 或 B 隊，增量 delta)
    function changeScore(panel, delta) {
      if (panel === 'A') {
        scoreA = Math.min(999, Math.max(0, scoreA + delta));
        if (delta > 0) {
          playBeep('add');
          triggerVibrate(60);
        } else {
          playBeep('minus');
          triggerVibrate([40, 30]);
        }
      } else {
        scoreB = Math.min(999, Math.max(0, scoreB + delta));
        if (delta > 0) {
          playBeep('add');
          triggerVibrate(60);
        } else {
          playBeep('minus');
          triggerVibrate([40, 30]);
        }
      }
      updateDisplay();
      emitScoreUpdate(false);
    }

    // 面板手勢：點擊加分，向下滑動減分，避免減分按鈕佔用比分空間
    function setupPanelGestures() {
      const swipeThreshold = 55;
      document.querySelectorAll('[data-score-panel]').forEach((panelElement) => {
        const panel = panelElement.dataset.scorePanel;
        let startX = 0;
        let startY = 0;
        let suppressNextClick = false;

        const isInteractiveTarget = (target) => target.closest('input, button, textarea, select, a');

        panelElement.addEventListener('pointerdown', (event) => {
          if (isInteractiveTarget(event.target)) return;
          startX = event.clientX;
          startY = event.clientY;
        });

        panelElement.addEventListener('pointerup', (event) => {
          if (isInteractiveTarget(event.target)) return;

          const deltaX = event.clientX - startX;
          const deltaY = event.clientY - startY;
          const isDownSwipe = deltaY > swipeThreshold && Math.abs(deltaY) > Math.abs(deltaX) * 1.15;

          if (isDownSwipe) {
            suppressNextClick = true;
            event.preventDefault();
            event.stopPropagation();
            changeScore(panel, -1);
            showToast('向下滑動：減 1 分');
            setTimeout(() => { suppressNextClick = false; }, 300);
          }
        });

        panelElement.addEventListener('click', (event) => {
          if (suppressNextClick || isInteractiveTarget(event.target)) {
            event.preventDefault();
            event.stopPropagation();
            suppressNextClick = false;
            return;
          }
          changeScore(panel, 1);
        });
      });
    }

    // 交換場地 (對調面板的順序、顏色、分數與名稱)
    function swapTeams() {
      triggerVibrate(100);
      playBeep('minus');

      isSwapped = !isSwapped;

      const container = document.body;
      const panelA = document.getElementById('panel-a');
      const panelB = document.getElementById('panel-b');

      if (isSwapped) {
        // 水平與垂直皆反轉順序 (CSS flex-direction-reverse 效果)
        panelA.classList.add('order-2');
        panelB.classList.add('order-1');
      } else {
        panelA.classList.remove('order-2');
        panelB.classList.remove('order-1');
      }

      showToast("場地已對調");
      emitScoreUpdate(false);
    }

    // 確認與開關歸零對話盒
    function confirmReset() {
      toggleResetModal(true);
    }

    function resetScores() {
      scoreA = 0;
      scoreB = 0;
      updateDisplay();
      toggleResetModal(false);
      showToast("分數已全部歸零");
      triggerVibrate([80, 50, 80]);
      emitScoreUpdate(false);
    }

    // 開關設定 Modal
    function toggleSettingsModal(show) {
      const modal = document.getElementById('settings-modal');
      if (show) {
        modal.classList.remove('hidden');
      } else {
        modal.classList.add('hidden');
        saveSettings();
      }
    }

    // 開關歸零 Modal
    function toggleResetModal(show) {
      const modal = document.getElementById('reset-modal');
      if (show) {
        modal.classList.remove('hidden');
      } else {
        modal.classList.add('hidden');
      }
    }

    // 秀出 Toast 短暫提示
    function showToast(text) {
      const toast = document.getElementById('toast');
      toast.innerText = text;
      toast.classList.remove('opacity-0');
      toast.classList.add('opacity-100');

      setTimeout(() => {
        toast.classList.remove('opacity-100');
        toast.classList.add('opacity-0');
      }, 1500);
    }


    function emitScoreUpdate(isFinished = false) {
      if (!linkedSession) return false;
      const payload = {
        sequence: ++scoreSequence,
        ownerUid: sessionMeta.ownerUid,
        sessionId: sessionMeta.sessionId,
        gameId: sessionMeta.gameId,
        scheduleId: sessionMeta.scheduleId,
        matchId: sessionMeta.matchId,
        score1: scoreA,
        score2: scoreB,
        isFinished
      };
      try {
        localStorage.setItem(scoreboardResultKey(sessionMeta.ownerUid), JSON.stringify(payload));
        try { sessionStorage.setItem(sequenceKey, String(scoreSequence)); } catch {}
        return true;
      } catch {
        showToast('無法帶回比分，請確認瀏覽器允許本機儲存');
        return false;
      }
    }

    function finishAndReturn() {
      if (sessionMeta.mode === 'single-elimination' && scoreA === scoreB) {
        showToast('單敗淘汰賽不能平手');
        return;
      }
      if (!linkedSession) {
        showToast('比賽完成');
        return;
      }
      if (emitScoreUpdate(true)) {
        showToast('比分已傳送，請回賽程頁確認儲存狀態');
        setTimeout(() => window.close(), 500);
      }
    }

    // 檢查是否有隊伍勝出並顯示特效
    let winnerCelebrated = false;


    // 自動偵測領先與落後隊伍，讓比分差異更容易被快速辨識
    function updateLeaderState() {
      const panelA = document.getElementById('panel-a');
      const panelB = document.getElementById('panel-b');
      panelA.classList.remove('is-leading', 'is-trailing');
      panelB.classList.remove('is-leading', 'is-trailing');

      if (scoreA === scoreB) return;

      const leadingPanel = scoreA > scoreB ? panelA : panelB;
      const trailingPanel = scoreA > scoreB ? panelB : panelA;
      leadingPanel.classList.add('is-leading');
      trailingPanel.classList.add('is-trailing');
    }

    function checkWinnerState() {
      const crownA = document.getElementById('crown-a');
      const crownB = document.getElementById('crown-b');
      updateLeaderState();

      if (targetScore > 0) {
        const winA = scoreA >= targetScore && (scoreA - scoreB >= 2);
        const winB = scoreB >= targetScore && (scoreB - scoreA >= 2);

        // 如果是剛好過關且還沒慶祝過
        if ((winA || winB) && !winnerCelebrated) {
          playBeep('win');
          triggerVibrate([100, 50, 100, 50, 300]);
          startFireworks();
          winnerCelebrated = true;
          showToast("比賽結束！恭喜獲勝！");
        }

        // 顯示或隱藏皇冠
        if (winA) {
          crownA.classList.remove('opacity-0', 'scale-50');
          crownA.classList.add('opacity-100', 'scale-100');
        } else {
          crownA.classList.add('opacity-0', 'scale-50');
          crownA.classList.remove('opacity-100', 'scale-100');
        }

        if (winB) {
          crownB.classList.remove('opacity-0', 'scale-50');
          crownB.classList.add('opacity-100', 'scale-100');
        } else {
          crownB.classList.add('opacity-0', 'scale-50');
          crownB.classList.remove('opacity-100', 'scale-100');
        }

        if (!winA && !winB) {
          winnerCelebrated = false;
          stopFireworks();
        }
      } else {
        // 不設限勝利分數
        crownA.classList.add('opacity-0', 'scale-50');
        crownB.classList.add('opacity-0', 'scale-50');
        winnerCelebrated = false;
        stopFireworks();
      }
    }

    // --- 炫酷煙火粒子特效邏輯 ---
    const canvas = document.getElementById('celebration-canvas');
    const ctx = canvas.getContext('2d');
    let animationFrameId = null;
    let particles = [];

    function resizeCanvas() {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    class Particle {
      constructor(x, y, color) {
        this.x = x;
        this.y = y;
        this.color = color;
        this.radius = Math.random() * 3 + 2;
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 6 + 4;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.alpha = 1;
        this.decay = Math.random() * 0.015 + 0.015;
      }
      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.vy += 0.08; // 重力
        this.alpha -= this.decay;
      }
      draw() {
        ctx.save();
        ctx.globalAlpha = this.alpha;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    function spawnFirework() {
      const colors = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#ef4444', '#ffffff'];
      const x = Math.random() * canvas.width;
      const y = Math.random() * (canvas.height * 0.5) + (canvas.height * 0.1);
      const color = colors[Math.floor(Math.random() * colors.length)];
      for (let i = 0; i < 40; i++) {
        particles.push(new Particle(x, y, color));
      }
    }

    function animateCelebration() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (Math.random() < 0.05) {
        spawnFirework();
      }

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.update();
        if (p.alpha <= 0) {
          particles.splice(i, 1);
        } else {
          p.draw();
        }
      }

      animationFrameId = requestAnimationFrame(animateCelebration);
    }

    function startFireworks() {
      if (!animationFrameId) {
        animateCelebration();
      }
    }

    function stopFireworks() {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
      }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles = [];
    }

    // 全螢幕切換
    function toggleFullscreen() {
      const btn = document.getElementById('fullscreen-btn');
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen().then(() => {
          btn.innerHTML = '<i data-lucide="minimize" class="w-6 h-6 md:w-7 md:h-7"></i>';
          window.lucide?.createIcons();
        }).catch(() => {});
      } else {
        document.exitFullscreen().then(() => {
          btn.innerHTML = '<i data-lucide="maximize" class="w-6 h-6 md:w-7 md:h-7"></i>';
          window.lucide?.createIcons();
        }).catch(() => {});
      }
    }
    document.addEventListener('fullscreenchange', () => {
      const btn = document.getElementById('fullscreen-btn');
      if (!document.fullscreenElement) {
        btn.innerHTML = '<i data-lucide="maximize" class="w-6 h-6 md:w-7 md:h-7"></i>';
        window.lucide?.createIcons();
      }
    });

    // 鍵盤操控支援 (防呆便攜性，供電腦操作或無線快門)
    window.addEventListener('keydown', (e) => {
      // 若正在輸入隊名，不執行快速鍵
      if (document.activeElement.tagName === 'INPUT') return;

      if (e.key === 'a' || e.key === 'A') changeScore('A', 1);
      if (e.key === 'z' || e.key === 'Z') changeScore('A', -1);
      if (e.key === 'l' || e.key === 'L') changeScore('B', 1);
      if (e.key === 'm' || e.key === 'M') changeScore('B', -1);
      if (e.key === ' ') swapTeams();
      if (e.key === 'Escape') resetScores();
    });

    // 防止手機雙擊縮放
    document.addEventListener('touchstart', (event) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    }, { passive: false });

    // Module scripts run after HTML parsing, so no load-event race is needed.
    exposeActions({ saveSettings, setTargetScorePreset, toggleFullscreen,
      toggleSettingsModal, toggleResetModal, swapTeams, confirmReset,
      resetScores, finishAndReturn });
    loadSavedState();
    setupPanelGestures();
    updateDisplay();

enableStartupControls();
