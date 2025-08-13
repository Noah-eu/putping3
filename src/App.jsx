import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import {
  getAuth,
  onAuthStateChanged,
  signOut
} from "firebase/auth";
import {
  getDatabase,
  ref,
  onValue,
  set,
  push,
  remove
} from "firebase/database";
import { initializeApp } from "firebase/app";

import "./App.css";

// --- Firebase Config ---
const firebaseConfig = {
  apiKey: "AlzaSyCEUmxYL8n8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e93b0ff17a816549635b",
  measurementId: "G-RL6MGM46M6X"
};
initializeApp(firebaseConfig);
const db = getDatabase();
const auth = getAuth();

// --- Mapbox ---
mapboxgl.accessToken =
  "pk.eyJ1Ijo...tuOBnAN8iHiYujXklg9h5w"; // tvůj token

export default function App() {
  const mapContainer = useRef(null);
  const map = useRef(null);
  const [lng, setLng] = useState(14.42076);
  const [lat, setLat] = useState(50.08804);
  const [zoom, setZoom] = useState(12);
  const [user, setUser] = useState(null);
  const [markers, setMarkers] = useState({});
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [photoUrls, setPhotoUrls] = useState([]);
  const [sound, setSound] = useState(null);

  // --- Auth state ---
  useEffect(() => {
    onAuthStateChanged(auth, (u) => {
      if (u) {
        setUser(u);
        // Ulož pozici uživatele
        navigator.geolocation.getCurrentPosition((pos) => {
          set(ref(db, "users/" + u.uid), {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude
          });
        });
      } else {
        setUser(null);
      }
    });
  }, []);

  // --- Inicializace mapy ---
  useEffect(() => {
    if (map.current) return;
    map.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [lng, lat],
      zoom: zoom
    });
  }, []);

  // --- Načtení markerů z DB ---
  useEffect(() => {
    const usersRef = ref(db, "users");
    onValue(usersRef, (snapshot) => {
      const data = snapshot.val() || {};
      Object.keys(markers).forEach((id) => {
        if (markers[id]) {
          markers[id].remove();
        }
      });
      const newMarkers = {};
      Object.keys(data).forEach((id) => {
        const { lat, lng } = data[id];
        const el = document.createElement("div");
        el.className = "marker";
        if (id === user?.uid) el.classList.add("marker-me");
        el.addEventListener("click", () => {
          el.classList.add("marker-selected");
        });
        newMarkers[id] = new mapboxgl.Marker(el)
          .setLngLat([lng, lat])
          .addTo(map.current);
      });
      setMarkers(newMarkers);
    });
  }, [user]);

  // --- Chaty ---
  useEffect(() => {
    if (!user) return;
    const chatsRef = ref(db, `chats/${user.uid}`);
    onValue(chatsRef, (snapshot) => {
      const data = snapshot.val() || {};
      setChats(Object.keys(data));
    });
  }, [user]);

  // --- Zprávy ---
  useEffect(() => {
    if (!user || !selectedChat) return;
    const msgsRef = ref(db, `chats/${user.uid}/${selectedChat}`);
    onValue(msgsRef, (snapshot) => {
      const data = snapshot.val() || {};
      setMessages(Object.values(data));
    });
  }, [user, selectedChat]);

  // --- Odeslání zprávy ---
  const sendMessage = (text) => {
    if (!user || !selectedChat) return;
    const msgsRef = ref(db, `chats/${user.uid}/${selectedChat}`);
    push(msgsRef, {
      text,
      sender: user.uid,
      time: Date.now()
    });
  };

  // --- Ping se zvukem ---
  const sendPing = () => {
    if (!user) return;
    const pingRef = ref(db, "pings/" + Date.now());
    set(pingRef, { from: user.uid, time: Date.now() });
    const audio = new Audio("/ping.mp3");
    audio.play();
  };

  // --- FAB akce ---
  const handlePhotoUpload = (e) => {
    const files = Array.from(e.target.files);
    const urls = files.map((f) => URL.createObjectURL(f));
    setPhotoUrls((prev) => [...prev, ...urls]);
  };

  // --- Ukončit kontakt ---
  const endContact = (chatId) => {
    remove(ref(db, `chats/${user.uid}/${chatId}`));
    setSelectedChat(null);
  };

  // --- Odhlášení ---
  const handleLogout = () => {
    if (user) {
      remove(ref(db, "users/" + user.uid)); // smaže marker
      signOut(auth);
    }
  };

  return (
    <div className="App">
      <div ref={mapContainer} className="map-container" />
      <div className="fab">
        <input
          type="file"
          multiple
          accept="image/*"
          onChange={handlePhotoUpload}
          style={{ display: "none" }}
          id="upload-input"
        />
        <label htmlFor="upload-input">📷</label>
        <button onClick={sendPing}>📡</button>
      </div>
      <div className="chat-list">
        {chats.map((chatId) => (
          <div key={chatId}>
            <button onClick={() => setSelectedChat(chatId)}>{chatId}</button>
            <button onClick={() => endContact(chatId)}>❌</button>
          </div>
        ))}
      </div>
      {selectedChat && (
        <div className="chat-window">
          {messages.map((m, idx) => (
            <div key={idx}>
              <b>{m.sender === user.uid ? "Me" : "Them"}:</b> {m.text}
            </div>
          ))}
          <input
            type="text"
            onKeyDown={(e) => {
              if (e.key === "Enter") sendMessage(e.target.value);
            }}
          />
        </div>
      )}
      <div className="photo-gallery">
        {photoUrls.map((url, idx) => (
          <img key={idx} src={url} alt={`upload-${idx}`} />
        ))}
      </div>
      <button onClick={handleLogout}>Odhlásit</button>
    </div>
  );
}
