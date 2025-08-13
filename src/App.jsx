import React, { useState, useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  onValue,
  remove,
  onDisconnect,
  update,
  serverTimestamp
} from "firebase/database";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";
import { getAuth, signInAnonymously } from "firebase/auth";

// ===== Mapbox token =====
mapboxgl.accessToken = "TVŮJ_MAPBOX_TOKEN";

// ===== Firebase config =====
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

// ===== Init Firebase =====
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);
const auth = getAuth(app);

export default function App() {
  const [map, setMap] = useState(null);
  const [userName, setUserName] = useState(localStorage.getItem("userName") || "");
  const [userId] = useState(localStorage.getItem("userId") || Math.random().toString(36).substr(2, 9));
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [showSettings, setShowSettings] = useState(!localStorage.getItem("userName"));
  const [currentChatUser, setCurrentChatUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const markersById = useRef({});
  const pingSound = useRef(new Audio("https://notificationsounds.com/storage/sounds/file-sounds-1150-event.mp3"));
  const TTL = 5 * 60 * 1000; // 5 min online

  useEffect(() => {
    localStorage.setItem("userId", userId);
    signInAnonymously(auth);

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
        photo: localStorage.getItem("userPhoto") || null
      });
      onDisconnect(meRef).update({ lastActive: Date.now(), online: false });

      setInterval(() => {
        update(meRef, {
          lastActive: Date.now(),
          lat: latitude,
          lng: longitude,
          name: userName || "Anonym",
          online: true
        });
      }, 20000);
    });
  }, [userId, userName]);

  // ===== Listen users =====
  useEffect(() => {
    if (!map) return;
    const usersRef = ref(db, "users");

    onValue(usersRef, (snapshot) => {
      const data = snapshot.val() || {};
      const now = Date.now();

      Object.entries(data).forEach(([id, user]) => {
        if (id === userId) return;
        const isOnline = user.lastActive && now - user.lastActive <= TTL;

        if (!markersById.current[id]) {
          const el = document.createElement("div");
          el.className = "marker";
          el.style.backgroundColor = isOnline ? "blue" : "gray";
          el.style.width = "20px";
          el.style.height = "20px";
          el.style.borderRadius = "50%";
          el.style.cursor = "pointer";

          const popupContent = document.createElement("div");
          popupContent.innerHTML = `
            <strong>${user.name || "Anonym"}</strong><br/>
            ${isOnline ? "Online" : "Offline"}<br/>
            <button id="ping-${id}">📩 Ping</button>
            <button id="chat-${id}">💬 Chat</button>
          `;

          const popup = new mapboxgl.Popup().setDOMContent(popupContent);
          const marker = new mapboxgl.Marker(el).setLngLat([user.lng, user.lat]).setPopup(popup).addTo(map);
          markersById.current[id] = marker;

          popup.on("open", () => {
            document.getElementById(`ping-${id}`).onclick = () => sendPing(id);
            document.getElementById(`chat-${id}`).onclick = () => openChat(id, user.name);
          });
        } else {
          markersById.current[id].getElement().style.backgroundColor = isOnline ? "blue" : "gray";
          if (isOnline) markersById.current[id].setLngLat([user.lng, user.lat]);
        }
      });
    });
  }, [map]);

  // ===== Ping send =====
  const sendPing = (targetId) => {
    const pingRef = ref(db, `pings/${targetId}`);
    set(pingRef, { from: userId, fromName: userName || "Anonym", time: Date.now() });
  };

  // ===== Ping receive =====
  useEffect(() => {
    const pingsRef = ref(db, `pings/${userId}`);
    onValue(pingsRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        if (soundEnabled) pingSound.current.play();
        alert(`📩 Ping od ${data.fromName}`);
        remove(pingsRef);
        // Auto open chat on ping reply
        openChat(data.from, data.fromName);
      }
    });
  }, [soundEnabled]);

  // ===== Chat =====
  const openChat = (targetId, targetName) => {
    setCurrentChatUser({ id: targetId, name: targetName });
    const chatRef = ref(db, `messages/${[userId, targetId].sort().join("_")}`);
    onValue(chatRef, (snapshot) => {
      const data = snapshot.val() || [];
      setMessages(Object.values(data));
    });
  };

  const sendMessage = () => {
    if (!newMessage.trim()) return;
    const chatRef = ref(db, `messages/${[userId, currentChatUser.id].sort().join("_")}/${Date.now()}`);
    set(chatRef, { from: userId, fromName: userName || "Anonym", text: newMessage });
    setNewMessage("");
  };

  // ===== Upload photo =====
  const uploadPhoto = (file) => {
    const photoRef = storageRef(storage, `photos/${userId}.jpg`);
    uploadBytes(photoRef, file).then(() => {
      getDownloadURL(photoRef).then((url) => {
        localStorage.setItem("userPhoto", url);
        update(ref(db, `users/${userId}`), { photo: url });
      });
    });
  };

  return (
    <div>
      {showSettings && (
        <div style={{ position: "absolute", zIndex: 1, background: "white", padding: 5 }}>
          <input value={userName} onChange={(e) => setUserName(e.target.value)} />
          <button onClick={() => { localStorage.setItem("userName", userName); setShowSettings(false); }}>Uložit</button>
          <button onClick={() => { pingSound.current.play(); setSoundEnabled(true); }}>🔊 Povolit zvuk</button>
          <input type="file" accept="image/*" onChange={(e) => uploadPhoto(e.target.files[0])} />
        </div>
      )}
      {currentChatUser && (
        <div style={{ position: "absolute", bottom: 0, width: "100%", background: "white", padding: 5 }}>
          <h3>Chat s {currentChatUser.name}</h3>
          <div style={{ maxHeight: "200px", overflowY: "auto" }}>
            {messages.map((m, i) => (
              <div key={i}><strong>{m.fromName}:</strong> {m.text}</div>
            ))}
          </div>
          <input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} />
          <button onClick={sendMessage}>Odeslat</button>
        </div>
      )}
      <div id="map" style={{ width: "100vw", height: "100vh" }}></div>
    </div>
  );
}
