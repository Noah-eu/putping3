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
const timeAgo = (ts) => {
  if (!ts) return "neznámo";
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `před ${diff} s`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `před ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `před ${h} h`;
  return `před ${Math.floor(h / 24)} dny`;
};

/* WebAudio beep */
function makeBeep() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  return () =>
    new Promise((resolve, reject) => {
      try {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.2);
        o.onended = resolve;
      } catch (e) {
        reject(e);
      }
    });
}
const playBeep = makeBeep();

/* zmenšení fotky */
async function downscaleImage(file) {
  const bitmap = await createImageBitmap(file);
  const maxSide = 512;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((res) => canvas.toBlob((b) => res(b), "image/jpeg", 0.8));
}

export default function App() {
  // per-device id (kvůli "šedému já")
  const [deviceId] = useState(() => {
    const ex = localStorage.getItem("deviceId");
    if (ex) return ex;
    const id = "dev_" + Math.random().toString(36).slice(2);
    localStorage.setItem("deviceId", id);
    return id;
  });

  const [uid, setUid] = useState(localStorage.getItem("uid") || "");
  const [name, setName] = useState(localStorage.getItem("name") || "Anonym");
  const [soundOn, setSoundOn] = useState(localStorage.getItem("soundOn") === "true");
  const [showOffline, setShowOffline] = useState(localStorage.getItem("showOffline") !== "false");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState("");
  const [photoURL, setPhotoURL] = useState("");

  const mapRef = useRef(null);
  const myMarkerRef = useRef(null);
  const myPopupRef = useRef(null);
  const others = useRef({}); // id -> Marker
  const fileRef = useRef(null);

  const showToast = (t) => {
    setToast(t);
    window.clearTimeout((showToast).tid);
    (showToast).tid = window.setTimeout(() => setToast(""), 1800);
  };

  /* auth */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUid(u.uid);
        localStorage.setItem("uid", u.uid);
        // uložit deviceId do profilu
        update(ref(db, `users/${u.uid}`), { deviceId, lastActive: Date.now() }).catch(() => {});
        // kdyby tu náhodou byl marker "others" se stejným id, smažeme
        if (others.current[u.uid]) {
          others.current[u.uid].remove();
          delete others.current[u.uid];
        }
      }
    });
    if (!auth.currentUser) signInAnonymously(auth).catch(() => {});
    return () => unsub();
  }, [deviceId]);

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
    const onKey = (e) => e.key === "Escape" && (setSettingsOpen(false), setChatsOpen(false));
    window.addEventListener("keydown", onKey);
    mapRef.current = map;
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* poslouchám svůj profil – kvůli photoURL */
  useEffect(() => {
    if (!uid) return;
    const unsub = onValue(ref(db, `users/${uid}`), (s) => {
      const me = s.val() || {};
      if (me.photoURL) setPhotoURL(me.photoURL);
    });
    return () => unsub();
  }, [uid]);

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
      if (photoURL) el.style.backgroundImage = `url("${photoURL}")`;
      const m = new mapboxgl.Marker({ element: el });
      const p = new mapboxgl.Popup({ offset: 18 }).setHTML(`<b>${name}</b>`);
      myPopupRef.current = p;
      myMarkerRef.current = m.setPopup(p);
    };

    const updMyPhoto = () => {
      if (!myMarkerRef.current) return;
      const el = myMarkerRef.current.getElement();
      if (photoURL) {
        el.style.backgroundImage = `url("${photoURL}")`;
        el.style.backgroundSize = "cover";
        el.style.backgroundPosition = "center";
      } else {
        el.style.backgroundImage = "";
      }
    };

    const onPos = async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      ensureMyMarker();
      updMyPhoto();
      myMarkerRef.current.setLngLat([lng, lat]).addTo(mapRef.current);
      myPopupRef.current?.setHTML(`<b>${name || "Anonym"}</b>`);
      await update(ref(db, `users/${uid}`), {
        name: name || "Anonym",
        lat,
        lng,
        lastActive: Date.now(),
        deviceId,
        photoURL: photoURL || null,
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
  }, [uid, name, photoURL, deviceId]);

  /* others + anti-ghost (deviceId) */
  useEffect(() => {
    if (!mapRef.current) return;
    const TTL = 5 * 60 * 1000;

    const unsub = onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      const now = Date.now();

      Object.entries(data).forEach(([id, u]) => {
        if (!u || !u.lat || !u.lng) return;

        // nikdy nezobrazuj kohokoli ze stejného zařízení (zabije „šedého mě“)
        if (u.deviceId && u.deviceId === deviceId) {
          if (others.current[id]) {
            others.current[id].remove();
            delete others.current[id];
          }
          return;
        }

        if (id === uid) {
          // pro jistotu – sebe mezi others nechci
          if (others.current[id]) {
            others.current[id].remove();
            delete others.current[id];
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

        const buildEl = () => {
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
          const marker = new mapboxgl.Marker({ element: buildEl() })
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

      // odstraň, co v DB není
      Object.keys(others.current).forEach((id) => {
        if (!data[id] || id === uid) {
          others.current[id].remove();
          delete others.current[id];
        }
      });
    });

    return () => unsub();
  }, [uid, showOffline, deviceId]);

  /* pings -> beep (zatím demo) */
  useEffect(() => {
    if (!uid) return;
    const unsub = onValue(ref(db, `pings/${uid}`), (snap) => {
      if (!snap.exists()) return;
      if (soundOn) playBeep().catch(() => {});
    });
    return () => unsub();
  }, [uid, soundOn]);

  /* actions */
  const saveName = async () => {
    localStorage.setItem("name", name);
    if (uid) await update(ref(db, `users/${uid}`), { name: name || "Anonym", lastActive: Date.now(), deviceId }).catch(()=>{});
    showToast("Jméno uloženo");
  };

  const uploadPhoto = async () => {
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) return showToast("Vyber fotku");
      setUploading(true);

      const blob = await downscaleImage(file);
      const r = sref(storage, `profiles/${uid}.jpg`);
      await uploadBytes(r, blob, { contentType: "image/jpeg" });
      const url = await getDownloadURL(r);

      setPhotoURL(url); // okamžitě do UI
      await update(ref(db, `users/${uid}`), { photoURL: url, lastActive: Date.now(), deviceId });

      // vyčistit výběr
      fileRef.current.value = "";
      showToast("Fotka nahrána");
    } catch (e) {
      console.error(e);
      alert("Nahrání fotky selhalo: " + (e?.message || e));
      showToast("Nahrání selhalo");
    } finally {
      setUploading(false);
    }
  };

  const enableSound = async () => {
    try {
      await playBeep();
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
    playBeep()
      .then(() => showToast("Píp!"))
      .catch(() => alert("Prohlížeč odmítl přehrát zvuk – zkuste klepnout znovu."));
  };

  const toggleOffline = () => {
    const v = !showOffline;
    setShowOffline(v);
    localStorage.setItem("showOffline", String(v));
    // nic „moje“ se kvůli deviceId stejně neukáže, ale pro jistotu smažu cokoliv s mým uid
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

      {/* SETTINGS */}
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
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <input ref={fileRef} type="file" accept="image/*" style={{ flex: 1 }} />
                {photoURL ? (
                  <img
                    src={photoURL}
                    alt="náhled"
                    style={{ width: 44, height: 44, borderRadius: "50%", objectFit: "cover", border: "1px solid #eee" }}
                  />
                ) : (
                  <div style={{ width: 44, height: 44, borderRadius: "50%", background: "#eee", border: "1px solid #ddd" }} />
                )}
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 10, margin: "10px 0 80px 0" }}>
                <input type="checkbox" checked={showOffline} onChange={toggleOffline} />
                Zobrazit offline uživatele (šedě)
              </label>
            </div>

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
                  background: uploading ? "#9ca3af" : "#0f172a",
                  color: "#fff",
                  border: "none",
                }}
              >
                {uploading ? "Nahrávám…" : "Nahrát fotku"}
              </button>

              <button
                onClick={async () => {
                  try {
                    await playBeep();
                    setSoundOn(true);
                    localStorage.setItem("soundOn", "true");
                    showToast("Zvuk povolen");
                  } catch {
                    setSoundOn(false);
                    localStorage.setItem("soundOn", "false");
                    alert("Prohlížeč odmítl přehrát zvuk – zkuste klepnout znovu.");
                  }
                }}
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
                onClick={() =>
                  playBeep()
                    .then(() => showToast("Píp!"))
                    .catch(() => alert("Prohlížeč odmítl přehrát zvuk – zkuste klepnout znovu."))
                }
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
