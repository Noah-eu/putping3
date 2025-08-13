// App.jsx – finální verze pro mobily s FAB, galerií, pingem, chatem a swipe náhledem

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

import "swiper/css";
import { Swiper, SwiperSlide } from "swiper/react";

/* Firebase */
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

/* Mapbox */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

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
  const ratio = Math.min(maxDim / Math.max(img.width, img.height), 1);
  const canvas = document.createElement("canvas");
  canvas.width = img.width * ratio;
  canvas.height = img.height * ratio;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", quality)
  );
}

export default function App() {
  const [map, setMap] = useState(null);
  const [me, setMe] = useState(null);
  const [users, setUsers] = useState({});
  const [galleries, setGalleries] = useState({});
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("soundEnabled") === "1"
  );
  const [chatList, setChatList] = useState([]);
  const [openChatWith, setOpenChatWith] = useState(null);
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatText, setChatText] = useState("");
  const [galleryView, setGalleryView] = useState(null);
  const [fabOpen, setFabOpen] = useState(false);
  const markers = useRef({});
  const pingSound = useRef(
    new Audio(
      "https://cdn.pixabay.com/download/audio/2022/03/15/audio_8b831a2f36.mp3?filename=notification-113724.mp3"
    )
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      let u = user;
      if (!u) {
        const cred = await signInAnonymously(auth);
        u = cred.user;
      }
      setMe({ uid: u.uid, name: "Anonym" });
      const meRef = ref(db, `users/${u.uid}`);
      update(meRef, { lastActive: Date.now(), online: true });

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

  useEffect(() => {
    if (map || !me) return;
    const m = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.42, 50.088],
      zoom: 13,
    });
    setMap(m);
    return () => m.remove();
  }, [me]);

  useEffect(() => {
    if (!map || !me) return;
    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      setUsers(data);

      Object.entries(data).forEach(([uid, u]) => {
        if (!u.lat || !u.lng) return;
        const photo = u.photoURL;
        const el = document.createElement("div");
        el.style.width = "40px";
        el.style.height = "40px";
        el.style.borderRadius = "50%";
        el.style.overflow = "hidden";
        el.style.border = "2px solid white";
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.style.backgroundImage = `url(${photo || ""})`;

        if (!markers.current[uid]) {
          const mk = new mapboxgl.Marker(el)
            .setLngLat([u.lng, u.lat])
            .addTo(map);
          el.addEventListener("click", () => setGalleryView(uid));
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

  useEffect(() => {
    if (!me) return;
    const refGal = ref(db, "galleries");
    return onValue(refGal, (snap) => {
      setGalleries(snap.val() || {});
    });
  }, [me]);

  const uploadPhoto = async (type) => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const small = await compressImage(file);
      const path =
        type === "profile"
          ? `avatars/${me.uid}.jpg`
          : `galleries/${me.uid}/${Date.now()}.jpg`;
      const dest = sref(storage, path);
      await uploadBytes(dest, small);
      const url = await getDownloadURL(dest);
      if (type === "profile") {
        await update(ref(db, `users/${me.uid}`), { photoURL: url });
      } else {
        await push(ref(db, `galleries/${me.uid}`), { url });
      }
    };
    fileInput.click();
  };

  const sendPing = async (toUid) => {
    await set(ref(db, `pings/${toUid}/${me.uid}`), { time: serverTimestamp() });
    if (soundEnabled) {
      pingSound.current.currentTime = 0;
      pingSound.current.play();
    }
  };

  const openChat = (uid) => {
    setOpenChatWith(uid);
    const pid = pairIdOf(me.uid, uid);
    const msgsRef = ref(db, `messages/${pid}`);
    onValue(msgsRef, (snap) => {
      const arr = Object.entries(snap.val() || {}).map(([id, m]) => ({
        id,
        ...m,
      }));
      arr.sort((a, b) => a.time - b.time);
      setChatMsgs(arr);
    });
  };

  const sendMessage = async () => {
    if (!chatText.trim()) return;
    const pid = pairIdOf(me.uid, openChatWith);
    await push(ref(db, `messages/${pid}`), {
      from: me.uid,
      text: chatText.trim(),
      time: Date.now(),
    });
    setChatText("");
  };

  return (
    <div>
      <div id="map" style={{ width: "100vw", height: "100vh" }}></div>

      {fabOpen && (
        <div style={{ position: "absolute", bottom: 80, right: 20, zIndex: 10 }}>
          <button onClick={() => uploadPhoto("profile")}>📷 Profil</button>
          <button onClick={() => uploadPhoto("gallery")}>🖼 Galerie</button>
        </div>
      )}

      <button
        onClick={() => setFabOpen((p) => !p)}
        style={{
          position: "absolute",
          bottom: 20,
          right: 20,
          width: 60,
          height: 60,
          borderRadius: "50%",
          background: "#147af3",
          color: "white",
          fontSize: 24,
          zIndex: 10,
        }}
      >
        ＋
      </button>

      {galleryView && (
        <div
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "50%",
            background: "#000",
            zIndex: 20,
          }}
        >
          <Swiper>
            {galleries[galleryView] &&
              Object.values(galleries[galleryView]).map((p, i) => (
                <SwiperSlide key={i}>
                  <img
                    src={p.url}
                    style={{
                      width: 200,
                      height: 200,
                      borderRadius: "50%",
                      objectFit: "cover",
                      margin: "auto",
                      marginTop: 20,
                    }}
                  />
                </SwiperSlide>
              ))}
          </Swiper>
          <button onClick={() => setGalleryView(null)}>Zavřít</button>
        </div>
      )}

      {openChatWith && (
        <div
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: 0,
            right: 0,
            background: "#fff",
            zIndex: 30,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <button onClick={() => setOpenChatWith(null)}>✖</button>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {chatMsgs.map((m) => (
              <div key={m.id}>{m.text}</div>
            ))}
          </div>
          <div style={{ display: "flex" }}>
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
            />
            <button onClick={sendMessage}>➤</button>
          </div>
        </div>
      )}
    </div>
  );
}
