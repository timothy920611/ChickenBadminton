# ChickenBadminton

羽球分組、賽程與計分工具。前端採 Vite 多頁入口，後端使用 Firebase Cloud Firestore 與 Cloud Functions。

## 使用方式

開啟網站後建立或選擇使用者，不需要密碼。使用者是共用的資料分類：任何開啟網站的人，都可以選取任一使用者並管理其賽事。不同裝置選取同一個名稱，就能繼續編輯。請勿將這些使用者當成私人帳號。

Firebase Anonymous Authentication 只在背景建立連線身分，介面沒有登入流程。應用程式不儲存密碼。協助計分連結限時 24 小時，可撤銷；它提供直接進入計分頁的方式，不會讓共用賽事變成私人資料。

## 本機開發

需要 Node.js 22.12 以上及 Java 21（Firestore Emulator）。

```bash
npm ci
npm --prefix functions ci
npm run emulators
```

另一個終端機啟動前端：

```bash
npm run dev -- --mode emulator
```

使用終端機顯示的本機網址。`.env.emulator` 只連接 `demo-chicken-badminton` 的本機模擬器，不需要 Firebase 專案。Emulator 資料預設不持久保存。

```bash
npm test
npm run build
npm run test:emulators
```

`npm test` 執行資料驗證、賽果、併發及遷移測試；未啟動 Firestore Emulator 時會明確略過 Rules 整合測試。`test:emulators` 會啟動 Auth、Firestore、Functions，再執行完整測試及瀏覽器流程。瀏覽器測試需先執行 `npx playwright install chromium`，或設定 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` 使用已安裝的 Chromium。

若環境無法下載 Firestore Emulator，可先執行 `E2E_MOCK_BACKEND=1 npm run test:e2e`。此模式使用真正的頁面與後端驗證／交易服務，替換 Firebase 連線與資料儲存層；不涵蓋 Firebase SDK 連線與 Security Rules。CI 會使用完整模擬器模式驗證。

## Firebase 設定與部署

本次未建立或部署正式 Firebase 專案。後續設定：

1. 在 Firebase Console 建立專案與 Web app，啟用 **Authentication → Anonymous**。
2. 建立 **Standard edition、Native mode** 的 Cloud Firestore `(default)` 資料庫；本程式及模擬器以這個 edition 為目標。區域可選 `asia-east1`，與 Functions 的設定一致。
3. 部署 Functions 需要 Firebase Blaze 方案。確認計費設定後，複製 `.env.example` 為 `.env.local`，填入 Web app 的 Firebase config。這些前端設定不是管理員私鑰；服務帳戶憑證不得放入前端或 Git。
4. 將正式網站的網域加入 Authentication 的 Authorized domains（只填網域，不包含協定或 port）。
5. 在已授權的開發環境執行：

```bash
npx firebase login
npm run build
npx firebase deploy --project YOUR_PROJECT_ID --only firestore,functions,hosting
```

`firebase.json` 只發佈 `dist/`。舊的 `json/`、`users/`、遷移工具、原始碼及服務帳戶檔不會被複製到 Hosting。

## 專案結構

```text
*.html                    各頁語意結構及入口
src/pages/                頁面控制邏輯
src/styles/               各頁 CSS
src/domain/               球員、分組與賽程運算
src/ui/                   共用賽程渲染
src/services/             Firebase、共用使用者、資料存取與快取
functions/                Callable API、驗證與交易
public/                   圖示及 CSV 說明圖
scripts/migrate-legacy.mjs 舊 JSON 遷移（預設 dry-run）
```

Firestore 的資料位於 `profiles/{profileId}`、其下的 `games/{gameId}` 與 `settings/frequentPlayers`。所有使用者都能讀取這些共用資料；所有寫入均由 Callable API 驗證。整份賽程儲存會比對 revision，比分則在交易中只修改指定場次，避免不同裝置互相覆蓋。封存比賽會保留原資料並撤銷協助連結。

## 舊資料

請參考 [遷移說明](docs/migration.md)。原 JSON 保留作為遷移來源，網站執行時不再讀寫 GitHub。舊版曾將 GitHub 憑證放在瀏覽器程式碼內；請撤銷該憑證，因為移除目前版本無法消除 Git 歷史中的曝光。舊密碼資料不參與遷移。

## 設計與規則

本次保留原有視覺，將 CSS、頁面邏輯及後端分離，因此不需要建立 Figma 設計檔。

Firestore Security Rules 是原型規則：允許背景匿名連線讀取使用者刻意共用的賽事，拒絕所有瀏覽器直接寫入與分享 token 文件讀取；寫入由後端逐層驗證。廣泛公開前仍應 review 與驗證這些規則及共用模式是否符合實際用途。
