# ChickenBadminton 設定步驟

本版固定使用 GitHub Pages 靜態前端、Firebase Authentication（Google）及 Cloud Firestore Standard / Native mode。沒有 Cloud Functions，也不需要開啟 Blaze。原始碼為 HTML、CSS、ES Modules；Vite 僅在開發與 CI 建置時執行，不是正式站伺服器。瀏覽器從官方 gstatic CDN 載入固定版本 modular Firebase Web SDK。

## 1. Firebase 專案與 Web app

1. 在 [Firebase Console](https://console.firebase.google.com/project/chickenbadminton/overview) 選擇既有 `chickenbadminton`，不要重建或誤刪資料。
2. 專案設定 → 一般 → 你的應用程式 → Web app。既有 app ID 為 `1:307486695888:web:b0dffdc8284a33069919d5`。
3. 選擇 SDK 設定與配置，核對 `.env.production` 的 apiKey、authDomain、projectId、appId。這些是公開識別設定，不是管理員機密。
4. 確認方案維持 Spark。Firestore `(default)` 是 Standard、Native mode、`asia-east1`。新專案應選正式模式，禁止測試模式的全開 Rules。

## 2. 啟用 Google 登入

1. Authentication → Sign-in method → Google → 啟用，選擇專案支援信箱。
2. 停用 Anonymous，不使用舊的無密碼共用選人模式。Google 登入不要求使用者替本站另設密碼。
3. Authentication → Settings → Authorized domains → 加入 `timothy920611.github.io`。這裡不填 `https://`、路徑或 `/*`。
4. 保留 Firebase 的 `chickenbadminton.firebaseapp.com` 網域，Google 彈出登入視窗使用 Firebase Auth handler。前端仍託管於 GitHub Pages。
5. 開啟正式站並點「使用 Google 帳號登入」，允許登入彈出視窗。首頁只列出 `ownerUid == request.auth.uid` 的個人工作區。

## 3. Firestore Rules 與資料歸屬

1. 先跑 `npm ci`、`npm run test:emulators`，再執行 `npx firebase-tools@latest deploy --project chickenbadminton --only firestore`。
2. Rules 預設拒絕；未登入、匿名登入、其他 UID、公開分享憑證及未列出的路徑都拒絕。工作區擁有者只能管理自己的賽事與名冊，不能改 ownerUid。
3. Rules 驗證必填／允許欄位、頂層型別、文字長度、陣列數量、revision 與伺服器時間。深層賽程的商業規則仍由前端驗證；這不授予其他帳號讀寫權，也不能用來實作獎金、計費或不可竄改的官方賽事紀錄。
4. 原本公開協助計分連結已停用。若日後需要多人協作，必須另外設計具名成員授權及最小資料副本，不能恢復「知道連結即可操作全部資料」。
5. 使用者輸入透過 `textContent` 呈現，不放進 `innerHTML`；資料文件不儲存密碼、Google access token 或第三方私鑰。

## 4. 舊資料綁定（管理員操作）

Timothy 的 8 場賽事與 17 位常用選手、guest 的 4 場賽事已匯入。使用者已確認兩個工作區都歸同一個 Google 帳號；在綁定前，缺少 ownerUid 的舊文件一律拒絕前端讀寫。

1. 本人先在正式站使用 Google 登入。
2. 展開「帳號識別碼（舊資料綁定用）」並提供 UID。UID 不是密碼。
3. 管理員執行 `node scripts/assign-legacy-owner.mjs --uid 實際UID`，先 dry-run。
4. 核對該 UID 確為已驗證 Google 帳號及目的工作區，再加 `--write`。工具只新增 ownerUid，不覆寫賽事、不自動認領、不轉移既有擁有者。
5. 綁定後重新整理，核對兩個工作區共 12 場有效賽事與 17 位常用選手。

## 5. 限制公開 API key

1. [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials?project=chickenbadminton)，選擇這個 Web app 使用的 Browser key。
2. Application restrictions → Websites / HTTP referrers，加入 `https://timothy920611.github.io/*`，移除不必要的 localhost 與測試來源。
3. 保留 Firebase 必要 API 的 API restrictions，至少包含 Authentication 使用的 Identity Toolkit API、Token Service API；不要為不相關的付費 API 開放此 key。
4. 實測 Google popup、重新整理後 token 更新與 Firestore 讀寫。如果 Firebase Auth handler 因 referrer 被拒，檢查錯誤來源；必要時只新增實際需要的 `https://chickenbadminton.firebaseapp.com/*`，不要設為所有網站。
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
5. 驗收首頁登入、自己的工作區、分組草稿、計分、不同裝置同帳號同步、不同帳號拒絕、登出與 390px 行動版。Google 真實登入仍須本人確認，Emulator 憑證不等同 Google popup 驗收。
6. 所有變更推回既有分支與 PR，不直接改 main 或合併 PR。

官方 Pages workflow：https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
