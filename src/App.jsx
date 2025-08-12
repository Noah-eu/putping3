// App.jsx
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
  onDisconnect,
  query,
  orderByChild,
  equalTo,
  get,
  push,
  remove,
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";

/* ---------- KONFIG ---------- */
// Vlož svůj Mapbox token:
const MAPBOX_TOKEN = "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";
mapboxgl.accessToken = MAPBOX_TOKEN;

// Tvůj Firebase config (ponech ten, co už používáš)
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

/* ---------- TRVALÉ ID ZAŘÍZENÍ (kvůli úklidu „duchů“) ---------- */
const deviceId = (() => {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    id = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
    localStorage.setItem("deviceId", id);
  }
  return id;
})();

/* ---------- POMOC ---------- */
const timeAgo = (ts) => {
  if (!ts) return "neznámo";
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000)); // s
  if (diff < 60) return `před ${diff}s`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.floor(h / 24);
  return `před ${d} dny`;
};

export default function App() {
  const mapRef = useRef(null);
  const selfMarkerRef = useRef(null);
  const markersById = useRef({});
  const [uid, setUid] = useState(null);
  const [name, setName] = useState(localStorage.getItem("name") || "Anonym");
  const [photoURL, setPhotoURL] = useState(localStorage.getItem("photoURL") || "");
  const [soundOn, setSoundOn] = useState(localStorage.getItem("soundOn") === "true");
  const [showOffline, setShowOffline] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [uploadPct, setUploadPct] = useState(null);
  const pingAudio = useRef(new Audio("https://assets.mixkit.co/active_storage/sfx/2560/2560-preview.mp3"));

  /* ---------- AUTH ---------- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
      else signInAnonymously(auth);
    });
    return () => unsub();
  }, []);

  /* ---------- MAPA ---------- */
  useEffect(() => {
    if (mapRef.current) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const map = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v11",
          center: [longitude, latitude],
          zoom: 15,
        });
        mapRef.current = map;

        // vlastní marker (červený okraj)
        const meEl = document.createElement("div");
        meEl.style.width = "28px";
        meEl.style.height = "28px";
        meEl.style.borderRadius = "999px";
        meEl.style.border = "4px solid #e74c3c";
        meEl.style.background = "#bbb";
        meEl.style.boxShadow = "0 0 0 2px rgba(0,0,0,.15)";
        selfMarkerRef.current = new mapboxgl.Marker(meEl)
          .setLngLat([longitude, latitude])
          .addTo(map);
      },
      () => {
        // fallback na Prahu
        const map = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v11",
          center: [14.42076, 50.08804],
          zoom: 12,
        });
        mapRef.current = map;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  /* ---------- ZÁZNAM „JSEM ONLINE“ + ÚKLID STARÝCH ---------- */
  useEffect(() => {
    if (!uid || !mapRef.current) return;

    const writeMe = async () => {
      // vezmeme pozici z mapy (center) – stačí
      const { lng, lat } = mapRef.current.getCenter();
      const meRef = ref(db, `users/${uid}`);
      await set(meRef, {
        name,
        lat,
        lng,
        lastActive: Date.now(),
        photoURL: photoURL || "",
        deviceId,
      });
      onDisconnect(meRef).remove();

      // ÚKLID starých záznamů ze stejného zařízení (jiné uid)
      const q = query(ref(db, "users"), orderByChild("deviceId"), equalTo(deviceId));
      const snap = await get(q);
      snap.forEach((child) => {
        if (child.key !== uid) remove(ref(db, `users/${child.key}`));
      });
    };

    writeMe();

    // průběžný refresh „lastActive“ + poloha dle mapy
    const int = setInterval(() => {
      const { lng, lat } = mapRef.current.getCenter();
      update(ref(db, `users/${uid}`), {
        name,
        lat,
        lng,
        lastActive: Date.now(),
        photoURL: photoURL || "",
        deviceId,
      });
      // posuň náš lokální marker
      if (selfMarkerRef.current) {
        selfMarkerRef.current.setLngLat([lng, lat]);
      }
    }, 15000);

    return () => clearInterval(int);
  }, [uid, name, photoURL]);

  /* ---------- POSLOUCHÁNÍ UŽIVATELŮ & MARKERY ---------- */
  useEffect(() => {
    if (!mapRef.current || !uid) return;

    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};

      // smaž markery co už nejsou
      Object.keys(markersById.current).forEach((id) => {
        if (!data[id]) {
          markersById.current[id].remove();
          delete markersById.current[id];
        }
      });

      Object.entries(data).forEach(([id, u]) => {
        // skryj moje staré záznamy (stejné deviceId, jiné uid)
        if (u.deviceId === deviceId && id !== uid) return;

        // offline filtr
        const isOffline = Date.now() - (u.lastActive || 0) > 60 * 1000;
        if (isOffline && !showOffline) {
          if (markersById.current[id]) {
            markersById.current[id].remove();
            delete markersById.current[id];
          }
          return;
        }

        const el = document.createElement("div");
        el.style.width = "42px";
        el.style.height = "42px";
        el.style.borderRadius = "999px";
        el.style.overflow = "hidden";
        el.style.boxShadow = "0 2px 8px rgba(0,0,0,.25)";
        el.style.border = id === uid ? "3px solid #e74c3c" : "3px solid #fff";
        el.style.background = isOffline ? "#9aa0a6" : "#ffffff";

        if (u.photoURL) {
          const img = document.createElement("img");
          img.src = u.photoURL;
          img.style.width = "100%";
          img.style.height = "100%";
          img.style.objectFit = "cover";
          img.style.filter = isOffline ? "grayscale(1) brightness(.8)" : "none";
          el.appendChild(img);
        }

        const popupEl = document.createElement("div");
        popupEl.style.minWidth = "140px";
        popupEl.style.fontSize = "14px";
        popupEl.innerHTML = `
          <div style="display:flex;align-items:center;gap:8px;">
            ${u.photoURL ? `<img src="${u.photoURL}" style="width:28px;height:28px;border-radius:999px;object-fit:cover;" />` : ""}
            <div style="font-weight:600">${u.name || "Anonym"}</div>
          </div>
          <div style="margin-top:6px;color:#666">${isOffline ? "offline • " : ""}${timeAgo(u.lastActive)}</div>
          <div style="margin-top:8px;display:flex;gap:8px;">
            <button id="pp-ping" style="flex:1;padding:6px 10px;border-radius:10px;border:none;background:#ff4757;color:white">Ping</button>
            <button id="pp-chat" style="flex:1;padding:6px 10px;border-radius:10px;border:none;background:#2d3436;color:white">Chat</button>
          </div>
        `;

        const popup = new mapboxgl.Popup({ offset: 12 }).setDOMContent(popupEl);
        popup.on("open", () => {
          popupEl.querySelector("#pp-ping")?.addEventListener("click", () => sendPing(id));
          popupEl.querySelector("#pp-chat")?.addEventListener("click", () => openChat(id, u.name || "Anonym"));
        });

        if (!markersById.current[id]) {
          markersById.current[id] = new mapboxgl.Marker(el).setLngLat([u.lng, u.lat]).setPopup(popup).addTo(mapRef.current);
        } else {
          markersById.current[id].setLngLat([u.lng, u.lat]).setPopup(popup);
        }
      });
    });

    return () => unsub();
  }, [uid, showOffline]);

  /* ---------- PING & CHAT ---------- */
  const sendPing = async (targetId) => {
    await set(ref(db, `pings/${targetId}`), { from: name, time: Date.now() });
  };

  const openChat = async (targetId, targetName = "uživatel") => {
    const text = prompt(`Zpráva pro ${targetName}:`);
    if (!text) return;
    const convId = [uid, targetId].sort().join("_");
    await push(ref(db, `messages/${convId}`), {
      from: uid,
      name,
      text,
      time: Date.now(),
    });
  };

  // poslouchání pingů & zpráv (pípnutí)
  useEffect(() => {
    if (!uid) return;

    const pingRef = ref(db, `pings/${uid}`);
    const unsubPing = onValue(pingRef, (s) => {
      if (!s.exists()) return;
      remove(pingRef);
      if (soundOn) pingAudio.current?.play().catch(() => {});
      alert("📩 Ping!");
    });

    // poslouchej zprávy ve všech mých konverzacích
    const convsRef = ref(db, "messages");
    const unsubMsg = onValue(convsRef, (s) => {
      const all = s.val() || {};
      const myConvs = Object.entries(all).filter(([cid]) => cid.includes(uid));
      if (!myConvs.length) return;
      // najdi poslední zprávu
      let last = null;
      myConvs.forEach(([, msgs]) => {
        Object.values(msgs).forEach((m) => {
          if (!last || m.time > last.time) last = m;
        });
      });
      if (last && last.from !== uid) {
        if (soundOn) pingAudio.current?.play().catch(() => {});
        // malé toast-like
        console.log("Nová zpráva:", last.text);
      }
    });

    return () => {
      unsubPing();
      unsubMsg();
    };
  }, [uid, soundOn]);

  /* ---------- UPLOAD FOTKY ---------- */
  const onPickPhoto = (e) => {
    const f = e.target.files?.[0];
    if (!f || !uid) return;
    const path = `avatars/${uid}.jpg`;
    const task = uploadBytesResumable(sref(storage, path), f, { contentType: f.type || "image/jpeg" });

    setUploadPct(0);
    task.on(
      "state_changed",
      (snap) => {
        const p = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        setUploadPct(p);
      },
      (err) => {
        alert("Nahrávání fotky selhalo: " + err.message);
        setUploadPct(null);
      },
      async () => {
        const url = await getDownloadURL(sref(storage, path));
        setPhotoURL(url);
        localStorage.setItem("photoURL", url);
        await update(ref(db, `users/${uid}`), { photoURL: url });
        setUploadPct(null);
      }
    );
  };

  /* ---------- UI ---------- */
  const saveName = async () => {
    localStorage.setItem("name", name);
    await update(ref(db, `users/${uid}`), { name });
  };
  const toggleSound = () => {
    const v = !soundOn;
    setSoundOn(v);
    localStorage.setItem("soundOn", String(v));
  };

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <div id="map" style={{ width: "100%", height: "100%" }} />

      {/* FAB – Chaty (placeholder) */}
      <button
        aria-label="Chaty"
        onClick={() => alert("Seznam chatů bude tady 🙂")}
        style={{
          position: "fixed",
          right: 16,
          bottom: 108,
          width: 72,
          height: 72,
          borderRadius: 999,
          border: "none",
          background: "#e74c3c",
          color: "#fff",
          fontSize: 24,
          boxShadow: "0 10px 20px rgba(0,0,0,.25)",
        }}
      >
        💬
      </button>

      {/* FAB – Nastavení */}
      <button
        aria-label="Nastavení"
        onClick={() => setShowSettings(true)}
        style={{
          position: "fixed",
          right: 16,
          bottom: 24,
          width: 72,
          height: 72,
          borderRadius: 999,
          border: "none",
          background: "#111827",
          color: "#fff",
          fontSize: 28,
          boxShadow: "0 10px 20px rgba(0,0,0,.25)",
        }}
      >
        ⚙️
      </button>

      {/* MODAL Nastavení */}
      {showSettings && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setShowSettings(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 520,
              background: "#fff",
              borderRadius: 16,
              padding: 18,
              boxShadow: "0 10px 30px rgba(0,0,0,.3)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>Nastavení</h2>
              <button onClick={() => setShowSettings(false)} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "#111827", color: "#fff" }}>
                Zavřít
              </button>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontWeight: 600 }}>Jméno</label>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb" }}
                />
                <button onClick={saveName} style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "#0ea5e9", color: "#fff" }}>
                  Uložit
                </button>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ fontWeight: 600, display: "block", marginBottom: 6 }}>Profilová fotka</label>
              <input type="file" accept="image/*" onChange={onPickPhoto} />
              {uploadPct !== null && (
                <div style={{ marginTop: 6, fontSize: 13, color: "#6b7280" }}>Nahrávám… {uploadPct}%</div>
              )}
            </div>

            <div style={{ marginTop: 14, display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={toggleSound}
                style={{
                  flex: 1,
                  padding: "12px 14px",
                  borderRadius: 12,
                  border: "none",
                  background: soundOn ? "#10b981" : "#111827",
                  color: "#fff",
                }}
              >
                {soundOn ? "🔊 Zvuk povolen" : "🔇 Zvuk zakázán"}
              </button>
              <button
                onClick={() => pingAudio.current?.play().catch(() => alert("Prohlížeč odmítl přehrát zvuk – klepni znovu."))}
                style={{ padding: "12px 16px", borderRadius: 12, border: "none", background: "#6b7280", color: "#fff" }}
              >
                Test
              </button>
            </div>

            <label style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14 }}>
              <input type="checkbox" checked={showOffline} onChange={(e) => setShowOffline(e.target.checked)} />
              Zobrazit offline uživatele (šedě)
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
