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
  remove,
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

/* ====== Mapbox + Firebase ====== */
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

/* ===== helpers ===== */
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

/* ===== component ===== */
export default function App() {
  const [uid, setUid] = useState(localStorage.getItem("uid") || "");
  const [name, setName] = useState(localStorage.getItem("name") || "Anonym");
  const [soundOn, setSoundOn] = useState(localStorage.getItem("soundOn") === "true");
  const [showOffline, setShowOffline] = useState(localStorage.getItem("showOffline") !== "false");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  const ding = useRef(new Audio("https://cdn.pixabay.com/download/audio/2022/03/15/audio_0e4e4b7f05.mp3?filename=click-124467.mp3"));

  const mapRef = useRef(null);
  const myMarkerRef = useRef(null);
  const myPopupRef = useRef(null);
  const myPhotoURLRef = useRef("");
  const others = useRef({}); // id -> mapboxgl.Marker

  /* AUTH */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (u) {
        setUid(u.uid);
        localStorage.setItem("uid", u.uid);
        // při startu smaž případný starý ghost vlastníka v "others"
        if (others.current[u.uid]) {
          others.current[u.uid].remove();
          delete others.current[u.uid];
        }
        // jemné pročištění staré vlastní stopy (pokud by existovala z dřívějška a byla šedá)
        await update(ref(db, `users/${u.uid}`), { lastActive: Date.now() }).catch(() => {});
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

  /* MOJE POLOHA – ŘÍZENÁ JEN GEOLOKACÍ */
  useEffect(() => {
    if (!uid || !mapRef.current) return;

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

    const onPos = async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      ensureMyMarker();
      myMarkerRef.current.setLngLat([lng, lat]).addTo(mapRef.current);
      myPopupRef.current?.setHTML(`<b>${name || "Anonym"}</b>`);
      await update(ref(db, `users/${uid}`), {
        name: name || "Anonym",
        lat,
        lng,
        lastActive: Date.now(),
        photoURL: myPhotoURLRef.current || null,
      }).catch(() => {});
    };

    const onErr = () => {};

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

  /* OSTATNÍ UŽIVATELÉ */
  useEffect(() => {
    if (!mapRef.current) return;
    const TTL = 5 * 60 * 1000;

    const unsub = onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      const now = Date.now();

      // CREATE/UPDATE
      Object.entries(data).forEach(([id, user]) => {
        if (!user || !user.lat || !user.lng) return;

        // nikdy nepřidávej vlastníka do "others"
        if (id === uid) {
          // kdyby tu z dřívějška ghost byl, smaž
          if (others.current[id]) {
            others.current[id].remove();
            delete others.current[id];
          }
          // a aktualizuj můj marker vzhledem k fotce
          if (user.photoURL && myMarkerRef.current) {
            if (myPhotoURLRef.current !== user.photoURL) {
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
              filter: offline ? "grayscale(100%)" : "none",
              opacity: offline ? "0.8" : "1",
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

          marker.getElement().addEventListener("click", () => marker.togglePopup());
          others.current[id] = marker;
        } else {
          others.current[id].setLngLat([user.lng, user.lat]);
        }
      });

      // REMOVE
      Object.keys(others.current).forEach((id) => {
        if (!data[id] || id === uid) {
          others.current[id].remove();
          delete others.current[id];
        }
      });
    });
    return () => unsub();
  }, [uid, showOffline]);

  /* PINGS -> zvuk (zatím jen test) */
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

  /* Handlery */
  const saveName = async () => {
    localStorage.setItem("name", name);
    if (uid) await update(ref(db, `users/${uid}`), { name: name || "Anonym", lastActive: Date.now() }).catch(()=>{});
    alert("Jméno uloženo.");
  };

  const fileRef = useRef(null);
  const uploadPhoto = async () => {
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) return alert("Vyber fotku.");
      setUploading(true);
      const r = sref(storage, `profiles/${uid}.jpg`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      myPhotoURLRef.current = url;
      await update(ref(db, `users/${uid}`), { photoURL: url, lastActive: Date.now() });

      // okamžitý repaint mého markeru
      if (myMarkerRef.current) {
        const el = myMarkerRef.current.getElement();
        el.style.backgroundImage = `url("${url}")`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
        el.style.border = "3px solid #e74c3c";
        el.style.boxShadow = "0 0 0 3px rgba(231,76,60,.25)";
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
  };

  const testSound = () => {
    ding.current.currentTime = 0;
    ding.current.play().catch(() => alert("Prohlížeč odmítl přehrát zvuk – zkuste klepnout znovu."));
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
              top: "calc(16px + env(safe-area-inset-top))",
              background: "#fff",
              borderRadius: 16,
              padding: 16,
              display: "flex",
              flexDirection: "column",
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
              <button
                onClick={testSound}
                style={{
                  borderRadius: 10,
                  padding: "10px 14px",
                  background: "#374151",
                  color: "#fff",
                  border: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Test zvuku
              </button>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
              <input type="checkbox" checked={showOffline} onChange={toggleOffline} />
              Zobrazit offline uživatele (šedě)
            </label>

            {/* spacer aby poslední tlačítka nebyla pod okrajem */}
            <div style={{ paddingBottom: "calc(24px + env(safe-area-inset-bottom))" }} />
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
              top: "calc(16px + env(safe-area-inset-top))",
              background: "#fff",
              borderRadius: 16,
              padding: 16,
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
