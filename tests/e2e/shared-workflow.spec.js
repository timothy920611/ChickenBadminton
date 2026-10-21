import { test, expect } from '@playwright/test';
import { createMockBackend } from './mock-backend.js';

// Run with the Auth, Firestore and Functions emulators. No production data is used.
test('shared users work across browsers and helper links update only scores', async ({ page, browser, baseURL }) => {
  const attachBackend = createMockBackend();
  await attachBackend(page.context());
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const profileName = `共享測試 ${suffix}`;
  const gameName = `週末球局 ${suffix}`;
  const pageErrors = [];
  const attachChecks = target => {
    target.on('pageerror', error => pageErrors.push(error.message));
    target.on('dialog', dialog => dialog.accept());
  };
  attachChecks(page);
  await page.goto('/index.html');
  await expect(page.getByRole('button', { name: '建立並進入', exact: true })).toBeEnabled();
  await expect(page.locator('#statusMsg')).toContainText('選取使用者');
  await page.locator('#profileName').fill(profileName);
  await page.getByRole('button', { name: '建立並進入', exact: true }).click();
  await expect(page).toHaveURL(/dashboard\.html$/);
  await expect(page.locator('#displayUser')).toHaveText(profileName);

  // A stored roster is scoped to the selected shared profile.
  await page.locator('#fpName').fill('常用甲');
  await page.locator('#fpLevel').selectOption('10');
  await page.locator('#btnAddFp').click();
  await expect(page.locator('#fpList')).toContainText('常用甲');
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
  const helperContext = await browser.newContext({ baseURL });
  try {
    await attachBackend(secondContext);
    await attachBackend(helperContext);
    const second = await secondContext.newPage();
    attachChecks(second);
    await second.goto('/index.html');
    await second.getByRole('button', { name: `👤 ${profileName}`, exact: true }).click();
    await expect(second).toHaveURL(/dashboard\.html$/);
    await expect(second.locator('#displayUser')).toHaveText(profileName);
    await expect(second.locator('#fpList')).toContainText('常用甲');
    const gameCard = second.locator('.game-card').filter({ has: second.getByRole('heading', { name: gameName, exact: true }) });
    await gameCard.getByRole('button', { name: '進入計分板', exact: true }).click();
    await expect(second).toHaveURL(/gamestart\.html\?gameId=/);
    await expect(second.locator('#schedulesWrapper .score-display')).toHaveText(['21', '15']);

    await page.getByRole('button', { name: '🔗 邀請協助計分', exact: true }).click();
    await expect(page.locator('#shareUrl')).toHaveValue(/helper\.html#token=.+/);
    const shareUrl = await page.locator('#shareUrl').inputValue();
    const helper = await helperContext.newPage();
    attachChecks(helper);
    await helper.goto(shareUrl);
    await expect(helper.locator('#mainContent .score-display')).toHaveText(['21', '15']);
    await helper.getByRole('button', { name: '✏️ 修改分數', exact: true }).click();
    await helper.getByRole('spinbutton', { name: '第一隊分數', exact: true }).fill('19');
    await helper.getByRole('spinbutton', { name: '第二隊分數', exact: true }).fill('21');
    await helper.getByRole('button', { name: '✅ 確認分數', exact: true }).click();
    await expect(helper.locator('#mainContent .score-display')).toHaveText(['19', '21']);
    await expect(page.locator('#schedulesWrapper .score-display')).toHaveText(['19', '21']);
    await expect(second.locator('#schedulesWrapper .score-display')).toHaveText(['19', '21']);

    await page.getByRole('button', { name: '撤銷分享連結', exact: true }).click();
    await expect(page.locator('#shareExpiry')).toHaveText('分享連結已撤銷。');
    await helper.getByRole('button', { name: '🔄 重新整理', exact: true }).click();
    await expect(helper.locator('#mainContent')).toContainText('分享連結已失效');
    await expect(helper.locator('#mainContent input')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  } finally {
    await secondContext.close();
    await helperContext.close();
  }
});
