// App.jsx – kompletní finální verze pro mobily s FAB, galerií, chatem a pingem

import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  remove,
  push,
  serverTimestamp,
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

/* ─────────────── Firebase config ─────────────── */
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL:
    "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.firebasestorage.app",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X",
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

/* ─────────────── Mapbox token ─────────────── */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ─────────────── Helpery ─────────────── */
function pairIdOf(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}
function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "před pár sekundami";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.floor(h / 24);
  return `před ${d} dny`;
}
async function compressImage(file, maxDim = 800, quality = 0.8) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });
  const { width, height } = img;
  const ratio = Math.min(maxDim / Math.max(width, height), 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  return blob;
}

/* ─────────────── Komponenta ─────────────── */
export default function App() {
  const [map, setMap] = useState(null);
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState({});
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("soundEnabled") === "1"
  );
  const [showGallery, setShowGallery] = useState(null); // {uid, photos}
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [openChatWith, setOpenChatWith] = useState(null);
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatText, setChatText] = useState("");
  const [fabOpen, setFabOpen] = useState(false);
  const [chatList, setChatList] = useState([]);
  const markers = useRef({});
  const pingSound = useRef(
    new Audio("https://cdn.pixabay.com/download/audio/2022/03/15/audio_8b831a2f36.mp3")
  );

  /* ─────────────── Auth ─────────────── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      let u = user;
      if (!u) {
        const cred = await signInAnonymously(auth);
        u = cred.user;
      }
      const uid = u.uid;
      setMe({ uid, name: localStorage.getItem("userName") || "Anonym" });
      const meRef = ref(db, `users/${uid}`);
      update(meRef, { name: localStorage.getItem("userName") || "Anonym", lastActive: Date.now(), online: true });
      if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            update(meRef, { lat: latitude, lng: longitude, lastActive: Date.now(), online: true });
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
      }
    });
    return () => unsub();
  }, []);

  /* ─────────────── Mapa ─────────────── */
  useEffect(() => {
    if (map || !me) return;
    const m = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.42076, 50.08804],
      zoom: 13,
    });
    setMap(m);
    return () => m.remove();
  }, [me]);

  /* ─────────────── Users & Markers ─────────────── */
  useEffect(() => {
    if (!map || !me) return;
    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      setUsers(data);
      Object.entries(data).forEach(([uid, u]) => {
        if (!u.lat || !u.lng) return;
        const isMe = uid === me.uid;
        const isOnline = u.online && u.lastActive && Date.now() - u.lastActive < 5 * 60_000;
        const color = isMe ? "red" : isOnline ? "#147af3" : "#a8a8a8";
        if (!markers.current[uid]) {
          const mk = new mapboxgl.Marker({ color })
            .setLngLat([u.lng, u.lat])
            .addTo(map);
          mk.getElement().addEventListener("click", () => {
            setShowGallery({ uid, photos: u.photos || (u.photoURL ? [u.photoURL] : []) });
            setGalleryIndex(0);
          });
          markers.current[uid] = mk;
        } else {
          markers.current[uid].setLngLat([u.lng, u.lat]);
        }
      });
      Object.keys(markers.current).forEach((uid) => {
        if (!data[uid]) {
          markers.current[uid].remove();
          delete markers.current[uid];
        }
      });
    });
    return () => unsub();
  }, [map, me]);

  /* ─────────────── Zvuk & Ping ─────────────── */
  useEffect(() => {
    if (!me) return;
    const inboxRef = ref(db, `pings/${me.uid}`);
    return onValue(inboxRef, (snap) => {
      if (snap.exists() && soundEnabled) {
        pingSound.current.currentTime = 0;
        pingSound.current.play().catch(() => {});
      }
      remove(ref(db, `pings/${me.uid}`));
    });
  }, [me, soundEnabled]);
  const sendPing = async (toUid) => {
    if (!me) return;
    await set(ref(db, `pings/${toUid}/${me.uid}`), { time: serverTimestamp() });
    if (soundEnabled) {
      pingSound.current.currentTime = 0;
      pingSound.current.play().catch(() => {});
    }
  };

  /* ─────────────── Chat ─────────────── */
  const openChat = (uid) => {
    setOpenChatWith(uid);
    const pid = pairIdOf(me.uid, uid);
    const msgsRef = ref(db, `messages/${pid}`);
    return onValue(msgsRef, (snap) => {
      const data = snap.val() || {};
      setChatMsgs(Object.entries(data).map(([id, m]) => ({ id, ...m })).sort((a, b) => a.time - b.time));
    });
  };
  const sendMessage = async () => {
    if (!chatText.trim()) return;
    const to = openChatWith;
    const pid = pairIdOf(me.uid, to);
    await push(ref(db, `messages/${pid}`), { from: me.uid, to, text: chatText.trim(), time: Date.now() });
    setChatText("");
  };

  /* ─────────────── Fotky ─────────────── */
  const onPickPhoto = async (e, isAvatar = false) => {
    if (!me) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const small = await compressImage(file);
      const path = isAvatar
        ? `users/${me.uid}/avatar.jpg`
        : `users/${me.uid}/photo_${Date.now()}.jpg`;
      const dest = sref(storage, path);
      await uploadBytes(dest, small, { contentType: "image/jpeg" });
      const url = await getDownloadURL(dest);
      const userRef = ref(db, `users/${me.uid}`);
      if (isAvatar) {
        await update(userRef, { photoURL: url });
      } else {
        const currentPhotos = users[me.uid]?.photos || [];
        await update(userRef, { photos: [...currentPhotos, url] });
      }
    } catch {}
  };

  /* ─────────────── Render ─────────────── */
  return (
    <div>
      <div id="map" style={{ width: "100vw", height: "100vh" }} />

      {/* FAB */}
      <div style={{ position: "absolute", bottom: 20, right: 20, zIndex: 10 }}>
        {fabOpen && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
            <input id="avatarFile" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onPickPhoto(e, true)} />
            <button onClick={() => document.getElementById("avatarFile").click()} style={{ padding: 10, borderRadius: "50%", background: "#fff" }}>📷 Profilovka</button>
            <input id="photoFile" type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => onPickPhoto(e, false)} />
            <button onClick={() => document.getElementById("photoFile").click()} style={{ padding: 10, borderRadius: "50%", background: "#fff" }}>🖼 Další</button>
          </div>
        )}
        <button onClick={() => setFabOpen(!fabOpen)} style={{ padding: 16, borderRadius: "50%", background: "#147af3", color: "#fff" }}>＋</button>
      </div>

      {/* Galerie */}
      {showGallery && (
        <div
          onClick={() => setShowGallery(null)}
          style={{
            position: "absolute", inset: 0, background: "rgba(0,0,0,.8)",
            display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", zIndex: 30
          }}
        >
          {showGallery.photos.length > 0 && (
            <img src={showGallery.photos[galleryIndex]} style={{ maxWidth: "90%", maxHeight: "80%", borderRadius: "50%" }} />
          )}
          <div style={{ marginTop: 20, display: "flex", gap: 20 }}>
            <button onClick={(e) => { e.stopPropagation(); setGalleryIndex((i) => (i > 0 ? i - 1 : i)); }}>◀</button>
            <button onClick={(e) => { e.stopPropagation(); sendPing(showGallery.uid); }}>📩 Ping</button>
            <button onClick={(e) => { e.stopPropagation(); openChat(showGallery.uid); }}>💬 Chat</button>
            <button onClick={(e) => { e.stopPropagation(); setGalleryIndex((i) => (i < showGallery.photos.length - 1 ? i + 1 : i)); }}>▶</button>
          </div>
        </div>
      )}

      {/* Chat */}
      {openChatWith && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, width: "100%", height: "50%", background: "#fff",
          display: "flex", flexDirection: "column", zIndex: 40
        }}>
          <div style={{ flex: 1, overflowY: "auto", padding: 10 }}>
            {chatMsgs.map((m) => (
              <div key={m.id} style={{ textAlign: m.from === me.uid ? "right" : "left" }}>
                <div>{m.text}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", padding: 8 }}>
            <input value={chatText} onChange={(e) => setChatText(e.target.value)} style={{ flex: 1 }} />
            <button onClick={sendMessage}>➤</button>
          </div>
        </div>
      )}
    </div>
  );
}
