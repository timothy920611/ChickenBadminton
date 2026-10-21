import { doc, setDoc, getDocFromServer, runTransaction, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

import { transactionStore } from './transaction-store.js';
export const webStore = database => transactionStore(database, { doc, setDoc, getDocFromServer, runTransaction, serverTimestamp });
