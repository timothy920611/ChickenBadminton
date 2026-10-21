import '../styles/common.css';
const panel = document.getElementById('mainContent');
panel.replaceChildren();
const message = document.createElement('p');
message.textContent = '公開協助計分連結已停用。請回首頁登入自己的 Google 帳號。';
const link = document.createElement('a');
link.href = 'index.html';
link.textContent = '回首頁登入';
panel.append(message, link);
// 清除網址中的舊分享憑證，避免留存在瀏覽歷程。
history.replaceState(null, '', location.pathname);
