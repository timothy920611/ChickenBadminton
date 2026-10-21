import { listProfiles, createProfile, selectProfile, accountUser, loginGoogle, logout, authErrorMessage } from '../services/auth.js';
import { configurationError } from '../services/firebase.js';
import { exposeActions } from '../services/ui.js';

// ======== 開場動畫控制 ========
        (function() {
            const intro = document.getElementById('intro-screen');
            const main  = document.getElementById('main-content');
            const bg    = document.getElementById('shuttleBg');

            // 隨機散佈裝飾羽球
            const emojis = ['🏸','🏸','⭐','✨','🌟'];
            for (let i = 0; i < 18; i++) {
                const el = document.createElement('span');
                el.className = 'shuttle-particle';
                el.textContent = emojis[Math.floor(Math.random() * emojis.length)];
                el.style.left = (Math.random() * 100) + '%';
                el.style.top  = (40 + Math.random() * 50) + '%';
                el.style.animationDelay = (Math.random() * 1.5 + 0.5) + 's';
                el.style.fontSize = (18 + Math.random() * 22) + 'px';
                bg.appendChild(el);
            }

            // 2.8 秒後開始離場動畫，再 0.6 秒後顯示主頁
            setTimeout(() => {
                intro.classList.add('fade-out');
                setTimeout(() => {
                    intro.style.display = 'none';
                    main.classList.add('visible');
                }, 600);
            }, 2800);
        })();



let busy = false;

function setStatus(message, isError = false) {
    const status = document.getElementById('statusMsg');
    status.textContent = message;
    status.classList.toggle('status-error', isError);
    status.classList.toggle('status-success', !isError);
}

function setBusy(value) {
    busy = value;
    document.querySelectorAll('.login-card button, #profileName').forEach(control => { control.disabled = value; });
}

async function enterProfile(profile) {
    if (busy) return;
    setBusy(true);
    try {
        await selectProfile(profile);
        window.location.href = 'dashboard.html';
    } catch (error) {
        setStatus(error.message || '無法選取使用者，請重試。', true);
        setBusy(false);
    }
}

async function loadProfiles() {
    if (busy) return;
    const setupError = configurationError();
    if (setupError) { setStatus(setupError, true); return; }
    setBusy(true);
    setStatus('⏳ 載入你的工作區...');
    try {
        const user = await accountUser();
        document.getElementById('loginGoogleBtn').hidden = !!user;
        document.getElementById('accountPanel').hidden = !user;
        if (!user) { setStatus('請使用 Google 帳號登入；只有你能讀寫自己的資料。'); return; }
        document.getElementById('accountName').textContent = user.displayName || user.email || '已登入';
        document.getElementById('accountUid').textContent = user.uid;
        const profiles = await listProfiles();
        const list = document.getElementById('profileList');
        list.replaceChildren();
        if (!profiles.length) {
            const empty = document.createElement('p');
            empty.className = 'profile-empty';
            empty.textContent = '尚無工作區，可建立一個新工作區。舊資料須由管理員依此 UID 綁定，不可自行認領。';
            list.appendChild(empty);
        }
        for (const profile of profiles) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'profile-choice';
            button.textContent = `👤 ${profile.name}`;
            button.addEventListener('click', () => enterProfile(profile));
            list.appendChild(button);
        }
        setStatus('選取你的工作區即可管理賽事。');
    } catch (error) {
        setStatus(authErrorMessage(error), true);
    } finally { setBusy(false); }
}

async function handleCreateProfile() {
    if (busy) return;
    const input = document.getElementById('profileName');
    const name = input.value.trim();
    if (!name || !input.reportValidity()) return;
    setBusy(true);
    setStatus('⏳ 建立使用者...');
    try {
        const profile = await createProfile(name);
        await selectProfile(profile);
        window.location.href = 'dashboard.html';
    } catch (error) {
        setStatus(error.message || '建立失敗，請重試。', true);
        setBusy(false);
    }
}

async function handleGoogleLogin() {
    if (busy) return;
    setBusy(true);
    try { await loginGoogle(); }
    catch (error) { setStatus(authErrorMessage(error), true); return; }
    finally { setBusy(false); }
    await loadProfiles();
}
async function handleLogout() { await logout(); location.reload(); }
exposeActions({ handleCreateProfile, loadProfiles, handleGoogleLogin, handleLogout });
document.getElementById('profileName').addEventListener('keydown', event => {
    if (event.key === 'Enter') handleCreateProfile();
});
loadProfiles();
