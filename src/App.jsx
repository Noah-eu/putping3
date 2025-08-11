// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  serverTimestamp,
} from "firebase/database";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getStorage,
  ref as sref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

/* ====== TVÉ KLÍČE ====== */
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
/* ======================= */

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const storage = getStorage(app);

// 5 minut – po této době je uživatel považován za offline
const OFFLINE_TTL = 5 * 60 * 1000;

export default function App() {
  const mapRef = useRef(null);
  const mapboxRef = useRef(null);
  const markersRef = useRef({}); // id -> marker
  const [uid, setUid] = useState(null);
  const [me, setMe] = useState({
    name: localStorage.getItem("pp_name") || "Anonymní uživatel",
    photoURL: localStorage.getItem("pp_photoURL") || "",
  });
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("pp_sound") === "1"
  );
  const audioCtxRef = useRef(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showOffline, setShowOffline] = useState(
    localStorage.getItem("pp_showOffline") !== "0"
  );
  const [locAllowed, setLocAllowed] = useState(false);

  // === zvuk (WebAudio) ===
  const ensureAudio = async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext ||
        window.webkitAudioContext)();
    }
    if (audioCtxRef.current.state === "suspended") {
      await audioCtxRef.current.resume();
    }
  };
  const playBeep = async (ms = 180) => {
    try {
      await ensureAudio();
      const ctx = audioCtxRef.current;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      o.start();
      o.stop(ctx.currentTime + ms / 1000);
    } catch {
      // ticho; prohlížeč zamítl
    }
  };

  // === přihlášení anonymně ===
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUid(user.uid);
      } else {
        const cred = await signInAnonymously(auth);
        setUid(cred.user.uid);
      }
    });
    return () => unsub();
  }, []);

  // === inicializace mapy ===
  useEffect(() => {
    if (mapboxRef.current || !uid) return;

    mapboxRef.current = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.42076, 50.08804],
      zoom: 5,
    });

    mapboxRef.current.addControl(new mapboxgl.NavigationControl(), "bottom-right");

    // Po načtení poprosíme o polohu (neblokuje mapu)
    if ("geolocation" in navigator) {
      const id = navigator.geolocation.watchPosition(
        (pos) => {
          setLocAllowed(true);
          const { latitude, longitude } = pos.coords;

          // poprvé mapu přiblížíme na mě
          if (!mapRef.current) {
            mapboxRef.current.setCenter([longitude, latitude]);
            mapboxRef.current.setZoom(14);
          }

          mapRef.current = { lat: latitude, lng: longitude, ts: Date.now() };

          // uložím se do DB
          if (uid) {
            update(ref(db, `users/${uid}`), {
              name: me.name,
              photoURL: me.photoURL || "",
              lat: latitude,
              lng: longitude,
              lastActive: Date.now(),
              updatedAt: serverTimestamp(),
            });
          }
        },
        () => {
          setLocAllowed(false);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
      );

      return () => navigator.geolocation.clearWatch(id);
    }
  }, [uid]);

  // === posluchač všech uživatelů ===
  useEffect(() => {
    if (!uid || !mapboxRef.current) return;
    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      const now = Date.now();

      // vytvořit / aktualizovat markery
      Object.entries(data).forEach(([id, u]) => {
        if (!u || !("lat" in u) || !("lng" in u)) return;

        const offline = !u.lastActive || now - u.lastActive > OFFLINE_TTL;
        if (id !== uid && !showOffline && offline) {
          // skrýt
          if (markersRef.current[id]) {
            markersRef.current[id].remove();
            delete markersRef.current[id];
          }
          return;
        }

        // HTML marker (fotka nebo barevné kolečko)
        const el = document.createElement("div");
        const size = id === uid ? 44 : 36;
        el.style.width = el.style.height = `${size}px`;
        el.style.borderRadius = "50%";
        el.style.boxShadow = "0 2px 8px rgba(0,0,0,.35)";
        el.style.border = id === uid ? "3px solid #ff4d4f" : "2px solid #fff";
        el.style.overflow = "hidden";
        el.style.background = offline ? "#9aa0a6" : "#e0e0e0";

        if (u.photoURL && !offline) {
          el.style.backgroundImage = `url("${u.photoURL}")`;
          el.style.backgroundSize = "cover";
          el.style.backgroundPosition = "center";
        }

        // popup s informacemi
        const ago = timeAgo(u.lastActive);
        const popup = new mapboxgl.Popup({ offset: 22, closeOnClick: true })
          .setHTML(
            `
            <div style="min-width:180px">
              <div style="font-weight:600;margin-bottom:4px">${escapeHtml(
                u.name || "Anonym"
              )}</div>
              <div style="font-size:12px;color:#666;">${
                offline ? "offline" : "online"
              } • ${ago}</div>
            </div>`
          );

        // vytvořit / aktualizovat marker
        const lngLat = [u.lng, u.lat];
        if (!markersRef.current[id]) {
          markersRef.current[id] = new mapboxgl.Marker({ element: el })
            .setLngLat(lngLat)
            .setPopup(popup)
            .addTo(mapboxRef.current);
        } else {
          // nehýbat offline – už „neznačíme“ jeho pohyb
          if (!offline) {
            markersRef.current[id].setLngLat(lngLat);
          }
          markersRef.current[id].setPopup(popup);
          markersRef.current[id].getElement().replaceWith(el);
          markersRef.current[id]._element = el; // pro jistotu
        }
      });

      // smazat markery, kteří už nejsou v DB
      Object.keys(markersRef.current).forEach((id) => {
        if (!data[id]) {
          markersRef.current[id].remove();
          delete markersRef.current[id];
        }
      });
    });

    return () => unsub();
  }, [uid, showOffline]);

  // === volby uživatele – uložení ===
  const saveName = async (name) => {
    setMe((m) => ({ ...m, name }));
    localStorage.setItem("pp_name", name);
    if (uid && mapRef.current) {
      await update(ref(db, `users/${uid}`), {
        name,
        lastActive: Date.now(),
      });
    }
  };

  const onPickPhoto = async (file) => {
    if (!file || !uid) return;
    try {
      // zmenšíme upload (do 1000px delší strana) – mobilní prohlížeče zvládají Canvas
      const resized = await resizeImage(file, 1000);
      const path = sref(storage, `avatars/${uid}.jpg`);
      await uploadBytes(path, resized, { contentType: "image/jpeg" });
      const url = await getDownloadURL(path);
      localStorage.setItem("pp_photoURL", url);
      setMe((m) => ({ ...m, photoURL: url }));
      await update(ref(db, `users/${uid}`), { photoURL: url, lastActive: Date.now() });
    } catch (e) {
      alert("Nahrávání fotky se nezdařilo.");
    }
  };

  const centerOnMe = () => {
    if (mapRef.current && mapboxRef.current) {
      const { lng, lat } = mapRef.current;
      mapboxRef.current.easeTo({ center: [lng, lat], zoom: 15 });
    } else {
      alert("Poloha není k dispozici (povol polohu).");
    }
  };

  // === nastavení – přepínače ===
  const toggleSound = async () => {
    if (!soundEnabled) {
      // první klepnutí – „odemkneme“ audio
      await ensureAudio();
      await playBeep(120);
      setSoundEnabled(true);
      localStorage.setItem("pp_sound", "1");
    } else {
      setSoundEnabled(false);
      localStorage.setItem("pp_sound", "0");
    }
  };

  const toggleShowOffline = () => {
    const next = !showOffline;
    setShowOffline(next);
    localStorage.setItem("pp_showOffline", next ? "1" : "0");
  };

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <div id="map" style={{ width: "100%", height: "100%" }} />

      {/* FAB: centrum na mně */}
      <button
        onClick={centerOnMe}
        style={fabStyle(72)}
        title="Najít mě"
        aria-label="Najít mě"
      >
        📍
      </button>

      {/* FAB: nastavení */}
      <button
        onClick={() => setSettingsOpen((v) => !v)}
        style={fabStyle(16)}
        title="Nastavení"
        aria-label="Nastavení"
      >
        ⚙️
      </button>

      {/* Panel nastavení */}
      {settingsOpen && (
        <div style={panelStyle}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Nastavení</div>

          {/* jméno */}
          <label style={labelStyle}>Jméno</label>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <input
              type="text"
              defaultValue={me.name}
              placeholder="Tvoje jméno"
              style={inputStyle}
              onBlur={(e) => saveName(e.target.value.trim() || "Anonymní uživatel")}
            />
            <button
              onClick={(e) => {
                const inp = e.currentTarget.previousSibling;
                if (inp && inp.tagName === "INPUT") {
                  saveName(inp.value.trim() || "Anonymní uživatel");
                }
              }}
              style={btnStyle}
            >
              Uložit
            </button>
          </div>

          {/* fotka */}
          <label style={labelStyle}>Profilová fotka</label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: "50%",
                border: "2px solid #eee",
                background: me.photoURL ? `url(${me.photoURL}) center/cover` : "#ddd",
              }}
            />
            <input
              type="file"
              accept="image/*"
              onChange={(e) => onPickPhoto(e.target.files?.[0] || null)}
            />
          </div>

          {/* zvuk */}
          <div style={{ marginTop: 16 }}>
            <button onClick={toggleSound} style={btnStyle}>
              {soundEnabled ? "🔊 Zvuk povolen" : "🔇 Povolit zvuk"}
            </button>
          </div>

          {/* offline */}
          <div style={{ marginTop: 8 }}>
            <label style={{ userSelect: "none" }}>
              <input
                type="checkbox"
                checked={showOffline}
                onChange={toggleShowOffline}
                style={{ marginRight: 8 }}
              />
              Zobrazit offline uživatele (šedě)
            </label>
          </div>

          {/* poloha */}
          <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
            Poloha: {locAllowed ? "povolena" : "nepovolena"}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===================== Pomocné funkce & styly ===================== */

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

function escapeHtml(s = "") {
  return s.replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
}

function fabStyle(bottomGap) {
  return {
    position: "fixed",
    right: 16,
    bottom: bottomGap,
    width: 56,
    height: 56,
    borderRadius: "50%",
    border: "none",
    background: "#111",
    color: "#fff",
    fontSize: 22,
    boxShadow: "0 10px 24px rgba(0,0,0,.35)",
    zIndex: 9999,
  };
}

const panelStyle = {
  position: "fixed",
  right: 16,
  bottom: 90,
  width: 300,
  maxWidth: "92vw",
  background: "#fff",
  borderRadius: 16,
  padding: 14,
  boxShadow: "0 18px 36px rgba(0,0,0,.35)",
  zIndex: 9999,
};

const labelStyle = { fontSize: 12, color: "#555", marginBottom: 4, display: "block" };
const inputStyle = {
  flex: 1,
  border: "1px solid #ddd",
  borderRadius: 8,
  padding: "10px 12px",
  fontSize: 14,
};
const btnStyle = {
  border: "none",
  background: "#111",
  color: "#fff",
  borderRadius: 10,
  padding: "10px 12px",
  fontWeight: 600,
  cursor: "pointer",
};

async function resizeImage(file, maxSide = 1000) {
  // pokud prohlížeč neumí canvas, vrať původní soubor
  if (!("createImageBitmap" in window) || !("OffscreenCanvas" in window)) return file;

  const bmp = await createImageBitmap(file);
  const ratio = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * ratio);
  const h = Math.round(bmp.height * ratio);

  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bmp, 0, 0, w, h);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
  }
