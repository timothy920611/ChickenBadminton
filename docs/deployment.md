# 部署紀錄（2026-10-21，Asia/Taipei）

## 最終架構

- 前端：`https://timothy920611.github.io/ChickenBadminton/`，純 HTML／CSS／JavaScript ES Modules，由 GitHub Actions 建置發布 dist/。瀏覽器從官方 CDN 載入 modular Firebase SDK。
- 後端：既有 Firebase chickenbadminton，背景匿名 Auth＋Firestore，共用模式直接選人，不顯示 Google 登入，也不需要舊資料綁定。
- 資料庫重新確認為 `(default)`／STANDARD／FIRESTORE_NATIVE／asia-east1／freeTier=true，PITR 關閉。gcloud 重新確認 billingEnabled=false，維持 Spark，未啟用 Cloud Functions 或計費。
- 舊 chickenbadminton.web.app 已部署為 302 轉往 Pages，Firebase Hosting 只存一份搬家頁，沒有前端應用程式。
- Web API key 已限制 `https://timothy920611.github.io/*`，允許來源回應 200，其他來源回應 403，保留原有 API 限制。

## 資料與權限

| 共用工作區 | 有效賽事 | 常用選手 |
| --- | ---: | ---: |
| Timothy | 8 | 17 |
| guest | 4 | 0 |

先前已匯入 12 場賽事及一份名冊，共 13 份文件，逐欄讀回核對通過；原始 31 份 JSON 保留本機，不再 Git 追蹤或發佈至 Pages。不重複匯入、不覆寫賽事。詳見 migration-record.json。

本系統刻意讓任何訪客都能管理所有工作區，不是私人帳號。Rules 預設拒絕未知路徑及未經背景驗證的請求，檢查頂層欄位、型別、長度、數量、revision 與時間；深層商業規則仍由可繞過的前端處理。協助計分連結 24 小時有效、可撤銷，但不是私人權限邊界。原型 Rules 的界線見 security-audit.json。

## 發布與驗證

首次 Pages 工作流程 39617062138 已成功建立網站，CI 39617072777 已通過。本版最後回復共用模式的提交與正式驗證結果，將更新在 PR #17；不以暫時的私人版結果冒充共用版已完成。

本機實際 Emulator 的 36 項測試、2 項 Chromium 流程及正式建置通過，含三個獨立瀏覽器、共用選人、名冊 XSS、分組草稿、專業計分板、同步比分、分享、撤銷與延遲載入。正式共用部署與 UI 的最後驗證以 PR 及輸出紀錄為準。PR 保持 Draft，不合併。

## 使用者設定清單

完整 Firebase、授權網域、API key、App Check、Spark／預算警示、GitHub 2FA／main 保護及 Pages 設定在 setup.md。Pages Source／environment 已由本人完成；共用模式不需要本人 Google 登入或 UID。

App Check 前端初始化已備妥，未提供 reCAPTCHA site key／Console secret，尚未啟用 enforcement。Spark 未連結 Billing account 時不建立 Cloud Billing budget，不為警示升級付費；未來若自行升級，預算警示不是支出硬上限。
