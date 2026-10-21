import { doc, setDoc, getDocFromServer, runTransaction, serverTimestamp } from 'firebase/firestore';

// Adapt the same domain operations to the Web SDK. Security Rules are the
// authoritative boundary; client-side validation is only a usability check.
function timestamps(value) {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    ['createdAt', 'updatedAt', 'deletedAt'].includes(key) && item instanceof Date
      ? serverTimestamp() : item,
  ]));
}
export function webStore(database) {
  return {
    doc(path) {
      const reference = doc(database, path);
      return { reference, create: data => setDoc(reference, timestamps(data)) };
    },
    async runTransaction(callback) {
      // Rules may reject a stale revision before the SDK classifies the commit
      // as a conflict. Retry only after observing an actual revision change.
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
              create: (ref, value) => transaction.set(ref.reference, timestamps(value)),
              set: (ref, value) => transaction.set(ref.reference, timestamps(value)),
              update: (ref, value) => transaction.update(ref.reference, timestamps(value)),
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
            } catch { /* A real permission failure must remain a failure. */ }
          }
          if (!changed) throw error;
        }
      }
    },
  };
}
