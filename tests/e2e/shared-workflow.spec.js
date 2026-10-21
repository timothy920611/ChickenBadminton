import { test, expect } from '@playwright/test';
// Emulator 專用 Google credential，正式站不接受這種測試憑證。
async function signIn(page, uid = 'owner-e2e') {
  await page.evaluate(async uid => {
    const { auth } = await import('/src/services/firebase.js');
    const { GoogleAuthProvider, signInWithCredential } = await import('https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js');
    const encode = value => btoa(JSON.stringify(value)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
    const token = `${encode({alg:'none',typ:'JWT'})}.${encode({sub:uid,email:`${uid}@example.test`,email_verified:true,name:uid,aud:'demo-chicken-badminton',iss:'https://accounts.google.com',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600})}.`;
    await signInWithCredential(auth, GoogleAuthProvider.credential(token));
    await window.loadProfiles();
  }, uid);
}


// Run with the Auth and Firestore emulators. No production data is used.
test('個人工作區跨裝置同步、分組、計分與 XSS 防護', async ({ page, browser, baseURL }) => {
  const suffix = process.env.E2E_RUN_ID || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const profileName = `我的工作區 ${suffix}`;
  const gameName = `週末球局 ${suffix}`;
  const pageErrors = [];
  const attachChecks = target => {
    target.on('pageerror', error => pageErrors.push(error.message));
    target.on('dialog', dialog => dialog.accept());
  };
  attachChecks(page);
  await page.goto('/index.html');
  await expect(page.getByRole('button',{name:'使用 Google 帳號登入',exact:true})).toBeEnabled();
  await signIn(page);
  await expect(page.getByRole('button', { name: '建立並進入', exact: true })).toBeEnabled();
  await expect(page.locator('#statusMsg')).toContainText('選取你的工作區');
  await page.locator('#profileName').fill(profileName);
  await page.getByRole('button', { name: '建立並進入', exact: true }).click();
  await expect(page).toHaveURL(/dashboard\.html$/);
  await expect(page.locator('#displayUser')).toHaveText(profileName);

  // A stored roster is scoped to the selected shared profile.
  await page.locator('#fpName').fill('<img src=x onerror=alert(1)>');
  await page.locator('#fpLevel').selectOption('10');
  await page.locator('#btnAddFp').click();
  await expect(page.locator('#fpList')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#fpList img')).toHaveCount(0);
  await expect(page.locator('#fpSyncStatus')).toContainText('已');
  await page.locator('#newGameName').fill(gameName);
  await page.locator('#createGameBtn').click();
  await expect(page).toHaveURL(/play\.html\?gameId=/);
  await expect(page.locator('#btnAddPlayer')).toBeEnabled();

  for (const [index, name] of ['球員甲', '球員乙', '球員丙', '球員丁'].entries()) {
    await page.locator('#playerName').fill(name);
    await page.locator('#playerLevel').selectOption(String(6 + index));
    await page.locator('#btnAddPlayer').click();
    await expect(page.locator('#playerCount')).toHaveText(String(index + 1));
    await expect(page.locator('#playerSyncStatus')).toContainText('已同步');
  }
  await page.getByRole('button', { name: /自動分組 → 單輪賽事/ }).click();
  await expect(page.locator('#teamsDragGrid .drag-player')).toHaveCount(4);
  await page.getByRole('button', { name: '💾 儲存分組草稿', exact: true }).click();
  await expect(page.locator('#btnLoadDraft')).toBeVisible();
  await page.reload();
  await expect(page.locator('#draftStatus')).toContainText('已儲存分組草稿');
  await page.locator('#btnLoadDraft').click();
  await expect(page.locator('#teamsDragGrid .drag-player')).toHaveCount(4);
  await page.getByRole('button', { name: '✅ 確認 → 開始單輪賽事', exact: true }).click();
  await expect(page).toHaveURL(/gamestart\.html\?gameId=/);
  await expect(page.locator('#schedulesWrapper .match-card')).toHaveCount(1);
  await page.getByRole('spinbutton', { name: '第一隊分數', exact: true }).fill('21');
  await page.getByRole('spinbutton', { name: '第二隊分數', exact: true }).fill('15');
  await page.getByRole('button', { name: '✅ 確認分數', exact: true }).click();
  await expect(page.locator('#schedulesWrapper .score-display')).toHaveText(['21', '15']);

  // The separate scoreboard returns ordered partial and final scores to its
  // originating game, without requiring a profile selection in the popup.
  await page.getByRole('button', { name: '✏️ 修改分數', exact: true }).click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: '🎯 專業計分板', exact: true }).click();
  const scoreboard = await popupPromise;
  attachChecks(scoreboard);
  await scoreboard.waitForFunction(() => typeof window.finishAndReturn === 'function');
  await scoreboard.keyboard.press('a');
  await scoreboard.keyboard.press('a');
  await scoreboard.keyboard.press('l');
  await expect(page.getByRole('spinbutton', { name: '第一隊分數', exact: true })).toHaveValue('2');
  await expect(page.getByRole('spinbutton', { name: '第二隊分數', exact: true })).toHaveValue('1');
  await scoreboard.evaluate(() => window.finishAndReturn());
  await expect(page.locator('#schedulesWrapper .score-display')).toHaveText(['2', '1']);
  // Restore the fixture score before checking cross-browser sharing.
  await page.getByRole('button', { name: '✏️ 修改分數', exact: true }).click();
  await page.getByRole('spinbutton', { name: '第一隊分數', exact: true }).fill('21');
  await page.getByRole('spinbutton', { name: '第二隊分數', exact: true }).fill('15');
  await page.getByRole('button', { name: '✅ 確認分數', exact: true }).click();
  await expect(page.locator('#schedulesWrapper .score-display')).toHaveText(['21', '15']);

  const secondContext = await browser.newContext({ baseURL });
  const otherContext = await browser.newContext({ baseURL });
  try {
    const second = await secondContext.newPage();
    attachChecks(second);
    await second.goto('/index.html');
    await signIn(second);
    await second.getByRole('button', { name: `👤 ${profileName}`, exact: true }).click();
    await expect(second).toHaveURL(/dashboard\.html$/);
    await expect(second.locator('#displayUser')).toHaveText(profileName);
    await expect(second.locator('#fpList')).toContainText('<img src=x onerror=alert(1)>');
    const gameCard = second.locator('.game-card').filter({ has: second.getByRole('heading', { name: gameName, exact: true }) });
    await gameCard.getByRole('button', { name: '進入計分板', exact: true }).click();
    await expect(second).toHaveURL(/gamestart\.html\?gameId=/);
    await expect(second.locator('#schedulesWrapper .score-display')).toHaveText(['21', '15']);

    // 不同 Google 帳號看不到工作區，竄改本機選取 ID 也無法取得資料。
    const other = await otherContext.newPage(); attachChecks(other);
    await other.goto('/index.html'); await signIn(other, 'other-e2e');
    await expect(other.getByRole('button', { name: `👤 ${profileName}`, exact: true })).toHaveCount(0);
    await expect(page.locator('#fpList img')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '🔗 邀請協助計分', exact: true })).toHaveCount(0);
    const legacyLink = await otherContext.newPage();
    await legacyLink.goto('/helper.html#token=old-link');
    await expect(legacyLink.locator('#mainContent')).toContainText('公開協助計分連結已停用');
    await expect(legacyLink.locator('#mainContent input')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await secondContext.close();
    await otherContext.close();
  }
});

test('controls remain disabled while the entry module is still loading', async ({page}) => {
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  await page.route(/\/(?:src\/pages\/index\.js|assets\/index-[^/]+\.js)(?:\?|$)/,async route=>{await gate;await route.continue();});
  try {
    await page.goto('/index.html',{waitUntil:'commit'});
    await expect(page.locator('#profileName')).toBeDisabled();
    await expect(page.getByRole('button',{name:'使用 Google 帳號登入',exact:true})).toBeDisabled();
    release();
    await expect(page.getByRole('button',{name:'使用 Google 帳號登入',exact:true})).toBeEnabled();
  } finally {release();}
});
