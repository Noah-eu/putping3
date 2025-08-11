import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getDatabase, ref, update, onValue } from "firebase/database";
import { getStorage, ref as sref, uploadBytes, getDownloadURL } from "firebase/storage";

/* ===== Mapbox + Firebase ===== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X",
};
/* ============================ */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

/* helpers */
function timeAgo(ts) {
  if (!ts) return "neznámo";
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `před ${diff} s`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `před ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `před ${h} h`;
  return `před ${Math.floor(h / 24)} dny`;
}

export default function App() {
  const [uid, setUid] = useState(localStorage.getItem("uid") || "");
  const [name, setName] = useState(localStorage.getItem("name") || "Anonym");
  const [soundOn, setSoundOn] = useState(localStorage.getItem("soundOn") === "true");
  const [showOffline, setShowOffline] = useState(localStorage.getItem("showOffline") !== "false");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState("");

  const mapRef = useRef(null);
  const myMarkerRef = useRef(null);
  const myPopupRef = useRef(null);
  const myPhotoURLRef = useRef("");
  const others = useRef({}); // id -> Marker

  const fileRef = useRef(null);
  const ding = useRef(new Audio("https://cdn.jsdelivr.net/gh/napars/tones@main/click.mp3"));

  const showToast = (t) => {
    setToast(t);
    setTimeout(() => setToast(""), 1800);
  };

  /* auth */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUid(u.uid);
        localStorage.setItem("uid", u.uid);
        // jistota: nikdy neuchovávat „others“ marker pro sebe
        if (others.current[u.uid]) {
          others.current[u.uid].remove();
          delete others.current[u.uid];
        }
        update(ref(db, `users/${u.uid}`), { lastActive: Date.now() }).catch(() => {});
      }
    });
    if (!auth.currentUser) signInAnonymously(auth).catch(() => {});
    return () => unsub();
  }, []);

  /* map init */
  useEffect(() => {
    if (mapRef.current) return;
    const map = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.42076, 50.08804],
      zoom: 6,
    });
    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    map.on("click", () => {
      setSettingsOpen(false);
      setChatsOpen(false);
    });
    mapRef.current = map;

    const onKey = (e) => e.key === "Escape" && (setSettingsOpen(false), setChatsOpen(false));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* my location */
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
        border: "4px solid #e11d48",
        boxShadow: "0 0 0 3px rgba(225,17,72,.25)",
        backgroundSize: "cover",
        backgroundPosition: "center",
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

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          mapRef.current.jumpTo({ center: [lng, lat], zoom: 14 });
          onPos(pos);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );
      const id = navigator.geolocation.watchPosition(onPos, () => {}, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000,
      });
      return () => navigator.geolocation.clearWatch(id);
    }
  }, [uid, name]);

  /* others */
  useEffect(() => {
    if (!mapRef.current) return;
    const TTL = 5 * 60 * 1000;

    const unsub = onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      const now = Date.now();

      // jistota proti self-ghost: vždy odstranit případný others marker s mým uid
      if (uid && others.current[uid]) {
        others.current[uid].remove();
        delete others.current[uid];
      }

      Object.entries(data).forEach(([id, u]) => {
        if (!u || !u.lat || !u.lng) return;

        if (id === uid) {
          // refresh mé fotky
          if (u.photoURL && myMarkerRef.current) {
            if (u.photoURL !== myPhotoURLRef.current) {
              myPhotoURLRef.current = u.photoURL;
              const el = myMarkerRef.current.getElement();
              el.style.backgroundImage = `url("${u.photoURL}")`;
            }
          }
          return;
        }

        const offline = now - (u.lastActive || 0) > TTL;
        if (!showOffline && offline) {
          if (others.current[id]) {
            others.current[id].remove();
            delete others.current[id];
          }
          return;
        }

        const makeEl = () => {
          const el = document.createElement("div");
          if (u.photoURL) {
            Object.assign(el.style, {
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              backgroundImage: `url("${u.photoURL}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              border: "3px solid #fff",
              boxShadow: "0 0 0 3px rgba(0,0,0,.15)",
              filter: offline ? "grayscale(100%)" : "none",
              opacity: offline ? "0.85" : "1",
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
          const marker = new mapboxgl.Marker({ element: makeEl() })
            .setLngLat([u.lng, u.lat])
            .setPopup(
              new mapboxgl.Popup({ offset: 20 }).setHTML(
                `<div style="font-size:14px">
                   <b>${u.name || "Uživatel"}</b><br/>
                   ${offline ? "offline" : "online"} • ${timeAgo(u.lastActive)}
                 </div>`
              )
            )
            .addTo(mapRef.current);
          marker.getElement().addEventListener("click", () => marker.togglePopup());
          others.current[id] = marker;
        } else {
          others.current[id].setLngLat([u.lng, u.lat]);
        }
      });

      Object.keys(others.current).forEach((id) => {
        if (!data[id] || id === uid) {
          others.current[id].remove();
          delete others.current[id];
        }
      });
    });
    return () => unsub();
  }, [uid, showOffline]);

  /* pings -> ding (zatím jen test) */
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

  /* actions */
  const saveName = async () => {
    localStorage.setItem("name", name);
    if (uid) await update(ref(db, `users/${uid}`), { name: name || "Anonym", lastActive: Date.now() }).catch(()=>{});
    showToast("Jméno uloženo");
  };

  const uploadPhoto = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return showToast("Vyber fotku");
    try {
      setUploading(true);
      const r = sref(storage, `profiles/${uid}.jpg`);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      myPhotoURLRef.current = url;
      await update(ref(db, `users/${uid}`), { photoURL: url, lastActive: Date.now() });
      if (myMarkerRef.current) {
        const el = myMarkerRef.current.getElement();
        el.style.backgroundImage = `url("${url}")`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
      }
      showToast("Fotka nahrána");
    } catch (e) {
      console.error(e);
      showToast("Nahrání selhalo");
    } finally {
      setUploading(false);
    }
  };

  const enableSound = async () => {
    try {
      ding.current.currentTime = 0;
      await ding.current.play(); // odemčení během kliknutí
      setSoundOn(true);
      localStorage.setItem("soundOn", "true");
      showToast("Zvuk povolen");
    } catch {
      setSoundOn(false);
      localStorage.setItem("soundOn", "false");
      alert("Prohlížeč odmítl přehrát zvuk – zkuste klepnout znovu.");
    }
  };

  const testSound = () => {
    ding.current.currentTime = 0;
    ding.current
      .play()
      .then(() => showToast("Připraveno"))
      .catch(() => alert("Prohlížeč odmítl přehrát zvuk – zkuste klepnout znovu."));
  };

  const toggleOffline = () => {
    const v = !showOffline;
    setShowOffline(v);
    localStorage.setItem("showOffline", String(v));
    if (uid && others.current[uid]) {
      others.current[uid].remove();
      delete others.current[uid];
    }
  };

  return (
    <div style={{ width: "100vw", height: "100dvh", position: "relative" }}>
      <div id="map" style={{ width: "100%", height: "100%" }} />

      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: "calc(90px + env(safe-area-inset-bottom))",
            background: "#111827",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: 999,
            fontSize: 14,
            zIndex: 70,
          }}
        >
          {toast}
        </div>
      )}

      {/* Chat FAB */}
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

      {/* Settings FAB */}
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

      {/* SETTINGS drawer */}
      {settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.25)", zIndex: 60 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: "calc(12px + env(safe-area-inset-left))",
              right: "calc(12px + env(safe-area-inset-right))",
              bottom: "calc(12px + env(safe-area-inset-bottom))",
              top: "calc(12px + env(safe-area-inset-top))",
              background: "#fff",
              borderRadius: 16,
              display: "flex",
              flexDirection: "column",
              maxHeight: "calc(100dvh - 24px)",
              boxShadow: "0 16px 36px rgba(0,0,0,.3)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: 16, display: "flex", alignItems: "center", borderBottom: "1px solid #eee" }}>
              <h3 style={{ margin: 0, flex: 1 }}>Nastavení</h3>
              <button
                onClick={() => setSettingsOpen(false)}
                style={{ border: "none", background: "#111827", color: "#fff", borderRadius: 10, padding: "8px 12px" }}
              >
                Zavřít
              </button>
            </div>

            <div style={{ padding: "16px", overflow: "auto" }}>
              <label style={{ fontSize: 13, opacity: 0.7 }}>Jméno</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb" }}
                />
                <button
                  onClick={saveName}
                  style={{ borderRadius: 10, padding: "10px 14px", background: "#111827", color: "#fff", border: "none" }}
                >
                  Uložit
                </button>
              </div>

              <label style={{ fontSize: 13, opacity: 0.7 }}>Profilová fotka</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <input ref={fileRef} type="file" accept="image/*" style={{ flex: 1 }} />
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0 80px 0" }}>
                <input type="checkbox" checked={showOffline} onChange={toggleOffline} />
                Zobrazit offline uživatele (šedě)
              </label>
            </div>

            {/* sticky spodní lišta – nic se neschová */}
            <div
              style={{
                padding: 12,
                borderTop: "1px solid #eee",
                display: "flex",
                gap: 8,
                background: "#fff",
              }}
            >
              <button
                onClick={uploadPhoto}
                disabled={uploading}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  padding: "12px 14px",
                  background: uploading ? "#9ca3af" : "#111827",
                  color: "#fff",
                  border: "none",
                }}
              >
                {uploading ? "Nahrávám…" : "Nahrát fotku"}
              </button>

              <button
                onClick={enableSound}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  padding: "12px 14px",
                  background: soundOn ? "#10b981" : "#374151",
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
                  padding: "12px 14px",
                  background: "#6b7280",
                  color: "#fff",
                  border: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Test
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHATS placeholder */}
      {chatsOpen && (
        <div
          onClick={() => setChatsOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.25)", zIndex: 60 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: "calc(12px + env(safe-area-inset-left))",
              right: "calc(12px + env(safe-area-inset-right))",
              bottom: "calc(12px + env(safe-area-inset-bottom))",
              top: "calc(12px + env(safe-area-inset-top))",
              background: "#fff",
              borderRadius: 16,
              padding: 16,
              overflow: "auto",
              boxShadow: "0 16px 36px rgba(0,0,0,.3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0, flex: 1 }}>Chaty</h3>
              <button
                onClick={() => setChatsOpen(false)}
                style={{ border: "none", background: "#111827", color: "#fff", borderRadius: 10, padding: "8px 12px" }}
              >
                Zavřít
              </button>
            </div>
            <div style={{ color: "#6b7280" }}>Zatím žádné konverzace.</div>
          </div>
        </div>
      )}
    </div>
  );
}
