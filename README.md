# ChickenBadminton

羽球分組、賽程與計分工具。Vite 多頁前端，使用 Firebase Spark 免費方案的 Hosting、Cloud Firestore 與背景 Anonymous Authentication。

正式網站：https://chickenbadminton.web.app

已完成的部署、匯入與驗證紀錄：[docs/deployment.md](docs/deployment.md)。

## 共用模式

開啟網站後建立或選擇使用者，不需要密碼。使用者是共用的資料分類：任何開啟網站的人，都可以選取任一使用者並管理其賽事。不同裝置選取同一個名稱，即可繼續編輯。請勿將這些使用者當成私人帳號。

背景匿名驗證只建立 Firebase 連線身分，介面沒有登入流程。分享連結 24 小時有效、可撤銷；它提供直接進入計分頁的方式，共用賽事也能從管理頁存取。

## 免費架構與驗證邊界

依使用者選擇維持 **Spark**，不使用需要 Blaze 的 Cloud Functions，也不使用付費 TTL、PITR 或備份功能。資料寫入經 Firestore 用戶端交易；整份賽程檢查 revision，比分交易讀取最新賽程後只修改指定場次，避免不同裝置互相覆蓋。

Security Rules 要求背景驗證、既存 profile、嚴格的頂層欄位、型別、陣列長度、伺服器時間戳及 revision +1，拒絕實體刪除賽事、變更不可變欄位和列舉分享連結。分享到期由 Rules 的 request.time 判斷，不依賴付費 TTL；撤銷會刪除對應 hash 文件。

**與 Functions 版本的差異：複雜巢狀球員／賽程內容與晉級運算由用戶端 domain 模組驗證，不能視為可信任的後端驗證。** 任一訪客本來就獲授權管理所有共用賽事；有意繞過網站的訪客仍可能破壞巢狀資料。此版本適合使用者明確選擇的共用原型，不適合作為私人或對抗惡意寫入的服務。詳見 [安全檢查](docs/security-audit.json)。

免費額度耗盡時服務可能暫停，額度與限制以 [Firebase pricing](https://firebase.google.com/pricing) 為準；此專案不連結計費帳戶、不自動升級。

## 本機開發與測試

需要 Node.js 22.12 以上及 Java 21（Firestore Emulator）。

```bash
npm ci
npm run emulators
```

另一個終端機啟動前端：

```bash
npm run dev -- --mode emulator
```

`.env.emulator` 僅連接本機 `demo-chicken-badminton`，不連正式資料。測試：

```bash
npm test
npx playwright install chromium
npm run test:emulators
npm run build:production
```

`npm test` 執行驗證、賽果、交易、分享及遷移測試；沒有啟動 Firestore Emulator 時明確略過 Rules 測試。`test:emulators` 啟動真正 Auth／Firestore Emulator，再執行 Rules 攻擊測試與跨瀏覽器流程。可設定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 使用既有 Chromium。`E2E_MOCK_BACKEND=1 npm run test:e2e` 只供快速除錯，不取代完整 Emulator 驗證。

## 正式設定與部署

- 專案：`chickenbadminton`（`.firebaserc`）。
- Web app：`1:307486695888:web:b0dffdc8284a33069919d5`。
- Firestore：`(default)`，**STANDARD / FIRESTORE_NATIVE / asia-east1 / freeTier=true**。
- Authentication：Anonymous；正式 Hosting 網域已列入 authorized domains。
- `.env.production` 為公開 Web SDK 設定；不包含管理員憑證。Emulator 模式為 false。

在有該專案管理權限的環境執行：

```bash
npx -y firebase-tools@latest deploy --project chickenbadminton --only auth,firestore,hosting
```

Hosting predeploy 會重新建置並檢查正式設定及產物。僅發佈 `dist/`；不包含舊 `json/`、`users/`、原始碼、遷移工具或服務帳戶檔案。首次部署前需啟用 Firestore API，建立上述免費資料庫，並檢查現有資源。之後不要重新建立資料庫或 Web app。

## 專案結構與舊資料

`src/pages/` 是頁面控制器、`src/styles/` 是 CSS、`src/domain/` 是運算／欄位驗證；`src/services/` 封裝背景驗證、共用操作與 Firestore 交易。HTML 保留語意結構，public 僅包含圖示及說明圖。

資料位於 `profiles/{profileId}`、其下的 `games/{gameId}` 與 `settings/frequentPlayers`。封存保留原資料並撤銷分享。

舊 JSON 僅作遷移來源，新版網站不讀寫 GitHub。請參考 [遷移說明](docs/migration.md)。工具預設 dry-run，只讀取索引中的有效賽事與常用名冊；不覆蓋目的文件、不修改來源、不匯入 trash、孤立檔案或舊密碼。舊版曾曝光的 GitHub PAT 應撤銷，移除目前程式碼不會清除 Git 歷史。

## 規則原型

I've set up prototype Security Rules to keep the data in Firestore safe. They are designed to be secure for authenticated shared access, bounded document envelopes, revision checks, server timestamps, and non-enumerable expiring share links. However, you should review and verify them before broadly sharing your app. If you'd like, I can help you harden these rules.
