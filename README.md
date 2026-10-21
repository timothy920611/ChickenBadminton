# 🏸 小雞羽球計分板 ChickenBadminton

前端是純 HTML、CSS、JavaScript ES Modules，Vite 僅供建置，GitHub Actions 發布 GitHub Pages；後端使用 Firebase Authentication 背景匿名驗證及 Cloud Firestore。瀏覽器直接從官方 CDN 載入 modular Firebase Web SDK，不使用 Cloud Functions，也不需要正式 Node 伺服器。

正式網站：**https://timothy920611.github.io/ChickenBadminton/**。舊 Firebase 網址會轉往 Pages。驗證紀錄見 [部署紀錄](docs/deployment.md)。

## 共用模式

開啟網站就直接列出 Timothy、guest 等使用者，也可以建立新使用者。不顯示登入，不需要 Google 帳號、密碼或舊資料綁定；不同裝置選取相同使用者，就能繼續管理賽事。

**這些使用者是公開共用工作區，不是私人帳號。任何訪客都能讀取及管理任一工作區的賽事與常用選手。** 不儲存密碼、私人聯絡資訊、登入憑證或其他不應公開的欄位。背景匿名 Auth 僅建立 Firebase 連線身分，不代表資料擁有權。

賽事、球員、分組草稿、賽程、戰績、專業計分板及名冊均保留。協助計分連結 24 小時有效、可撤銷，但不構成私人資料邊界，其他訪客仍能從共用工作區存取同一場賽事。

## 安全與免費方案

- 維持 Firebase Spark，不使用 Cloud Functions、付費 TTL、PITR 或自動升級。
- Firestore Rules 預設拒絕，只開放必要路徑給有背景驗證身分的訪客；未驗證請求、未知路徑及分享憑證列舉都拒絕。
- 建立與更新皆驗證頂層必填／允許欄位、型別、文字長度、清單數量、revision 及伺服器時間。整份賽程防舊版覆寫，比分以交易更新最新資料。
- 所有使用者輸入以 DOM／textContent 呈現，不用 innerHTML 解析。
- API key 僅允許 `https://timothy920611.github.io/*`，保留原有 Firebase API 限制。firebaseConfig 是公開識別資料，不是管理員金鑰。
- App Check 已接好 reCAPTCHA v3 初始化；需本人完成註冊及設定公開 site key 後才可觀察與強制執行。
- 已建立原型 Security Rules。共用存取是本系統的明確授權，不是 UID 私有隔離；深層賽程商業規則由可繞過的前端驗證，不能當成可信任裁判或反作弊機制。廣泛分享前仍應審查，詳見 [安全檢查](docs/security-audit.json)。

## 設定與操作

完整點選步驟見 [設定清單](docs/setup.md)，包含 Firebase、Auth、Firestore、授權網域、API key、App Check、Spark／預算警示、GitHub 2FA／main 保護及 Pages 發布。

Node.js 22.12 以上，Firestore Emulator 使用 Java 21：

```bash
npm ci
npm run dev -- --mode emulator
# 另一個終端
npm run emulators
```

```bash
npm test
npm run test:emulators
npm run build:production
```

沒有 Emulator 時，npm test 會明確略過 Rules 測試；完整驗收要執行 test:emulators，包含實際 Rules 與 Chromium。測試瀏覽器可用 `npx playwright install chromium` 安裝；需要能連線官方 SDK CDN。

GitHub Pages Source 選 GitHub Actions，github-pages environment 允許 `refactor/firebase-modular-frontend`。Pages workflow 測試通過後只發布 dist/，相對資源路徑支援 /ChickenBadminton/。不在 Actions 放 Firebase 管理員憑證，也不自行合併 PR。

管理員後端設定：

```bash
npx firebase-tools@latest deploy --project chickenbadminton --only firestore
node scripts/configure-auth.mjs --write
```

configure-auth 預設 dry-run；正式寫入後會回讀，確保匿名驗證啟用、Google provider 停用與 Pages 授權網域存在。使用本機既有 ADC，不建立或匯出 service account 金鑰。

## 舊資料

Timothy 8 場賽事＋17 位常用選手，guest 4 場賽事，已匯入 13 份文件。共用模式直接顯示，不需綁定 UID、不重複匯入。31 份 JSON 本機來源保留，但不再 Git 追蹤，也不發布到 Pages。既有 Git 歷史仍可能含舊資料。

參閱 [遷移說明](docs/migration.md)、[匯入紀錄](docs/migration-record.json)。Admin SDK 僅用於本機管理／遷移工具，不進入網站。

## 程式結構

src/pages 為頁面控制器，src/styles 為 CSS，src/domain 為賽程運算與前端驗證，src/services 為背景驗證、共用操作與 Firestore 交易，src/ui 為安全 DOM 呈現。public 僅有圖示與說明圖；hosting-redirect 僅供舊網址搬家，不提供前端應用程式。
