// ce// App.jsx

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

/* ───────────────────────────── Firebase config ─────────────────────────── */
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
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

/* ───────────────────────────── Mapbox token ────────────────────────────── */
mapboxgl.accessToken = "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ───────────────────────────── Pomocné funkce ─────────────────────────── */
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
  const ratio = Math.min(maxDim / Math.max(img.width, img.height), 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * ratio);
  canvas.height = Math.round(img.height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
}

/* ───────────────────────────── Komponenta App ─────────────────────────── */
export default function App() {
  const [map, setMap] = useState(null);
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState({});
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem("soundEnabled") === "1");
  const [openChatWith, setOpenChatWith] = useState(null);
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatText, setChatText] = useState("");
  const [showChatsList, setShowChatsList] = useState(false);
  const [chatsList, setChatsList] = useState([]);
  const [galleryPhotos, setGalleryPhotos] = useState([]);
  const [showGallery, setShowGallery] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const markers = useRef({});
  const pingSound = useRef(new Audio("https://cdn.pixabay.com/download/audio/2022/03/15/audio_8b831a2f36.mp3?filename=notification-113724.mp3"));

  /* ───────────────────────────── Auth ─────────────────────────── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      let u = user;
      if (!u) {
        const cred = await signInAnonymously(auth);
        u = cred.user;
      }
      setMe({ uid: u.uid, name: localStorage.getItem("userName") || "Anonym" });
      const meRef = ref(db, `users/${u.uid}`);
      update(meRef, { name: localStorage.getItem("userName") || "Anonym", lastActive: Date.now(), online: true });
      if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
          (pos) => update(meRef, { lat: pos.coords.latitude, lng: pos.coords.longitude, lastActive: Date.now(), online: true }),
          () => {},
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
      }
    });
    return () => unsub();
  }, []);

  /* ───────────────────────────── Init mapy ─────────────────────────── */
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

  /* ───────────────────────────── Markery ─────────────────────────── */
  useEffect(() => {
    if (!map || !me) return;
    const usersRef = ref(db, "users");
    return onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      setUsers(data);
      Object.entries(data).forEach(([uid, u]) => {
        if (!u.lat || !u.lng) return;
        const isOnline = u.online && Date.now() - u.lastActive < 5 * 60_000;
        const color = uid === me.uid ? "red" : isOnline ? "#147af3" : "#a8a8a8";
        if (!markers.current[uid]) {
          const el = document.createElement("div");
          el.style.backgroundColor = color;
          el.style.width = "32px";
          el.style.height = "32px";
          el.style.borderRadius = "50%";
          el.style.backgroundImage = u.photoURL ? `url(${u.photoURL})` : "none";
          el.style.backgroundSize = "cover";
          el.onclick = () => openUserGallery(uid);
          const mk = new mapboxgl.Marker(el).setLngLat([u.lng, u.lat]).addTo(map);
          markers.current[uid] = mk;
        } else {
          markers.current[uid].setLngLat([u.lng, u.lat]);
          markers.current[uid].getElement().style.backgroundColor = color;
        }
      });
      Object.keys(markers.current).forEach((uid) => {
        if (!data[uid]) {
          markers.current[uid].remove();
          delete markers.current[uid];
        }
      });
    });
  }, [map, me]);

  /* ───────────────────────────── Zvuk / Ping ─────────────────────────── */
  useEffect(() => {
    if (!me) return;
    const inboxRef = ref(db, `pings/${me.uid}`);
    return onValue(inboxRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      Object.keys(data).forEach((fromUid) => {
        if (soundEnabled) {
          pingSound.current.currentTime = 0;
          pingSound.current.play().catch(() => {});
        }
        remove(ref(db, `pings/${me.uid}/${fromUid}`));
      });
    });
  }, [me, soundEnabled]);

  const sendPing = (toUid) => set(ref(db, `pings/${toUid}/${me.uid}`), { time: serverTimestamp() });

  /* ───────────────────────────── Fotky / Galerie ─────────────────────────── */
  const openUserGallery = (uid) => {
    const u = users[uid];
    if (!u?.photos) return;
    setGalleryPhotos(Object.values(u.photos));
    setGalleryIndex(0);
    setShowGallery(true);
  };
  const onPickPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file || !me) return;
    const small = await compressImage(file);
    const id = Date.now();
    const dest = sref(storage, `photos/${me.uid}/${id}.jpg`);
    await uploadBytes(dest, small, { contentType: "image/jpeg" });
    const url = await getDownloadURL(dest);
    update(ref(db, `users/${me.uid}/photos`), { [id]: url });
  };

  /* ───────────────────────────── Chat ─────────────────────────── */
  const openChat = (uid) => {
    setOpenChatWith(uid);
    const pid = pairIdOf(me.uid, uid);
    onValue(ref(db, `messages/${pid}`), (snap) => {
      const msgs = snap.val() || {};
      setChatMsgs(Object.entries(msgs).map(([id, m]) => ({ id, ...m })).sort((a, b) => a.time - b.time));
    });
  };
  const sendMessage = () => {
    if (!chatText.trim()) return;
    const pid = pairIdOf(me.uid, openChatWith);
    push(ref(db, `messages/${pid}`), { from: me.uid, to: openChatWith, text: chatText.trim(), time: Date.now() });
    setChatText("");
  };

  /* ───────────────────────────── Render ─────────────────────────── */
  return (
    <div>
      <div id="map" style={{ width: "100vw", height: "100vh" }} />
      {/* FAB tlačítko pro fotky */}
      <div style={{ position: "absolute", bottom: 20, right: 20 }}>
        <button onClick={() => document.getElementById("filePhoto").click()} style={{ width: 56, height: 56, borderRadius: "50%", background: "#147af3", color: "#fff" }}>📷</button>
        <input id="filePhoto" type="file" accept="image/*" style={{ display: "none" }} onChange={onPickPhoto} />
      </div>
      {/* Tlačítko pro seznam chatů */}
      <div style={{ position: "absolute", bottom: 90, right: 20 }}>
        <button onClick={() => setShowChatsList(true)} style={{ width: 56, height: 56, borderRadius: "50%", background: "#28a745", color: "#fff" }}>💬</button>
      </div>
      {/* Galerie fotek */}
      {showGallery && (
        <div onClick={() => setShowGallery(false)} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.8)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <img src={galleryPhotos[galleryIndex]} style={{ width: "80%", height: "80%", borderRadius: "50%", objectFit: "cover" }} alt="" />
        </div>
      )}
    </div>
  );
                                           }lý kód App.jsx
// ...
