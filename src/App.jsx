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
  update,
  onValue,
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

/* ====== TOKENS / CONFIG ====== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL:
    "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X",
};
/* ================================= */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

// helper
function timeAgo(ts) {
  if (!ts) return "neznámo";
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `před ${diff} s`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `před ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.floor(h / 24);
  return `před ${d} dny`;
}

export default function App() {
  // identity
  const [uid, setUid] = useState(localStorage.getItem("uid") || "");
  const [name, setName] = useState(localStorage.getItem("name") || "Anonym");
  const [soundOn, setSoundOn] = useState(localStorage.getItem("soundOn") === "true");
  const [showOffline, setShowOffline] = useState(localStorage.getItem("showOffline") !== "false");

  // UI state
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // map refs
  const mapRef = useRef(null);
  const myMarkerRef = useRef(null);
  const myPopupRef = useRef(null);
  const myPhotoURLRef = useRef(""); // pro pře-styling
  const others = useRef({}); // id -> Marker

  // sound
  const ding = useRef(new Audio("https://cdn.pixabay.com/download/audio/2022/03/15/audio_0e4e4b7f05.mp3?filename=click-124467.mp3"));

  /* AUTH */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUid(u.uid);
        localStorage.setItem("uid", u.uid);
      }
    });
    if (!auth.currentUser) signInAnonymously(auth).catch(() => {});
    return () => unsub();
  }, []);

  /* MAP INIT */
  useEffect(() => {
    if (mapRef.current) return;
    const map = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.42076, 50.08804],
      zoom: 6,
    });
    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    mapRef.current = map;
  }, []);

  /* MY LOCATION (only geolocation drives it) */
  useEffect(() => {
    if (!uid || !mapRef.current) return;

    // ensure my marker + popup exists
    const ensureMyMarker = () => {
      if (myMarkerRef.current) return;

      const el = document.createElement("div");
      Object.assign(el.style, {
        width: "28px",
        height: "28px",
        borderRadius: "50%",
        background: "#fff",
        border: "4px solid #e74c3c",
        boxShadow: "0 0 0 3px rgba(231,76,60,.25)",
      });
      const m = new mapboxgl.Marker({ element: el });
      const p = new mapboxgl.Popup({ offset: 18 }).setHTML(`<b>${name}</b>`);
      myPopupRef.current = p;
      myMarkerRef.current = m.setPopup(p);
    };

    const onPos = (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      ensureMyMarker();
      myMarkerRef.current.setLngLat([lng, lat]).addTo(mapRef.current);

      // update popup text (jméno)
      myPopupRef.current?.setHTML(`<b>${name || "Anonym"}</b>`);

      // push to DB for others
      update(ref(db, `users/${uid}`), {
        name: name || "Anonym",
        lat,
        lng,
        lastActive: Date.now(),
        photoURL: myPhotoURLRef.current || null,
      }).catch(() => {});
    };

    const onErr = () => {};

    // first shot and follow
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          mapRef.current.jumpTo({ center: [lng, lat], zoom: 14 });
          onPos(pos);
        },
        onErr,
        { enableHighAccuracy: true, timeout: 10000 }
      );
      const id = navigator.geolocation.watchPosition(onPos, onErr, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000,
      });
      return () => navigator.geolocation.clearWatch(id);
    }
  }, [uid, name]);

  /* OTHERS FEED */
  useEffect(() => {
    if (!mapRef.current) return;
    const TTL = 5 * 60 * 1000;

    const unsub = onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      const now = Date.now();

      // create/update
      Object.entries(data).forEach(([id, user]) => {
        if (!user || !user.lat || !user.lng) return;
        if (id === uid) {
          // můj marker – jen popup update jména/fotky (pozici ne!)
          if (myMarkerRef.current) {
            myPopupRef.current?.setHTML(`<b>${user.name || "Anonym"}</b>`);
            if (user.photoURL && myPhotoURLRef.current !== user.photoURL) {
              myPhotoURLRef.current = user.photoURL;
              const el = myMarkerRef.current.getElement();
              el.style.backgroundImage = `url("${user.photoURL}")`;
              el.style.backgroundSize = "cover";
              el.style.backgroundPosition = "center";
              el.style.border = "3px solid #e74c3c";
              el.style.boxShadow = "0 0 0 3px rgba(231,76,60,.25)";
            }
          }
          return;
        }

        const offline = now - (user.lastActive || 0) > TTL;
        if (!showOffline && offline) {
          if (others.current[id]) {
            others.current[id].remove();
            delete others.current[id];
          }
          return;
        }

        // build marker element
        const buildEl = () => {
          const el = document.createElement("div");
          if (user.photoURL) {
            Object.assign(el.style, {
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              backgroundImage: `url("${user.photoURL}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              border: "3px solid #fff",
              boxShadow: "0 0 0 3px rgba(0,0,0,.15)",
            });
          } else {
            Object.assign(el.style, {
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: offline ? "#bdbdbd" : "#3498db",
              border: "3px solid #fff",
              boxShadow: "0 0 0 3px rgba(0,0,0,.15)",
            });
          }
          return el;
        };

        if (!others.current[id]) {
          const marker = new mapboxgl.Marker({ element: buildEl() })
            .setLngLat([user.lng, user.lat])
            .setPopup(
              new mapboxgl.Popup({ offset: 20 }).setHTML(
                `<div style="font-size:14px">
                   <b>${user.name || "Uživatel"}</b><br/>
                   ${offline ? "offline" : "online"} • ${timeAgo(user.lastActive)}
                 </div>`
              )
            )
            .addTo(mapRef.current);

          // pro jistotu: toggle popup na tap
          marker.getElement().addEventListener("click", () => {
            marker.togglePopup();
          });

          others.current[id] = marker;
        } else {
          others.current[id].setLngLat([user.lng, user.lat]);
          const el = others.current[id].getElement();
          if (!user.photoURL) el.style.background = offline ? "#bdbdbd" : "#3498db";
        }
      });

      // remove deleted
      Object.keys(others.current).forEach((id) => {
        if (!data[id]) {
          others.current[id].remove();
          delete others.current[id];
        }
      });
    });

    return () => unsub();
  }, [uid, showOffline]);

  /* SIMPLE PINGS -> sound (hook) */
  useEffect(() => {
    if (!uid) return;
    const unsub = onValue(ref(db, `pings/${uid}`), (snap) => {
      if (!snap.exists()) return;
      if (soundOn) {
        ding.current.currentTime = 0;
        ding.current.play().catch(() => {});
      }
    });
    return () => unsub();
  }, [uid, soundOn]);

  /* save name */
  const saveName = async () => {
    localStorage.setItem("name", name);
    if (uid) {
      await update(ref(db, `users/${uid}`), {
        name: name || "Anonym",
        lastActive: Date.now(),
      });
    }
    alert("Jméno uloženo.");
  };

  /* photo upload */
  const fileRef = useRef(null);
  const uploadPhoto = async () => {
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) return alert("Vyber fotku.");
      setUploading(true);
      const path = `profiles/${uid}.jpg`;
      const r = sref(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      myPhotoURLRef.current = url;
      await update(ref(db, `users/${uid}`), {
        photoURL: url,
        lastActive: Date.now(),
      });
      // uprav rovnou i můj marker
      if (myMarkerRef.current) {
        const el = myMarkerRef.current.getElement();
        el.style.backgroundImage = `url("${url}")`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.style.border = "3px solid #e74c3c";
      }
      alert("Profilová fotka nahrána.");
    } catch (e) {
      console.error(e);
      alert("Nahrání se nepodařilo.");
    } finally {
      setUploading(false);
    }
  };

  const toggleSound = () => {
    const v = !soundOn;
    setSoundOn(v);
    localStorage.setItem("soundOn", String(v));
    if (v) {
      ding.current.currentTime = 0;
      ding.current.play().catch(() => {});
    }
  };
  const toggleOffline = () => {
    const v = !showOffline;
    setShowOffline(v);
    localStorage.setItem("showOffline", String(v));
  };

  return (
    <div style={{ width: "100vw", height: "100dvh", position: "relative" }}>
      <div id="map" style={{ width: "100%", height: "100%" }} />

      {/* CHAT FAB */}
      <div
        onClick={() => setChatsOpen(true)}
        title="Chaty"
        style={{
          position: "fixed",
          right: "calc(16px + env(safe-area-inset-right))",
          bottom: "calc(96px + env(safe-area-inset-bottom))",
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "#e11d48",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 10px 24px rgba(0,0,0,.25)",
          cursor: "pointer",
          zIndex: 50,
        }}
      >
        <span
          style={{
            display: "block",
            width: 28,
            height: 28,
            background:
              "url('https://icons.getbootstrap.com/assets/icons/chat-dots-fill.svg') center/contain no-repeat",
            filter: "invert(100%)",
          }}
        />
      </div>

      {/* SETTINGS FAB */}
      <div
        onClick={() => setSettingsOpen(true)}
        title="Nastavení"
        style={{
          position: "fixed",
          right: "calc(16px + env(safe-area-inset-right))",
          bottom: "calc(16px + env(safe-area-inset-bottom))",
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "#111827",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 10px 24px rgba(0,0,0,.25)",
          cursor: "pointer",
          zIndex: 50,
        }}
      >
        <span
          style={{
            display: "block",
            width: 30,
            height: 30,
            background:
              "url('https://icons.getbootstrap.com/assets/icons/gear-fill.svg') center/contain no-repeat",
            filter: "invert(100%)",
          }}
        />
      </div>

      {/* SETTINGS SHEET */}
      {settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.25)",
            zIndex: 60,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: "calc(16px + env(safe-area-inset-left))",
              right: "calc(16px + env(safe-area-inset-right))",
              bottom: "calc(16px + env(safe-area-inset-bottom))",
              background: "#fff",
              borderRadius: 16,
              padding: 16,
              maxHeight: "70vh",
              overflow: "auto",
              boxShadow: "0 16px 36px rgba(0,0,0,.3)",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Nastavení</h3>

            <label style={{ fontSize: 13, opacity: 0.7 }}>Jméno</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                }}
              />
              <button
                onClick={saveName}
                style={{
                  borderRadius: 10,
                  padding: "10px 14px",
                  background: "#111827",
                  color: "#fff",
                  border: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Uložit
              </button>
            </div>

            <label style={{ fontSize: 13, opacity: 0.7 }}>Profilová fotka</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input ref={fileRef} type="file" accept="image/*" style={{ flex: 1 }} />
              <button
                onClick={uploadPhoto}
                disabled={uploading}
                style={{
                  borderRadius: 10,
                  padding: "10px 14px",
                  background: uploading ? "#9ca3af" : "#111827",
                  color: "#fff",
                  border: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {uploading ? "Nahrávám…" : "Nahrát"}
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                onClick={toggleSound}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  padding: "10px 14px",
                  background: soundOn ? "#10b981" : "#111827",
                  color: "#fff",
                  border: "none",
                }}
              >
                {soundOn ? "🔊 Zvuk povolen" : "🔇 Povolit zvuk"}
              </button>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input type="checkbox" checked={showOffline} onChange={toggleOffline} />
              Zobrazit offline uživatele (šedě)
            </label>
          </div>
        </div>
      )}

      {/* CHATS SHEET (placeholder) */}
      {chatsOpen && (
        <div
          onClick={() => setChatsOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.25)",
            zIndex: 60,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: "calc(16px + env(safe-area-inset-left))",
              right: "calc(16px + env(safe-area-inset-right))",
              bottom: "calc(16px + env(safe-area-inset-bottom))",
              background: "#fff",
              borderRadius: 16,
              padding: 16,
              maxHeight: "70vh",
              overflow: "auto",
              boxShadow: "0 16px 36px rgba(0,0,0,.3)",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Chaty</h3>
            <div style={{ color: "#6b7280" }}>Zatím žádné konverzace.</div>
          </div>
        </div>
      )}
    </div>
  );
}
