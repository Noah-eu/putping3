// App.jsx – finální mobilní verze PutPing
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  remove,
  push,
  serverTimestamp
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";
import "swiper/css";
import { Swiper, SwiperSlide } from "swiper/react";

// Firebase config
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

// Mapbox token
mapboxgl.accessToken = "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

function pairIdOf(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export default function App() {
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState({});
  const [map, setMap] = useState(null);
  const markers = useRef({});
  const [gallery, setGallery] = useState([]);
  const [chatList, setChatList] = useState([]);
  const [openChatWith, setOpenChatWith] = useState(null);
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatText, setChatText] = useState("");
  const pingSound = useRef(
    new Audio("https://cdn.pixabay.com/download/audio/2022/03/15/audio_8b831a2f36.mp3?filename=notification-113724.mp3")
  );

  // Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      let u = user;
      if (!u) {
        const cred = await signInAnonymously(auth);
        u = cred.user;
      }
      setMe({ uid: u.uid, name: localStorage.getItem("userName") || "Anonym" });

      const meRef = ref(db, `users/${u.uid}`);
      update(meRef, { name: localStorage.getItem("userName") || "Anonym", online: true, lastActive: Date.now() });

      if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
          (pos) => {
            update(meRef, {
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              lastActive: Date.now(),
              online: true
            });
          },
          (err) => console.warn("Geolocation error", err),
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
      }
    });
    return () => unsub();
  }, []);

  // Init map
  useEffect(() => {
    if (map || !me) return;
    const m = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.42076, 50.08804],
      zoom: 13
    });
    setMap(m);
    return () => m.remove();
  }, [me]);

  // Users
  useEffect(() => {
    if (!map || !me) return;
    const unsub = onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      setUsers(data);

      Object.entries(data).forEach(([uid, u]) => {
        if (!u.lat || !u.lng) return;
        const img = document.createElement("img");
        img.src = u.photoURL || "https://via.placeholder.com/50";
        img.style.width = "50px";
        img.style.height = "50px";
        img.style.borderRadius = "50%";
        const el = document.createElement("div");
        el.appendChild(img);

        if (!markers.current[uid]) {
          const mk = new mapboxgl.Marker({ element: el })
            .setLngLat([u.lng, u.lat])
            .addTo(map);
          markers.current[uid] = mk;
          el.addEventListener("click", () => openGallery(uid));
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

  // Pings
  useEffect(() => {
    if (!me) return;
    const unsub = onValue(ref(db, `pings/${me.uid}`), (snap) => {
      if (snap.val()) {
        pingSound.current.play().catch(() => {});
        remove(ref(db, `pings/${me.uid}`));
      }
    });
    return () => unsub();
  }, [me]);

  // Chat list
  useEffect(() => {
    if (!me) return;
    const unsub = onValue(ref(db, "messages"), (snap) => {
      const all = snap.val() || {};
      const list = [];
      Object.entries(all).forEach(([pid, msgs]) => {
        if (pid.includes(me.uid)) {
          const other = pid.replace(me.uid, "").replace("_", "");
          list.push({ uid: other, lastMsg: Object.values(msgs).slice(-1)[0]?.text || "" });
        }
      });
      setChatList(list);
    });
    return () => unsub();
  }, [me]);

  function sendPing(uid) {
    set(ref(db, `pings/${uid}/${me.uid}`), { time: serverTimestamp() });
  }

  function openGallery(uid) {
    const userPhotosRef = ref(db, `photos/${uid}`);
    onValue(userPhotosRef, (snap) => {
      const data = snap.val() || {};
      setGallery(Object.values(data));
    }, { onlyOnce: true });
  }

  function uploadPhoto(isProfile) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file || !me) return;
      const dest = sref(storage, `${isProfile ? "avatars" : "photos"}/${me.uid}_${Date.now()}.jpg`);
      await uploadBytes(dest, file);
      const url = await getDownloadURL(dest);
      if (isProfile) {
        update(ref(db, `users/${me.uid}`), { photoURL: url });
      } else {
        const pRef = push(ref(db, `photos/${me.uid}`));
        set(pRef, url);
      }
    };
    input.click();
  }

  function openChat(uid) {
    setOpenChatWith(uid);
    const pid = pairIdOf(me.uid, uid);
    onValue(ref(db, `messages/${pid}`), (snap) => {
      const arr = Object.entries(snap.val() || {}).map(([id, m]) => ({ id, ...m }));
      setChatMsgs(arr);
    });
  }

  function sendMessage() {
    if (!chatText.trim() || !me || !openChatWith) return;
    const pid = pairIdOf(me.uid, openChatWith);
    push(ref(db, `messages/${pid}`), {
      from: me.uid, text: chatText.trim(), time: Date.now()
    });
    setChatText("");
  }

  function breakContact(uid) {
    const pid = pairIdOf(me.uid, uid);
    remove(ref(db, `messages/${pid}`));
  }

  return (
    <div>
      <div id="map" style={{ width: "100vw", height: "100vh" }} />

      {/* FAB */}
      <div style={{ position: "absolute", bottom: 20, right: 20, zIndex: 10 }}>
        <button onClick={() => uploadPhoto(true)} style={fabBtn}>📷 Profil</button>
        <button onClick={() => uploadPhoto(false)} style={fabBtn}>🖼 Galerie</button>
      </div>

      {/* Chat list */}
      <div style={{ position: "absolute", top: 20, left: 20, zIndex: 10 }}>
        <button onClick={() => setOpenChatWith("LIST")} style={fabBtn}>💬 Chaty</button>
      </div>

      {/* Chat list modal */}
      {openChatWith === "LIST" && (
        <div style={modal}>
          <h3>Moje chaty</h3>
          {chatList.map((c, i) => (
            <div key={i} style={{ borderBottom: "1px solid #ccc" }}>
              <span onClick={() => openChat(c.uid)}>{c.uid} – {c.lastMsg}</span>
              <button onClick={() => breakContact(c.uid)}>❌</button>
            </div>
          ))}
          <button onClick={() => setOpenChatWith(null)}>Zavřít</button>
        </div>
      )}

      {/* Chat modal */}
      {openChatWith && openChatWith !== "LIST" && (
        <div style={modal}>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {chatMsgs.map(m => (
              <div key={m.id} style={{ textAlign: m.from === me.uid ? "right" : "left" }}>{m.text}</div>
            ))}
          </div>
          <input value={chatText} onChange={e => setChatText(e.target.value)} onKeyDown={e => e.key === "Enter" && sendMessage()} />
          <button onClick={sendMessage}>Odeslat</button>
          <button onClick={() => setOpenChatWith(null)}>Zavřít</button>
        </div>
      )}

      {/* Gallery swipe */}
      {gallery.length > 0 && (
        <div style={modal}>
          <Swiper spaceBetween={10} slidesPerView={1}>
            {gallery.map((url, i) => (
              <SwiperSlide key={i}>
                <img src={url} style={{ width: "100%", height: "auto" }} />
              </SwiperSlide>
            ))}
          </Swiper>
          <button onClick={() => setGallery([])}>Zavřít</button>
        </div>
      )}
    </div>
  );
}

const fabBtn = {
  padding: "10px 14px", borderRadius: "50%", border: "none", background: "#147af3", color: "#fff", margin: "5px"
};

const modal = {
  position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
  background: "#fff", display: "flex", flexDirection: "column", zIndex: 20, padding: 10
};
