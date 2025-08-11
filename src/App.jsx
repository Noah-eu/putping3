import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  onDisconnect,
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

/* ==== Mapbox & Firebase config (tvé hodnoty) ==== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

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

/* ==== Pomocné ==== */
const styles = {
  fab: {
    position: "absolute",
    right: 16,
    bottom: 16,
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "#111",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
    cursor: "pointer",
    zIndex: 10,
    fontSize: 22,
  },
  sheet: {
    position: "absolute",
    right: 12,
    bottom: 84,
    width: 320,
    maxWidth: "calc(100vw - 24px)",
    background: "#fff",
    borderRadius: 16,
    boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
    padding: 16,
    zIndex: 10,
  },
  row: { display: "flex", gap: 8, alignItems: "center" },
  label: { fontSize: 13, color: "#555" },
  input: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #ddd",
    outline: "none",
  },
  btn: {
    padding: "10px 14px",
    background: "#111",
    color: "#fff",
    borderRadius: 10,
    border: 0,
    cursor: "pointer",
  },
  ghost: {
    padding: "10px 14px",
    background: "#f2f2f2",
    color: "#111",
    borderRadius: 10,
    border: 0,
    cursor: "pointer",
  },
  chipOk: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    background: "#e8fff0",
    color: "#0a7d39",
    border: "1px solid #bdf0d1",
    padding: "8px 10px",
    borderRadius: 999,
    fontSize: 13,
  },
};

function timeAgo(ts) {
  if (!ts) return "neznámo";
  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 60) return `před ${diff} s`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.floor(h / 24);
  return `před ${d} dny`;
}

/* ==== Aplikace (Fáze 1) ==== */
export default function App() {
  const mapRef = useRef(null);
  const mapObj = useRef(null);
  const meMarker = useRef(null);
  const [uid, setUid] = useState(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("soundEnabled") === "1"
  );
  const [name, setName] = useState(localStorage.getItem("name") || "");
  const [photoURL, setPhotoURL] = useState(null);
  const fileInput = useRef(null);

  // Anonymní přihlášení
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUid(user.uid);
      } else {
        await signInAnonymously(auth);
      }
    });
    return () => unsub();
  }, []);

  // Nahrání profilu z DB (jméno, fotka)
  useEffect(() => {
    if (!uid) return;
    const uref = ref(db, `users/${uid}`);
    const off = onValue(uref, (snap) => {
      const v = snap.val() || {};
      if (v.name && !name) setName(v.name);
      if (v.photoURL) setPhotoURL(v.photoURL);
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // Inicializace mapy a poloha
  useEffect(() => {
    if (!uid) return;

    mapObj.current = new mapboxgl.Map({
      container: mapRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [14.42076, 50.08804], // Praha fallback
      zoom: 12,
    });

    mapObj.current.addControl(new mapboxgl.NavigationControl(), "bottom-right");

    // zkusit geolokaci
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          mapObj.current.setCenter([longitude, latitude]);
          placeOrMoveMe(longitude, latitude);
          writePresence(longitude, latitude);
        },
        () => {
          // pokud nedovoleno, zapíšeme přítomnost bez polohy
          writePresence();
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );

      // průběžný update polohy (pokud povolena)
      const watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          placeOrMoveMe(longitude, latitude);
          update(ref(db, `users/${uid}`), {
            location: { lat: latitude, lng: longitude },
            lastActive: Date.now(),
            online: true,
          });
        },
        () => {},
        { enableHighAccuracy: true }
      );
      return () => navigator.geolocation.clearWatch(watchId);
    } else {
      writePresence();
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  function placeOrMoveMe(lng, lat) {
    if (!mapObj.current) return;
    if (!meMarker.current) {
      const el = document.createElement("div");
      el.style.width = "22px";
      el.style.height = "22px";
      el.style.borderRadius = "50%";
      el.style.background = "#e11";
      el.style.boxShadow = "0 0 0 3px rgba(255,0,0,0.25)";
      meMarker.current = new mapboxgl.Marker(el)
        .setLngLat([lng, lat])
        .addTo(mapObj.current);
    } else {
      meMarker.current.setLngLat([lng, lat]);
    }
  }

  function writePresence(lng, lat) {
    const uref = ref(db, `users/${uid}`);
    set(uref, {
      name: name || "Anonymní uživatel",
      photoURL: photoURL || null,
      location:
        typeof lng === "number" && typeof lat === "number"
          ? { lat, lng }
          : null,
      lastActive: Date.now(),
      online: true,
    });

    // udržovat lastActive
    const int = setInterval(() => {
      update(uref, { lastActive: Date.now(), online: true });
    }, 20000);

    // po odpojení nezmizíme – jen nastavíme online=false a poslední čas
    onDisconnect(uref).update({ online: false, lastActive: Date.now() });

    return () => clearInterval(int);
  }

  // Uložení jména
  const saveName = async () => {
    if (!uid) return;
    localStorage.setItem("name", name);
    await update(ref(db, `users/${uid}`), { name });
  };

  // Povolit zvuk (žádost o permission pro Notifications + ping zvuku)
  const toggleSound = async () => {
    const willEnable = !soundEnabled;
    if (willEnable && "Notification" in window) {
      try {
        if (Notification.permission === "default") {
          await Notification.requestPermission();
        }
      } catch {}
    }
    setSoundEnabled(willEnable);
    localStorage.setItem("soundEnabled", willEnable ? "1" : "0");
    // potvrzovací pípnutí
    try {
      const a = new Audio(
        "https://actions.google.com/sounds/v1/cartoon/clang_and_wobble.ogg"
      );
      await a.play();
    } catch {}
  };

  // Upload profilovky
  const onPickPhoto = () => fileInput.current?.click();

  const onPhotoSelected = async (e) => {
    if (!uid || !e.target.files?.[0]) return;
    const file = e.target.files[0];

    // zmenšení (max delší strana 512 px) – jednoduchá komprese v canvasu
    const downsized = await downscaleImage(file, 512);

    const r = sref(storage, `avatars/${uid}.jpg`);
    await uploadBytes(r, downsized, { contentType: "image/jpeg" });
    const url = await getDownloadURL(r);
    setPhotoURL(url);
    await update(ref(db, `users/${uid}`), { photoURL: url });
  };

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      {/* MAPA */}
      <div ref={mapRef} style={{ width: "100%", height: "100%" }} />

      {/* FAB – kolečko */}
      <button
        aria-label="Nastavení"
        style={styles.fab}
        onClick={() => setSettingsOpen((v) => !v)}
      >
        ⚙️
      </button>

      {/* Panel nastavení */}
      {settingsOpen && (
        <div style={styles.sheet}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                background: "#eee",
                overflow: "hidden",
                flexShrink: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {photoURL ? (
                <img
                  src={photoURL}
                  alt="avatar"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span style={{ fontSize: 20 }}>👤</span>
              )}
            </div>

            <div style={{ flex: 1 }}>
              <div style={styles.label}>Jméno</div>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tvoje jméno"
                style={styles.input}
              />
            </div>
          </div>

          <div style={{ height: 12 }} />

          <div className="row" style={{ ...styles.row, justifyContent: "end" }}>
            <button style={styles.ghost} onClick={onPickPhoto}>
              📷 Nahrát fotku
            </button>
            <input
              ref={fileInput}
              onChange={onPhotoSelected}
              type="file"
              accept="image/*"
              hidden
            />
            <button style={styles.btn} onClick={saveName}>
              Uložit jméno
            </button>
          </div>

          <div style={{ height: 12 }} />

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button style={styles.ghost} onClick={toggleSound}>
              {soundEnabled ? "🔊 Zvuk povolen" : "🔇 Povolit zvuk"}
            </button>
            {soundEnabled && <span style={styles.chipOk}>hotovo</span>}
          </div>

          <div style={{ height: 10 }} />
          <div style={{ fontSize: 12, color: "#666" }}>
            Poslední aktivita:{" "}
            <strong>{timeAgo(Date.now())}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==== util: zmenšení fotky v prohlížeči ==== */
async function downscaleImage(file, maxSize = 512) {
  const img = await blobToImage(file);
  const { width, height } = fitInto(img.naturalWidth, img.naturalHeight, maxSize);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await new Promise((res) =>
    canvas.toBlob(res, "image/jpeg", 0.85)
  );
  return blob || file;
}
function blobToImage(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.src = url;
  });
}
function fitInto(w, h, max) {
  if (Math.max(w, h) <= max) return { width: w, height: h };
  const ratio = w > h ? max / w : max / h;
  return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
}
