# 🏸 小雞羽球計分板 ChickenBadminton

純 HTML、CSS、JavaScript（ES Modules）前端，使用 Vite 建置、GitHub Actions 發布 GitHub Pages；後端只有 Firebase Authentication（Google）與 Cloud Firestore。Firebase modular Web SDK 由官方 CDN 載入，正式網站不需要 Node 伺服器或 Cloud Functions。

目標正式網址：**https://timothy920611.github.io/ChickenBadminton/**。發布／驗收狀態請以 [部署紀錄](docs/deployment.md) 為準；不要將網址可開啟誤認成新版已發布。

## 個人資料與安全

- 先以 Google 帳號登入，再建立或選取自己的工作區。跨裝置使用同一 Google 帳號即可同步；取消以前任何訪客都能選人的共用模式。
- `profiles/{profileId}.ownerUid` 對應 Firebase UID，建立後不可由前端改動。Rules 在每條讀寫路徑檢查所有權，未登入、匿名、其他帳號及未列出的路徑一律拒絕。
- `profiles` 清單必須使用 `where('ownerUid', '==', auth.uid)` 查詢；Rules 不會自動過濾不屬於你的資料。
- 驗證必填與允許欄位、頂層型別、字串長度、清單數量、revision 與伺服器時間。深層分組／淘汰賽商業不變量由前端 domain 驗證，並非可信任裁判或反作弊機制。詳見 [安全檢查](docs/security-audit.json)。
- 使用者內容用 `textContent` 呈現。公開協助計分連結已停用；不以分享 token 繞過所有權。
- `firebaseConfig`、reCAPTCHA site key 是公開設定。Admin SDK 憑證、service account JSON、reCAPTCHA secret、第三方私鑰與 PAT 都不得出現在 repo、前端或 Pages artifact。
- 已建立用於驗證的原型 Security Rules，透過 UID 隔離與預設拒絕保護資料。廣泛分享前仍應審查與驗證；目前的深層資料驗證限制不可當成已完成的後端反作弊驗證。

## 完整設定步驟

依序完成 [設定清單](docs/setup.md)：Firebase 專案／Web config、Google 登入與授權網域、API key 限制、App Check、Spark／預算警示、GitHub 2FA／main 保護規則及 Pages Actions 發布。清單區分已自動設定與需要本人操作的項目。

## 開發與測試

Node.js 22.12 以上、Firestore Emulator 需要 Java 21。

```bash
npm ci
npm run dev -- --mode emulator
# 另一個終端啟動 Auth 與 Firestore Emulator
npm run emulators
```

Emulator 使用 `demo-chicken-badminton`，不能連到正式資料庫。測試中的模擬 Google credential 只適用 Auth Emulator，正式 Firebase 不接受。

```bash
npm test
npm run test:emulators
npm run build:production
```

`npm test` 在沒有 Emulator 時會明確略過 Rules 測試；完整驗收要執行 `test:emulators`，包含實際 Rules 與 Chromium 操作。瀏覽器需連上官方 SDK CDN；可使用 `npx playwright install chromium` 安裝測試瀏覽器。

## 發布

1. Repo Settings → Pages → Source 選 **GitHub Actions**。
2. `github-pages` environment 允許目前分支 `refactor/firebase-modular-frontend`；未經使用者授權不得合併 PR。
3. 推送分支後 `.github/workflows/pages.yml` 執行測試、建置及發布，僅上傳 `dist/`。前端資源使用相對 base，支援 `/ChickenBadminton/` 子路徑。
4. 後端設定另外由已授權管理員部署：

```bash
npx firebase-tools@latest deploy --project chickenbadminton --only auth,firestore
```

不從 GitHub Actions 部署 Firebase 管理設定，不在 GitHub Secrets 放管理員憑證。保留的 Firebase Hosting 設定僅供舊網址遷移，不是本版正式前端託管方式。

## 舊資料

12 場有效賽事與 17 位常用選手已匯入 Firebase，原始 31 份 JSON 保留在本機、停止 Git 追蹤，也不進入 Pages artifact。既有公開 Git 歷史不會因這次刪除檔案而消失。

使用者確認 Timothy 與 guest 兩個工作區都歸自己的 Google 帳號。本人完成一次 Google 登入後，由管理員透過 [歸屬綁定工具](scripts/assign-legacy-owner.mjs) 核對 UID 再綁定；無 ownerUid 的舊資料預設封鎖，不讓訪客自行認領。

參閱 [資料遷移](docs/migration.md)、[原始匯入紀錄](docs/migration-record.json)。

## 程式結構

`src/pages/` 為頁面控制器，`src/styles/` 為樣式，`src/domain/` 為賽程運算與前端驗證，`src/services/` 為 Google 登入、資料讀寫與交易，`src/ui/` 為安全 DOM 呈現。`public/` 只有圖示及說明圖，`scripts/` 的 Admin SDK 工具不會進入正式網站。
