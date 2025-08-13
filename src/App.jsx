import React, { useState, useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  onValue,
  update,
  onDisconnect,
  push,
  remove
} from "firebase/database";
import { getStorage, ref as storageRef, uploadBytes, getDownloadURL } from "firebase/storage";

mapboxgl.accessToken = "TVŮJ_MAPBOX_TOKEN";

const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.firebasestorage.app",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);

export default function App() {
  const [map, setMap] = useState(null);
  const [userName, setUserName] = useState(localStorage.getItem("userName") || "");
  const [userId] = useState(localStorage.getItem("userId") || Math.random().toString(36).substr(2, 9));
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem("soundEnabled") === "true");
  const [photoURL, setPhotoURL] = useState(localStorage.getItem("photoURL") || "");
  const [showSettings, setShowSettings] = useState(false);
  const [initialSetupDone, setInitialSetupDone] = useState(localStorage.getItem("setupDone") === "true");

  const markersById = useRef({});
  const pingSound = useRef(new Audio("https://notificationsounds.com/storage/sounds/file-sounds-1150-event.mp3"));

  useEffect(() => {
    localStorage.setItem("userId", userId);

    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;
      const m = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/streets-v11",
        center: [longitude, latitude],
        zoom: 14
      });
      setMap(m);

      const meRef = ref(db, `users/${userId}`);
      set(meRef, {
        name: userName || "Anonym",
        lat: latitude,
        lng: longitude,
        lastActive: Date.now(),
        photoURL
      });
      onDisconnect(meRef).remove();

      setInterval(() => {
        update(meRef, {
          lastActive: Date.now(),
          lat: latitude,
          lng: longitude,
          name: userName || "Anonym",
          photoURL
        });
      }, 20000);
    });
  }, [userId, userName, photoURL]);

  useEffect(() => {
    if (!map) return;

    const usersRef = ref(db, "users");
    onValue(usersRef, (snapshot) => {
      const data = snapshot.val() || {};
      Object.entries(data).forEach(([id, user]) => {
        if (id === userId) return;

        const popupContent = `
          <div style="text-align:center">
            ${user.photoURL ? `<img src="${user.photoURL}" style="width:50px;height:50px;border-radius:50%" />` : ""}
            <p>${user.name || "Anonym"}</p>
            <button onclick="window.sendPing('${id}')">📩 Ping</button>
            <button onclick="window.openChat('${id}')">💬 Chat</button>
          </div>
        `;

        if (!markersById.current[id]) {
          markersById.current[id] = new mapboxgl.Marker({ color: "blue" })
            .setLngLat([user.lng, user.lat])
            .setPopup(new mapboxgl.Popup().setHTML(popupContent))
            .addTo(map);
        } else {
          markersById.current[id].setLngLat([user.lng, user.lat]);
        }
      });
    });
  }, [map, userId]);

  // Globální funkce pro kliknutí z popupu
  window.sendPing = (targetId) => {
    const pingsRef = ref(db, `pings/${targetId}`);
    set(pingsRef, { from: userName || "Anonym", time: Date.now() });
  };

  window.openChat = (targetId) => {
    const msg = prompt(`Zpráva pro ${targetId}:`);
    if (msg) {
      const msgRef = ref(db, `messages/${targetId}/${userId}`);
      push(msgRef, { from: userName || "Anonym", text: msg, time: Date.now() });
    }
  };

  useEffect(() => {
    const pingsRef = ref(db, `pings/${userId}`);
    onValue(pingsRef, (snapshot) => {
      if (snapshot.exists()) {
        const ping = snapshot.val();
        if (soundEnabled) pingSound.current.play();
        alert(`📩 Ping od ${ping.from}`);
        remove(pingsRef);
      }
    });

    const msgRef = ref(db, `messages/${userId}`);
    onValue(msgRef, (snapshot) => {
      if (snapshot.exists()) {
        const msgs = snapshot.val();
        const lastFrom = Object.values(msgs).flat().slice(-1)[0];
        if (lastFrom && soundEnabled) pingSound.current.play();
        alert(`💬 Nová zpráva od ${lastFrom?.from}: ${lastFrom?.text}`);
        remove(msgRef);
      }
    });
  }, [soundEnabled]);

  const handlePhotoUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const storageReference = storageRef(storage, `photos/${userId}`);
    uploadBytes(storageReference, file).then(() => {
      getDownloadURL(storageReference).then((url) => {
        setPhotoURL(url);
        localStorage.setItem("photoURL", url);
        update(ref(db, `users/${userId}`), { photoURL: url });
      });
    });
  };

  const saveSettings = () => {
    localStorage.setItem("userName", userName);
    localStorage.setItem("soundEnabled", soundEnabled);
    localStorage.setItem("setupDone", "true");
    setInitialSetupDone(true);
    setShowSettings(false);
  };

  return (
    <div>
      {!initialSetupDone && (
        <div style={{ position: "absolute", zIndex: 1, background: "white", padding: 5 }}>
          <input
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Zadej jméno"
          />
          <button onClick={() => { setSoundEnabled(true); pingSound.current.play(); }}>🔊 Povolit zvuk</button>
          <button onClick={saveSettings}>Uložit</button>
        </div>
      )}

      {initialSetupDone && (
        <button
          style={{ position: "absolute", top: 10, right: 10, zIndex: 2 }}
          onClick={() => setShowSettings(true)}
        >
          ⚙️
        </button>
      )}

      {showSettings && (
        <div style={{ position: "absolute", zIndex: 3, background: "white", padding: 10 }}>
          <h3>Nastavení</h3>
          <input
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Změnit jméno"
          />
          <br />
          <label>
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => setSoundEnabled(e.target.checked)}
            /> Povolit zvuk
          </label>
          <br />
          <input type="file" accept="image/*" onChange={handlePhotoUpload} />
          <br />
          <button onClick={saveSettings}>Uložit nastavení</button>
        </div>
      )}

      <div id="map" style={{ width: "100vw", height: "100vh" }}></div>
    </div>
  );
}
