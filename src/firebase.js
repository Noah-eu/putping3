// src/firebase.js				
import { initializeApp } from "firebase/app";				
import { getDatabase } from "firebase/database";				
import { getAuth } from "firebase/auth";
import { getStorage, ref as sref, uploadBytes, getDownloadURL } from "firebase/storage";
				
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};
				
const app = initializeApp(firebaseConfig);

const db = getDatabase(app);
const auth = getAuth(app);
export const storage = getStorage(app);

const initSecondaryApp = (name) => initializeApp(firebaseConfig, name);

export { db, auth, firebaseConfig, initSecondaryApp };
export { sref, uploadBytes, getDownloadURL };
