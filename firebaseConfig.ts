import * as firebaseApp from "firebase/app";
import { getFirestore, enableIndexedDbPersistence } from "firebase/firestore";

// --- KONFIGURASI FIREBASE ---
const firebaseConfig = {
  apiKey: "AIzaSyDf02DSuhvMFiU3A80JKxYYagtTcAcB_SQ",
  authDomain: "pampunk-5e6c5.firebaseapp.com",
  databaseURL: "https://pampunk-5e6c5-default-rtdb.firebaseio.com",
  projectId: "pampunk-5e6c5",
  storageBucket: "pampunk-5e6c5.firebasestorage.app",
  messagingSenderId: "599593600366",
  appId: "1:599593600366:web:df052764a2fdb4542d6d7f"
};

// Initialize Firebase
const app = firebaseApp.initializeApp(firebaseConfig);
const db = getFirestore(app);

// Aktifkan Offline Persistence (Agar data tetap bisa dibaca saat internet mati)
// Data akan disinkronkan kembali saat online.
try {
    enableIndexedDbPersistence(db).catch((err) => {
        if (err.code == 'failed-precondition') {
            console.log('Persistence failed: Multiple tabs open');
        } else if (err.code == 'unimplemented') {
            console.log('Persistence not supported by browser');
        }
    });
} catch (e) {
    console.log("Persistence init error:", e);
}

export { db };