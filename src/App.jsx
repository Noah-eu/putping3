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
import { useSwipeable } from "react-swipeable";

/* ───────── Firebase ───────── */
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

mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ───────── Helpers ───────── */
function pairIdOf(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
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

/* ───────── App ───────── */
export default function App() {
  const [map, setMap] = useState(null);
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState({});
  const [openChatList, setOpenChatList] = useState(false);
  const [openChatWith, setOpenChatWith] = useState(null);
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatText, setChatText] = useState("");
  const [gallery, setGallery] = useState([]);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showGallery, setShowGallery] = useState(false);
  const markers = useRef({});

  const pingSound = useRef(
    new Audio(
      "https://cdn.pixabay.com/download/audio/2022/03/15/audio_8b831a2f36.mp3?filename=notification-113724.mp3"
    )
  );

  /* ── Auth ── */
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
      update(meRef, { name: "Anonym", lastActive: Date.now(), online: true });

      if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
          (pos) => {
            update(meRef, {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              lastActive: Date.now(),
              online: true,
            });
          },
          () => {},
          { enableHighAccuracy: true }
        );
      }
    });
    return () => unsub();
  }, []);

  /* ── Map ── */
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

  /* ── Markers ── */
  useEffect(() => {
    if (!map || !me) return;
    const unsub = onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      setUsers(data);
      Object.entries(data).forEach(([uid, u]) => {
        if (!u.lat || !u.lng) return;
        if (!markers.current[uid]) {
          const el = document.createElement("div");
          el.style.width = "40px";
          el.style.height = "40px";
          el.style.borderRadius = "50%";
          el.style.backgroundSize = "cover";
          el.style.backgroundImage = u.photoURL
            ? `url(${u.photoURL})`
            : "url(https://via.placeholder.com/40)";
          el.onclick = () => {
            if (u.photos) {
              setGallery(u.photos);
              setGalleryIndex(0);
              setShowGallery(true);
            }
          };
          markers.current[uid] = new mapboxgl.Marker(el)
            .setLngLat([u.lng, u.lat])
            .addTo(map);
        } else {
          markers.current[uid].setLngLat([u.lng, u.lat]);
        }
      });
    });
    return () => unsub();
  }, [map, me]);

  /* ── Chat list ── */
  const openChat = (uid) => {
    setOpenChatWith(uid);
    const pid = pairIdOf(me.uid, uid);
    onValue(ref(db, `messages/${pid}`), (snap) => {
      const msgs = Object.values(snap.val() || {}).sort((a, b) => a.time - b.time);
      setChatMsgs(msgs);
    });
  };

  const sendMessage = () => {
    if (!chatText.trim()) return;
    const pid = pairIdOf(me.uid, openChatWith);
    push(ref(db, `messages/${pid}`), {
      from: me.uid,
      to: openChatWith,
      text: chatText.trim(),
      time: Date.now(),
    });
    setChatText("");
  };

  const disconnectUser = (uid) => {
    const pid = pairIdOf(me.uid, uid);
    remove(ref(db, `messages/${pid}`));
  };

  /* ── Photo upload ── */
  const uploadPhoto = async (isProfile) => {
    const picker = document.createElement("input");
    picker.type = "file";
    picker.accept = "image/*";
    picker.onchange = async (e) => {
      const file = e.target.files[0];
      const small = await compressImage(file);
      const path = isProfile
        ? `avatars/${me.uid}.jpg`
        : `photos/${me.uid}/${Date.now()}.jpg`;
      const dest = sref(storage, path);
      await uploadBytes(dest, small);
      const url = await getDownloadURL(dest);
      if (isProfile) {
        update(ref(db, `users/${me.uid}`), { photoURL: url });
      } else {
        const userRef = ref(db, `users/${me.uid}/photos`);
        onValue(userRef, (snap) => {
          const arr = snap.val() || [];
          set(userRef, [...arr, url]);
        }, { onlyOnce: true });
      }
    };
    picker.click();
  };

  /* ── Swipe handlers ── */
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () =>
      setGalleryIndex((i) => (i + 1) % (gallery.length || 1)),
    onSwipedRight: () =>
      setGalleryIndex((i) => (i - 1 + gallery.length) % (gallery.length || 1)),
  });

  /* ── UI ── */
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <div id="map" style={{ width: "100%", height: "100%" }} />
      {/* FAB */}
      <div style={{ position: "absolute", bottom: 20, right: 20 }}>
        <button
          onClick={() => {
            const menu = document.getElementById("fabMenu");
            menu.style.display =
              menu.style.display === "flex" ? "none" : "flex";
          }}
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background: "#147af3",
            color: "#fff",
            fontSize: 24,
            border: "none",
          }}
        >
          ＋
        </button>
        <div
          id="fabMenu"
          style={{
            display: "none",
            flexDirection: "column",
            gap: 8,
            marginTop: 8,
          }}
        >
          <button onClick={() => uploadPhoto(true)}>Profilová fotka</button>
          <button onClick={() => uploadPhoto(false)}>Do galerie</button>
        </div>
      </div>

      {/* Chat list button */}
      <div style={{ position: "absolute", bottom: 100, right: 20 }}>
        <button onClick={() => setOpenChatList(true)}>💬 Chaty</button>
      </div>

      {/* Chat list modal */}
      {openChatList && (
        <div style={{ position: "absolute", inset: 0, background: "#fff" }}>
          <h3>Moje chaty</h3>
          {Object.keys(users)
            .filter((uid) => uid !== me.uid)
            .map((uid) => (
              <div key={uid}>
                <span>{users[uid]?.name || "Anonym"}</span>
                <button onClick={() => openChat(uid)}>Otevřít</button>
                <button onClick={() => disconnectUser(uid)}>❌</button>
              </div>
            ))}
          <button onClick={() => setOpenChatList(false)}>Zavřít</button>
        </div>
      )}

      {/* Chat modal */}
      {openChatWith && (
        <div style={{ position: "absolute", inset: 0, background: "#fff" }}>
          <h3>Chat</h3>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {chatMsgs.map((m, i) => (
              <div key={i} style={{ textAlign: m.from === me.uid ? "right" : "left" }}>
                {m.text}
              </div>
            ))}
          </div>
          <input
            value={chatText}
            onChange={(e) => setChatText(e.target.value)}
          />
          <button onClick={sendMessage}>Poslat</button>
          <button onClick={() => setOpenChatWith(null)}>Zpět</button>
        </div>
      )}

      {/* Gallery modal */}
      {showGallery && (
        <div
          {...swipeHandlers}
          style={{
            position: "absolute",
            inset: 0,
            background: "#000",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setShowGallery(false)}
        >
          <img
            src={gallery[galleryIndex]}
            alt=""
            style={{
              maxWidth: "90%",
              maxHeight: "90%",
              borderRadius: "50%",
              objectFit: "cover",
            }}
          />
        </div>
      )}
    </div>
  );
}
