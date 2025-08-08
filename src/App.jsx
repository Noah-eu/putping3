import React, { useState, useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref as dbRef,
  set,
  onValue,
  remove,
  onDisconnect,
  update
} from "firebase/database";
import {
  getAuth,
  signInAnonymously
} from "firebase/auth";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL
} from "firebase/storage";

mapboxgl.accessToken = "TVŮJ_MAPBOX_TOKEN";

const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const storage = getStorage(app);

export default function App() {
  const [map, setMap] = useState(null);
  const [userName, setUserName] = useState(localStorage.getItem("userName") || "");
  const [userId] = useState(localStorage.getItem("userId") || Math.random().toString(36).substr(2, 9));
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const markersById = useRef({});
  const pingSound = useRef(new Audio("https://notificationsounds.com/storage/sounds/file-sounds-1150-event.mp3"));

  useEffect(() => {
    localStorage.setItem("userId", userId);
    signInAnonymously(auth).catch(console.error);

    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;
      const m = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/streets-v11",
        center: [longitude, latitude],
        zoom: 14,
      });
      setMap(m);

      const meRef = dbRef(db, `users/${userId}`);
      set(meRef, { name: userName || "Anonym", lat: latitude, lng: longitude, lastActive: Date.now() });
      onDisconnect(meRef).remove();

      setInterval(() => {
        update(meRef, { lastActive: Date.now(), lat: latitude, lng: longitude, name: userName || "Anonym" });
      }, 20000);
    });
  }, [userId, userName]);

  useEffect(() => {
    if (!map) return;

    const TTL = 5 * 60 * 1000;
    const usersRef = dbRef(db, "users");
    onValue(usersRef, (snapshot) => {
      const data = snapshot.val() || {};
      const now = Date.now();

      Object.entries(data).forEach(([id, user]) => {
        if (id === userId) return;

        if (!user.lastActive || now - user.lastActive > TTL) {
          if (markersById.current[id]) {
            markersById.current[id].remove();
            delete markersById.current[id];
          }
          return;
        }

        if (!markersById.current[id]) {
          const popupContent = document.createElement("div");
          popupContent.innerHTML = `
            <strong>${user.name || "Anonym"}</strong><br/>
            ${user.photoUrl ? `<img src="${user.photoUrl}" width="50" height="50" style="border-radius:50%;"/>` : ""}
          `;

          markersById.current[id] = new mapboxgl.Marker({ color: "blue" })
            .setLngLat([user.lng, user.lat])
            .setPopup(new mapboxgl.Popup().setDOMContent(popupContent))
            .addTo(map);
        } else {
          markersById.current[id].setLngLat([user.lng, user.lat]);
        }
      });

      Object.keys(markersById.current).forEach((id) => {
        if (!data[id]) {
          markersById.current[id].remove();
          delete markersById.current[id];
        }
      });
    });
  }, [map]);

  const sendPing = () => {
    const pingsRef = dbRef(db, `pings/${userId}`);
    set(pingsRef, { time: Date.now() });
  };

  useEffect(() => {
    const pingsRef = dbRef(db, `pings/${userId}`);
    onValue(pingsRef, (snapshot) => {
      if (snapshot.exists()) {
        if (soundEnabled) pingSound.current.play();
        alert("📩 Dostal jsi ping!");
        remove(pingsRef);
      }
    });
  }, [soundEnabled]);

  const handlePhotoUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      if (!auth.currentUser) {
        await signInAnonymously(auth);
      }
      const uid = auth.currentUser?.uid || userId;
      const path = `profilePics/${uid}.jpg`;
      const refObj = storageRef(storage, path);
      const task = uploadBytesResumable(refObj, file, { contentType: file.type });

      task.on("state_changed",
        (snap) => {
          const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          console.log(`Upload: ${pct}%`);
        },
        (err) => {
          console.error("Upload error:", err);
          alert("Nahrání selhalo: " + (err?.message || err));
        },
        async () => {
          const url = await getDownloadURL(task.snapshot.ref);
          await update(dbRef(db, `users/${userId}`), { photoUrl: url, lastActive: Date.now() });
          alert("Fotka nahrána ✅");
        }
      );
    } catch (err) {
      console.error(err);
      alert("Chyba při nahrávání: " + (err?.message || err));
    } finally {
      e.target.value = "";
    }
  };

  return (
    <div>
      <div style={{ position: "absolute", zIndex: 1, background: "white", padding: 5 }}>
        <input value={userName} onChange={(e) => setUserName(e.target.value)} />
        <button onClick={() => localStorage.setItem("userName", userName)}>Uložit</button>
        <button onClick={sendPing}>📩 Send ping</button>
        <button onClick={() => { pingSound.current.play(); setSoundEnabled(true); }}>🔊 Povolit zvuk</button>
        <input type="file" accept="image/*" onChange={handlePhotoUpload} />
      </div>
      <div id="map" style={{ width: "100vw", height: "100vh" }}></div>
    </div>
  );
}
