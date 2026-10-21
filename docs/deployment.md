# 部署紀錄（2026-10-21，Asia/Taipei）

## 本版目標與狀態

- 正式前端目標：`https://timothy920611.github.io/ChickenBadminton/`，由 GitHub Actions 建置及發布 `dist/`。使用者已回覆完成 Pages Source／environment 設定，待本次 Actions 發布驗證；不能把既有舊版網址 HTTP 200 當作新版已發布。
- Firebase 專案 `chickenbadminton`，Web app `1:307486695888:web:b0dffdc8284a33069919d5`。
- 資料庫已重新回讀：`(default)`／`STANDARD`／`FIRESTORE_NATIVE`／`asia-east1`／`freeTier=true`，PITR 關閉。維持 Spark、不啟用 Cloud Functions 或計費。
- Google 登入設定已成功部署，加入 `timothy920611.github.io` 授權網域；程式不再自動匿名登入。
- 個人所有權 Rules／Indexes 已部署成功；待回讀雲端內容核對。無 ownerUid 的舊資料部署新 Rules 後會封鎖，不能由前端自行認領。
- 舊 `https://chickenbadminton.web.app` 為上一版 Firebase Hosting 網址；不當成本版 Pages 發布成功的證據。
- API key 網域限制正在設定；App Check 已接好前端初始化，但未提供 reCAPTCHA site key／Console secret，不宣稱已啟用 enforcement。

## 舊資料與所有權

| 工作區 | 有效賽事 | 常用選手 |
| --- | ---: | ---: |
| Timothy | 8 | 17 |
| guest | 4 | 0 |

上一次已匯入 12 份賽事文件及 1 份名冊，共 13 份文件，並逐欄讀回核對；31 份原始 JSON 的 SHA-256 不變。本次不重複匯入、不覆寫賽事。詳見 [原始匯入紀錄](migration-record.json)。

使用者確認兩個工作區全部歸自己的 Google 帳號。須先由本人 Google 登入取得 Firebase UID，再由管理員使用 `assign-legacy-owner.mjs` dry-run 及 `--write` 綁定。綁定工具禁止轉移已有不同擁有者的工作區，且不修改賽事文件。

舊 JSON 已從本分支停止 Git 追蹤，本機來源仍保留；不發佈於 Pages。舊公開歷史與尚未合併的 main 版本可能仍有舊資料，不能宣稱已撤回公開副本。

## 本版驗證

- 32 項資料／交易／遷移／實際 Firestore Rules Emulator 測試全部通過。
- 2 項 Chromium 測試通過：模擬 Google 登入、個人工作區、名冊 XSS 測試、分組草稿重載、賽程、專業計分板、相同帳號跨裝置同步、其他帳號看不到工作區、舊分享連結停用及延遲載入控制項。
- 模擬 Google credential 只適用 Auth Emulator，不等同 Google 真實 popup 已驗收；正式 Google 登入須本人操作。
- 正式建置通過，SDK 由官方 CDN 載入、資源使用相對路徑，dist 不含舊 JSON、管理腳本、Admin SDK 或機密。
- GitHub Actions／正式 Pages 結果待新提交後驗證，以 [PR #17](https://github.com/timothy920611/ChickenBadminton/pull/17) 為準；PR 保持 Draft、不合併。

## 尚需本人完成

Pages Source／environment 設定、正式 Google 登入及 UID、App Check reCAPTCHA 註冊與 site key，以及 GitHub 2FA／main 保護規則的確認。完整點選步驟見 [設定清單](setup.md)。

Cloud Billing API 本次回讀因未啟用而失敗；上次部署曾確認未連結計費帳戶，這次未更改計費設定。Spark 無 Billing account 時不建立 Cloud Billing budget；不為警示而升級付費。未來升級時依設定清單建立預算警示，警示不是支出硬上限。
