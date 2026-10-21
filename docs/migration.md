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
npm run migrate -- --source ./json --map ./mapping.local.json --project YOUR_PROJECT_ID --write
```

工具只處理 mapping 指定來源，並只匯入 `games_index.json` 列出的賽事及 `frequent_players.json`。現代 `game_ID.json` 優先，沒有時讀取舊格式 `games/ID.json`；尚無賽程檔的索引會建立空賽事。`trash/`、未被索引列出的孤立檔案及 `users/` 密碼資料均不匯入。無法通過新版欄位驗證的資料會停止處理，不會靜默捨棄欄位。

目的使用者必須已存在。既有目的文件會略過，不覆蓋目前雲端賽事；來源永遠不會被修改或刪除。每個文件以交易建立，中途失敗可修正後重跑。請在正式匯入前備份資料並先於 Emulator 或測試專案驗證結果。

使用者是免密碼、跨裝置共用的資料分類，任何開啟網站的人都可管理；mapping 不是帳號權限或身分驗證。

舊版的 GitHub PAT 曾放在前端，請到 GitHub Settings → Developer settings → Personal access tokens 撤銷該 PAT。移除程式碼及舊密碼檔不會消除 Git 歷史中的曝光。
