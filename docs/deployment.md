# 正式部署（2026-10-21，Asia/Taipei）

正式網站：https://chickenbadminton.web.app

- 既有專案：`chickenbadminton`；使用免費 Spark，Cloud Billing 回報 `billingEnabled=false`。
- Web app：`1:307486695888:web:b0dffdc8284a33069919d5`。
- 資料庫：`(default)`／`STANDARD`／`FIRESTORE_NATIVE`／`asia-east1`／`freeTier=true`。PITR 關閉。
- Anonymous Auth 已啟用，正式 `web.app` 與 `firebaseapp.com` 已列入 authorized domains。
- Auth、Firestore Rules／Indexes 及 Hosting 已部署。未部署 Cloud Functions，未啟用 TTL 或計費。
- Hosting 只發佈檢查過的 `dist/`（29 份檔案），不含舊 JSON、密碼、原始碼或管理員憑證。

## 舊資料

| 共用使用者 | 有效賽事 | 常用選手 |
| --- | ---: | ---: |
| Timothy | 8 | 17 |
| guest | 4 | 0 |

新增 12 份賽事文件與一份名冊，共 13 份目的文件，略過 0 份。兩個共用 profile 先從正式網站建立。逐欄讀回核對通過，原賽事時間排序保留；全部 31 份來源 JSON 的 SHA-256 不變。詳見 [匯入紀錄](migration-record.json)。

## 驗證

- 本機真正 Auth／Firestore Emulator：36 項資料、交易、併發、分享、遷移及 Rules 測試全部通過。
- Chromium：兩項端到端測試通過，包含三個獨立 browser context、建立／選取使用者、名冊、分組草稿重載、排程、比分、專業計分板、跨裝置同步、分享及撤銷。
- 同樣兩項端到端測試已在正式網址通過；延遲模組載入時控制項保持停用，避免 handlers 尚未載入就可點擊。
- 正式 UI 已確認兩位匯入使用者、8／4 場賽事、17 人名冊、21 場次舊賽程；390px 手機首頁無水平溢出，無瀏覽器 JavaScript 錯誤。
- 正式流程測試資料已清除，保留兩個匯入 profile，分享憑證文件數為 0。
- 正式建置與 Hosting 內容檢查通過。GitHub Actions 結果請見 [PR #17](https://github.com/timothy920611/ChickenBadminton/pull/17) 的 Checks。

## 免費版本的界線

所有訪客刻意共用管理權限。Rules 驗證文件外層、時間戳與版本，但複雜巢狀賽程驗證是在用戶端執行，不能宣稱與原本可信任的 Functions 驗證等價。此為共用原型；詳見 [安全檢查](security-audit.json)。免費額度耗盡仍可能暫停服務；未連結計費帳戶，不會自動升級。
