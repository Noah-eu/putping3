// src/firebase.js
import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";

const storage = getStorage(app); // přidáme storage inicializaci

export { db, auth, storage };	

const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com", // ✅ Opravený storageBucket
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

export { db, auth };

