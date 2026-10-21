// 將純資料操作轉接至 Web SDK；Rules 是權限邊界，前端驗證只改善操作體驗。
function timestamps(value, serverTimestamp) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    ['createdAt', 'updatedAt', 'deletedAt'].includes(key) && item instanceof Date
      ? serverTimestamp() : item,
  ]));
}
export function transactionStore(database, { doc, setDoc, getDocFromServer, runTransaction, serverTimestamp }) {
  return {
    doc(path) {
      const reference = doc(database, path);
      return { reference, create: data => setDoc(reference, timestamps(data, serverTimestamp)) };
    },
    async runTransaction(callback) {
      // Rules 可能先拒絕舊 revision；只有確認版本確實變更才重試交易。
      for (let attempt = 0; ; attempt++) {
        const seen = new Map();
        try {
          return await runTransaction(database, transaction => {
            seen.clear();
            return callback({
              async get(ref) {
                const snapshot = await transaction.get(ref.reference);
                if (Number.isSafeInteger(snapshot.data()?.revision)) {
                  seen.set(ref.reference.path, { ref: ref.reference, revision: snapshot.data().revision });
                }
                return { exists: snapshot.exists(), data: () => snapshot.data() };
              },
              create: (ref, value) => transaction.set(ref.reference, timestamps(value, serverTimestamp)),
              set: (ref, value) => transaction.set(ref.reference, timestamps(value, serverTimestamp)),
              update: (ref, value) => transaction.update(ref.reference, timestamps(value, serverTimestamp)),
              delete: ref => transaction.delete(ref.reference),
            });
          });
        } catch (error) {
          if (error.code !== 'permission-denied' || attempt >= 4) throw error;
          let changed = false;
          for (const { ref, revision } of seen.values()) {
            try {
              const latest = await getDocFromServer(ref);
              if (latest.exists() && latest.data().revision !== revision) changed = true;
            } catch { /* 權限錯誤不可當作版本衝突重試。 */ }
          }
          if (!changed) throw error;
        }
      }
    },
  };
}
