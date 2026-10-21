# 舊 JSON 遷移

舊檔案保留在 `json/`，只作遷移來源。新版網站不會讀寫 GitHub，也不需要舊帳號或密碼。

1. 先設定 Firebase，從新版網站「建立使用者」。記下 Firestore `profiles` 中的文件 ID。
2. 在本機建立 `mapping.local.json`，將舊 JSON 資料夾名稱映射到新的 profileId，例如：

```json
{ "legacy-user": "new-profile-document-id" }
```

3. 先檢查格式。此步驟完全不連線 Firebase：

```bash
npm run migrate -- --source ./json --map ./mapping.local.json
```

4. 在有目標專案管理員權限的環境，透過 Application Default Credentials 執行：

```bash
npm run migrate -- --source ./json --map ./mapping.local.json --project chickenbadminton --write
```

工具只處理 mapping 指定來源，並只匯入 `games_index.json` 列出的賽事及 `frequent_players.json`。現代 `game_ID.json` 優先，沒有時讀取舊格式 `games/ID.json`；尚無賽程檔的索引會建立空賽事。`trash/`、未被索引列出的孤立檔案及 `users/` 密碼資料均不匯入。無法通過新版欄位驗證的資料會停止處理，不會靜默捨棄欄位。

目的使用者必須已存在。既有目的文件會略過，不覆蓋目前雲端賽事；來源永遠不會被修改或刪除。每個文件以交易建立，中途失敗可修正後重跑。請在正式匯入前備份資料並先於 Emulator 或測試專案驗證結果。

本版工作區為 Google 帳號私有資料；mapping 只是舊資料夾到 profileId 的路徑對照。授權依據為父工作區不可變更的 ownerUid，不能憑名稱或 mapping 認領。

舊版的 GitHub PAT 曾放在前端，請到 GitHub Settings → Developer settings → Personal access tokens 撤銷該 PAT。移除程式碼及舊密碼檔不會消除 Git 歷史中的曝光。

## 已完成的正式匯入（2026-10-21）

Timothy 的 8 場賽事及 17 位常用選手、guest 的 4 場賽事已完成匯入，新增 13 份文件、略過 0 份。逐欄讀回比對通過，全部 31 份來源 JSON 的 SHA-256 不變。遊戲原有 Date.now() ID 保留為 createdAt，避免匯入時間改變舊賽事排序。

目的 profile 已存在；後續請使用 [正式匯入紀錄](migration-record.json) 的 mapping，避免建立同名重複使用者。該紀錄只有profile ID 與數量，沒有 Firebase Auth 憑證或管理員金鑰。

## 私有歸屬綁定

舊資料缺少 ownerUid 時一律封鎖。本人完成 Google 登入後，依 [設定清單](setup.md#4-舊資料綁定管理員操作) 使用 assign-legacy-owner.mjs，預設 dry-run；只有已驗證 Google UID 且未被其他人擁有的工作區才能綁定。原始 json/ 已停止 Git 追蹤，管理員應使用本機保留的來源副本。
