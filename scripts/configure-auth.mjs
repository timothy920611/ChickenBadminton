import { initializeApp, applicationDefault, deleteApp } from 'firebase-admin/app';

// 共用模式只使用背景匿名驗證。管理 API 設定後必須回讀，不依賴 CLI 的成功訊息。
const write = process.argv.includes('--write');
if (process.argv.slice(2).some(arg => arg !== '--write')) throw new Error('用法：node scripts/configure-auth.mjs [--write]');
const app = initializeApp({projectId:'chickenbadminton',credential:applicationDefault()});
try {
  const token = (await app.options.credential.getAccessToken()).access_token;
  const headers = {Authorization:`Bearer ${token}`,'x-goog-user-project':'chickenbadminton','Content-Type':'application/json'};
  const root = 'https://identitytoolkit.googleapis.com/admin/v2/projects/chickenbadminton';
  async function request(url, options={}) {
    const response = await fetch(url,{...options,headers});
    if (!response.ok) throw new Error(`Authentication 設定失敗（HTTP ${response.status}）。`);
    return response.json();
  }
  const current = await request(root+'/config');
  const authorizedDomains = [...new Set([...(current.authorizedDomains||[]),'timothy920611.github.io'])];
  if (write) {
    await request(root+'/config?updateMask=authorizedDomains,signIn.anonymous.enabled', {
      method:'PATCH',body:JSON.stringify({authorizedDomains,signIn:{anonymous:{enabled:true}}}),
    });
    // 保留既有 OAuth client 設定，只停用不再使用的 Google provider。
    await request(root+'/defaultSupportedIdpConfigs/google.com?updateMask=enabled', {
      method:'PATCH',body:JSON.stringify({enabled:false}),
    });
  }
  const verified = write ? await request(root+'/config') : current;
  const google = await request(root+'/defaultSupportedIdpConfigs/google.com');
  console.log(JSON.stringify({dryRun:!write,authorizedDomains:verified.authorizedDomains,anonymousEnabled:verified.signIn?.anonymous?.enabled===true,googleEnabled:google.enabled===true},null,2));
  if (write && (!verified.signIn?.anonymous?.enabled || google.enabled || !verified.authorizedDomains.includes('timothy920611.github.io')))
    throw new Error('正式 Authentication 回讀未符合共用模式。');
} finally { await deleteApp(app); }
