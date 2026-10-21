# ChickenBadminton 設定步驟

本版固定使用 GitHub Pages 靜態前端、Firebase Authentication（背景 Anonymous）及 Cloud Firestore Standard / Native mode。沒有 Cloud Functions，也不需要開啟 Blaze。原始碼為 HTML、CSS、ES Modules；Vite 僅在開發與 CI 建置時執行，不是正式站伺服器。瀏覽器從官方 gstatic CDN 載入固定版本 modular Firebase Web SDK。

## 1. Firebase 專案與 Web app

1. 在 [Firebase Console](https://console.firebase.google.com/project/chickenbadminton/overview) 選擇既有 `chickenbadminton`，不要重建或誤刪資料。
2. 專案設定 → 一般 → 你的應用程式 → Web app。既有 app ID 為 `1:307486695888:web:b0dffdc8284a33069919d5`。
3. 選擇 SDK 設定與配置，核對 `.env.production` 的 apiKey、authDomain、projectId、appId。這些是公開識別設定，不是管理員機密。
4. 確認方案維持 Spark。Firestore `(default)` 是 Standard、Native mode、`asia-east1`。新專案應選正式模式，禁止測試模式的全開 Rules。

## 2. 啟用背景匿名驗證

1. Authentication → Sign-in method → Anonymous → 啟用。前端會自動 signInAnonymously，不顯示登入畫面。
2. 不使用 Google provider；一般訪客不需要 Google 帳號或密碼。
3. Authentication → Settings → Authorized domains → 加入 `timothy920611.github.io`。不填 https://、路徑或 /*。
4. 管理員先跑 `node scripts/configure-auth.mjs` dry-run，再加 `--write`，透過官方管理 API 套用並回讀匿名啟用、Google 停用與 Pages 授權網域。不要只依賴 CLI 成功訊息。
5. 開啟正式網站，直接選 Timothy、guest 或建立新使用者。背景匿名 UID 不代表資料所有權。

## 3. Firestore Rules 與共用權限

1. 執行 `npm ci`、`npm run test:emulators`，再以 `npx firebase-tools@latest deploy --project chickenbadminton --only firestore` 部署。
2. Rules 預設拒絕，只開放必要工作區、賽事、名冊與分享路徑。未驗證請求、未知路徑及分享 hash 列舉一律拒絕。
3. 本系統刻意讓所有訪客管理任一工作區，因此不使用 ownerUid 限制，也不宣稱只有本人能存取。不要在文件放密碼、email、電話、登入憑證或不應公開的欄位。
4. 建立及更新均驗證頂層必填／允許欄位、型別、字串長度、陣列數量、revision 與伺服器時間。深層球員／賽程商業規則仍由可繞過的前端檢查；這不是可信任裁判或反作弊後端。
5. 任何訪客仍可從清單開啟賽事，因此 24 小時、可撤銷的協助計分連結只是便利入口，不是私人資料邊界。
6. 顯示使用者輸入時用 textContent，不解析為 HTML。原型 Rules 廣泛分享前仍應審查，詳見 security-audit.json。

## 4. 舊資料

Timothy 8 場賽事與 17 位常用選手、guest 4 場賽事已匯入，共 13 份目的文件。直接列出，不需要 Google 登入、認領或 UID 綁定。不要重複匯入或覆寫既有賽事。

原始 json/ 在本機保留，停止 Git 追蹤及網站發布。新的資料只寫入 Firestore，所有人可讀寫；不儲存私人欄位。

## 5. 限制公開 API key

1. [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials?project=chickenbadminton)，選擇這個 Web app 使用的 Browser key。
2. Application restrictions → Websites / HTTP referrers，加入 `https://timothy920611.github.io/*`，移除不必要的 localhost 與測試來源。
3. 保留 Firebase 必要 API 的 API restrictions，至少包含 背景匿名驗證使用的 Identity Toolkit API、Token Service API；不要為不相關的付費 API 開放此 key。
4. 實測背景匿名驗證、重新整理後的 token 更新與 Firestore 讀寫；其他網站來源應遭拒絕。不要把 referrer 放寬為所有網站。
5. HTTP referrer 限制是降低濫用的額外措施，可以被非瀏覽器偽造，不能替代 Rules 或 App Check。

官方說明：https://firebase.google.com/docs/projects/api-keys

## 6. App Check：先觀察，再強制

1. 在 [reCAPTCHA 管理介面](https://www.google.com/recaptcha/admin/create) 建立 reCAPTCHA v3，網域填 `timothy920611.github.io`。
2. 取得公開 **site key** 與私密 **secret key**。secret 只輸入 Firebase Console，不放 repo、環境範本、Actions artifact 或前端程式。
3. Firebase Console → App Check → 選擇既有 Web app → reCAPTCHA v3 → 輸入 secret，註冊應用程式。
4. 在 `.env.production` 填入 `VITE_APPCHECK_SITE_KEY=公開sitekey` 並重新建置發布。`src/services/firebase.js` 已在 Auth/Firestore 初始化前接好：

```js
// 兩個模組皆由 https://www.gstatic.com/firebasejs/12.19.0/ 官方 CDN 載入。
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(publicSiteKey),
  isTokenAutoRefreshEnabled: true,
});
```

5. 到 App Check metrics 確認正式請求有有效 token，再對 Cloud Firestore 啟用 enforcement。未完成 site key 與驗證前不可直接強制，否則整站會被封鎖。
6. 本機 Emulator 不啟用 App Check。不要在正式站部署 debug token。App Check 不替代使用者 UID 權限。

官方步驟：https://firebase.google.com/docs/app-check/web/recaptcha-provider

## 7. 免費方案與預算警示

1. Firebase 專案維持 Spark、未連結 Billing account 時，不能替「不存在的計費帳戶」建立 Cloud Billing 預算；不為設定警示而升級 Blaze。
2. 在 Firestore Usage 追蹤免費讀寫額度。Spark 超額會限制服務，不代表無限免費。
3. 日後若本人決定連結計費帳戶：Cloud Console → Billing → Budgets & alerts → Create budget → Scope 選 chickenbadminton → 設每月金額與 50%、90%、100% 通知，填通知收件人。
4. 預算警示不是硬性支出上限，不能保證自動停止費用。

官方說明：https://cloud.google.com/billing/docs/how-to/budgets

## 8. GitHub repo、安全與主分支保護

1. Repo：`timothy920611/ChickenBadminton`。GitHub Free 的 Pages 需公開 repo；GitHub Pro 等方案可支援私人 repo 的 Pages。
2. 公開 repo 不可放 service account JSON、Admin SDK 憑證、OAuth client secret、PAT、reCAPTCHA secret 或球員私人資料。舊 JSON 僅保留在本機遷移來源，不再追蹤或發布。
3. 既有 Git 歷史及 main 分支可能仍有舊資料；刪除新分支檔案不會清除歷史。若這些舊資料不應公開，需要另行規劃歷史清理；不可宣稱 Firestore Rules 能保護已公開的 Git 版本。
4. GitHub 個人 Settings → Password and authentication → 開啟 2FA，保存 recovery codes。此步驟必須由帳號本人操作，不收集你的驗證碼。
5. Repo Settings → Rules → Rulesets → New branch ruleset → Target `main`：要求 PR、至少一位審查者、要求 `test` 檢查通過、封鎖 force push 與分支刪除。依實際協作人數設定審查者，避免唯一維護者被鎖住。
6. 維持 PR #17 為 Draft；不自動合併。首次部署允許目前 `refactor/firebase-modular-frontend`，完成合併後可把 Pages workflow 改為只從 `main` 發布。

## 9. GitHub Pages 發布

1. Repo Settings → Pages → Build and deployment → Source 選 **GitHub Actions**。
2. Repo Settings → Environments → `github-pages`：允許 `main` 與 `refactor/firebase-modular-frontend` 部署；若目前只允許 main，第一次分支部署會被擋住。
3. `.github/workflows/pages.yml` 先跑 Rules Emulator 與 Chromium 測試，再建置及上傳 **只有 dist/** 的 artifact，最後以 `actions/deploy-pages` 發布。不需要 Firebase 管理員 key 或 GitHub PAT。
4. 正式網址：`https://timothy920611.github.io/ChickenBadminton/`。Vite `base: './'`，避免 `/assets/` 指向帳號網站根目錄而造成 404。
5. 驗收首頁直接列出工作區、12 場舊賽事、17 人名冊、分組草稿、計分、不同裝置選同一工作區同步、分享與撤銷、切換使用者及 390px 行動版。
6. 所有變更推回既有分支與 PR，不直接改 main 或合併 PR。

官方 Pages workflow：https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
