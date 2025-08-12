// src/firebase.js				
import { initializeApp } from "firebase/app";				
import { getDatabase } from "firebase/database";				
import { getAuth } from "firebase/auth";				
import { getStorage } from "firebase/storage";				
				
const firebaseConfig = {				
apiKey: "…",				
authDomain: "putping-dc57e.firebaseapp.com",				
databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",				
projectId: "putping-dc57e",				
storageBucket: "putping-dc57e.appspot.com",				
messagingSenderId: "…",				
appId: "…",				
measurementId: "…"				
};				
				
const app = initializeApp(firebaseConfig);				
				
const db = getDatabase(app);				
const auth = getAuth(app);				
const storage = getStorage(app);				
				
// ⬇️ JEDEN společný export – žádné další exporty v tomhle souboru				
export { db, auth, storage };				
