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
  serverTimestamp,
  push,
  off,
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

/* =========================
   KONFIGURACE
========================= */
const MAPBOX_TOKEN = "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.firebasestorage.app",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const storage = getStorage(app);

mapboxgl.accessToken = MAPBOX_TOKEN;

/* =========================
   POMOCNÉ FUNKCE
========================= */
function timeAgo(ts) {
  if (!ts) return "neznámo";
  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - ts) / 1000)); // s
  if (diff < 60) return `před ${diff} s`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.floor(h / 24);
  return `před ${d} dny`;
}

function conversationId(a, b) {
  return [a, b].sort().join("_");
}

/* =========================
   KOMPONENTA
========================= */
export default function App() {
  const [uid, setUid] = useState(null);
  const [name, setName] = useState(localStorage.getItem("name") || "Anonymní uživatel");
  const [soundOn, setSoundOn] = useState(localStorage.getItem("soundOn") === "1");
  const [map, setMap] = useState(null);
  const [myPos, setMyPos] = useState(null);
  const [chatWith, setChatWith] = useState(null);         // uid uživatele v chatu
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(!localStorage.getItem("nameSaved")); // první spuštění otevře nastavení

  const markers = useRef({}); // uid -> { marker, popup }
  const pingAudio = useRef(new Audio("https://cdn.pixabay.com/download/audio/2021/09/16/audio_c5a8c2f3c2.mp3?filename=notification-1-126509.mp3"));

  // přihlášení
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
    });
    signInAnonymously(auth).catch(console.error);
    return () => unsub();
  }, []);

  // vytvoření mapy
  useEffect(() => {
    if (map) return;
    if (!document.getElementById("map")) return;

    const m = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.42076, 50.08804],
      zoom: 13,
    });
    setMap(m);

    return () => m.remove();
  }, [map]);

  // geolokace + zápis do DB
  useEffect(() => {
    if (!uid) return;

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        setMyPos([longitude, latitude]);

        // zapis uživatele (nezmizí po odpojení – offline se pozná podle lastActive)
        update(ref(db, `users/${uid}`), {
          name,
          lat: latitude,
          lng: longitude,
          lastActive: Date.now(),
        });
      },
      (err) => {
        console.warn("Geolocation error", err);
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [uid, name]);

  // posun mapy podle mojí polohy (jen jednou na začátku)
  useEffect(() => {
    if (map && myPos) {
      map.setCenter(myPos);
    }
  }, [map, myPos]);

  // odběr všech uživatelů a vykreslování markerů
  useEffect(() => {
    if (!map) return;

    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      const now = Date.now();

      // přidej/aktualizuj
      Object.entries(data).forEach(([id, u]) => {
        const online = u.lastActive && now - u.lastActive < 5 * 60 * 1000; // 5 minut
        const color = id === uid ? "red" : online ? "blue" : "#9aa0a6";    // já=červeně, online=modře, offline=šedě

        // vytvoř nebo aktualizuj marker
        if (!markers.current[id]) {
          const el = document.createElement("div");
          el.style.width = "14px";
          el.style.height = "14px";
          el.style.borderRadius = "50%";
          el.style.background = color;
          el.style.border = "2px solid white";
          el.style.boxShadow = "0 0 2px rgba(0,0,0,.4)";

          const marker = new mapboxgl.Marker({ element: el })
            .setLngLat([u.lng || 14.42, u.lat || 50.08])
            .addTo(map);

          const popupContent = document.createElement("div");
          popupContent.style.minWidth = "180px";
          popupContent.innerHTML = `
            <div style="display:flex;gap:8px;align-items:center">
              ${u.photoURL ? `<img src="${u.photoURL}" style="width:28px;height:28px;border-radius:50%;object-fit:cover" />` : ""}
              <div>
                <div style="font-weight:600">${u.name || "Anonym"}</div>
                <div style="font-size:12px;color:#666">${id === uid ? "To jsi ty" : online ? "online" : `naposledy ${timeAgo(u.lastActive)}`}</div>
              </div>
            </div>
            ${id !== uid ? `
              <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
                <button id="btnPing_${id}" style="padding:6px 10px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer">📩 Ping</button>
                <button id="btnChat_${id}" style="padding:6px 10px;border:1px solid #ddd;border-radius:8px;background:#fff;cursor:pointer">💬 Chat</button>
              </div>` : ""}
          `;

          const popup = new mapboxgl.Popup({ offset: 24 }).setDOMContent(popupContent);
          marker.setPopup(popup);

          markers.current[id] = { marker, popup, el };

          // napoj akce až když se popup otevře (DOM existuje)
          marker.getElement().addEventListener("click", () => {
            setTimeout(() => {
              const pingBtn = document.getElementById(`btnPing_${id}`);
              const chatBtn = document.getElementById(`btnChat_${id}`);
              if (pingBtn) pingBtn.onclick = () => sendPing(id, u.name || "Anonym");
              if (chatBtn) chatBtn.onclick = () => openChat(id, u.name || "Anonym");
            }, 0);
          });
        } else {
          // update barvy + pozice
          markers.current[id].el.style.background = color;
          if (u.lng && u.lat) {
            markers.current[id].marker.setLngLat([u.lng, u.lat]);
          }
        }
      });

      // smaž markery, které už v DB nejsou
      Object.keys(markers.current).forEach((id) => {
        if (!data[id]) {
          markers.current[id].marker.remove();
          delete markers.current[id];
        }
      });
    });

    return () => off(usersRef, "value", unsub);
  }, [map, uid]);

  /* ====== PING ====== */
  async function sendPing(targetUid, targetName) {
    if (!uid) return;
    const pRef = ref(db, `pings/${targetUid}/${uid}`);
    await set(pRef, {
      from: uid,
      fromName: name,
      at: Date.now(),
    });
    // lehké potvrzení
    if (soundOn) pingAudio.current.play().catch(() => {});
  }

  // poslouchám příchozí pingy
  useEffect(() => {
    if (!uid) return;
    const myPings = ref(db, `pings/${uid}`);
    const unsub = onValue(myPings, (snap) => {
      const data = snap.val();
      if (!data) return;

      Object.values(data).forEach((p) => {
        // upozornění + zvuk
        if (soundOn) pingAudio.current.play().catch(() => {});
        // malý toast
        showToast(`📩 Ping od ${p.fromName || "uživatele"}`);
        // auto-otevřít chat po potvrzené akci uživatele: klepnutí na toast
      });

      // smaž pingy po zobrazení
      set(myPings, null);
    });
    return () => off(myPings, "value", unsub);
  }, [uid, soundOn]);

  /* ====== CHAT ====== */
  function openChat(otherUid, otherName) {
    setChatWith({ uid: otherUid, name: otherName });
    setChatOpen(true);

    const cid = conversationId(uid, otherUid);
    const msgsRef = ref(db, `messages/${cid}`);
    const unsub = onValue(msgsRef, (snap) => {
      const data = snap.val() || {};
      const list = Object.entries(data)
        .map(([id, m]) => ({ id, ...m }))
        .sort((a, b) => (a.at || 0) - (b.at || 0));
      setChatMessages(list);
    });

    // cleanup listeneru po zavření chatu
    return () => off(msgsRef, "value", unsub);
  }

  async function sendMessage() {
    if (!chatOpen || !chatWith || !chatInput.trim()) return;
    const cid = conversationId(uid, chatWith.uid);
    const msgsRef = ref(db, `messages/${cid}`);
    await push(msgsRef, {
      from: uid,
      fromName: name,
      text: chatInput.trim(),
      at: Date.now(),
    });
    setChatInput("");
  }

  /* ====== NASTAVENÍ / AVATAR ====== */
  async function handleAvatarChange(e) {
    const file = e.target.files?.[0];
    if (!file || !uid) return;

    // jednoduchá komprese: pokud > 1.5MB, zmenšíme na ~0.7MB (jen přes canvas pro JPG)
    const resized = await maybeDownscale(file, 1200, 0.8).catch(() => file);

    const path = sref(storage, `avatars/${uid}.jpg`);
    await uploadBytes(path, resized);
    const url = await getDownloadURL(path);

    await update(ref(db, `users/${uid}`), { photoURL: url, lastActive: Date.now() });
    showToast("📷 Avatar uložen");
  }

  function saveSettings() {
    localStorage.setItem("name", name || "Anonym");
    localStorage.setItem("nameSaved", "1");
    update(ref(db, `users/${uid}`), {
      name: name || "Anonym",
      lastActive: Date.now(),
    });
    setSettingsOpen(false);
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    localStorage.setItem("soundOn", next ? "1" : "0");
    if (next) {
      pingAudio.current.currentTime = 0;
      pingAudio.current.play().catch(() => {});
    }
  }

  /* ====== UI POMOC ====== */
  function showToast(text) {
    const t = document.createElement("div");
    t.textContent = text;
    t.style.position = "fixed";
    t.style.left = "50%";
    t.style.bottom = "20px";
    t.style.transform = "translateX(-50%)";
    t.style.background = "#111";
    t.style.color = "#fff";
    t.style.padding = "10px 14px";
    t.style.borderRadius = "10px";
    t.style.zIndex = 9999;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }

  return (
    <div>
      {/* horní lišta – zobrazí se jen dokud není jméno „uloženo“ */}
      {!localStorage.getItem("nameSaved") && (
        <div style={{ position: "absolute", left: 10, top: 10, zIndex: 5, display: "flex", gap: 8, background: "white", padding: 8, borderRadius: 12, boxShadow: "0 2px 10px rgba(0,0,0,.08)" }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Zadej jméno"
            style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd", width: 190 }}
          />
          <button onClick={saveSettings} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
            Uložit
          </button>
          <button
            onClick={toggleSound}
            style={{
              padding: "8px 12px",
              borderRadius: 10,
              border: "1px solid #ddd",
              background: soundOn ? "#def7de" : "#fff",
              cursor: "pointer"
            }}
          >
            {soundOn ? "🔊 Zvuk zapnut" : "🔈 Povolit zvuk"}
          </button>
          <label style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}>
            📷 Přidat fotku
            <input type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: "none" }} />
          </label>
        </div>
      )}

      {/* ozubené kolo – nastavení po uložení jména */}
      {localStorage.getItem("nameSaved") && (
        <>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Nastavení"
            style={{ position: "absolute", right: 12, top: 12, zIndex: 5, width: 40, height: 40, borderRadius: 12, border: "1px solid #ddd", background: "#fff", cursor: "pointer", boxShadow: "0 2px 10px rgba(0,0,0,.08)" }}
          >
            ⚙️
          </button>

          {settingsOpen && (
            <div style={{ position: "absolute", right: 12, top: 60, zIndex: 6, background: "#fff", padding: 12, borderRadius: 12, border: "1px solid #ddd", width: 260, boxShadow: "0 6px 24px rgba(0,0,0,.12)" }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Nastavení</div>
              <div style={{ display: "grid", gap: 8 }}>
                <label style={{ fontSize: 13 }}>Jméno</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #ddd" }}
                />

                <label style={{ fontSize: 13 }}>Avatar</label>
                <label style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", cursor: "pointer", textAlign: "center" }}>
                  📷 Nahrát fotku
                  <input type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: "none" }} />
                </label>

                <button
                  onClick={toggleSound}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid #ddd",
                    background: soundOn ? "#def7de" : "#fff",
                    cursor: "pointer"
                  }}
                >
                  {soundOn ? "🔊 Zvuk zapnut" : "🔈 Povolit zvuk"}
                </button>

                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={saveSettings} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff", flex: 1 }}>
                    Uložit
                  </button>
                  <button onClick={() => setSettingsOpen(false)} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}>
                    Zavřít
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* chat panel */}
      {chatOpen && chatWith && (
        <div style={{
          position: "absolute",
          left: 10,
          bottom: 10,
          zIndex: 5,
          width: "min(420px, 90vw)",
          background: "#fff",
          border: "1px solid #ddd",
          borderRadius: 12,
          boxShadow: "0 6px 24px rgba(0,0,0,.12)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "60vh"
        }}>
          <div style={{ padding: 10, borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Chat s {chatWith.name}</strong>
            <button onClick={() => setChatOpen(false)} style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 8, padding: "6px 10px", cursor: "pointer" }}>✕</button>
          </div>
          <div style={{ padding: 10, overflowY: "auto", flex: 1 }}>
            {chatMessages.map((m) => (
              <div key={m.id} style={{ marginBottom: 8, display: "flex", justifyContent: m.from === uid ? "flex-end" : "flex-start" }}>
                <div style={{ background: m.from === uid ? "#e8f0fe" : "#f1f3f4", borderRadius: 10, padding: "6px 10px", maxWidth: "80%" }}>
                  <div style={{ fontSize: 12, color: "#666" }}>{m.from === uid ? "Ty" : m.fromName || "Uživatel"}</div>
                  <div>{m.text}</div>
                  <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{timeAgo(m.at)}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: 10, borderTop: "1px solid #eee", display: "flex", gap: 8 }}>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Napiš zprávu…"
              style={{ flex: 1, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 10 }}
            />
            <button onClick={sendMessage} style={{ padding: "8px 12px", borderRadius: 10, border: "1px solid #ddd", background: "#fff" }}>Odeslat</button>
          </div>
        </div>
      )}

      <div id="map" style={{ width: "100vw", height: "100vh" }} />
    </div>
  );
}

/* ========== jednoduché zmenšení obrázku ( pokud to prohlížeč dovolí ) ========== */
async function maybeDownscale(file, maxSize, quality = 0.8) {
  if (!/^image\/(jpe?g|png|webp)$/i.test(file.type)) return file;

  const img = await fileToImage(file);
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  if (scale >= 1) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", quality)
  );
  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
}
function fileToImage(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => res(img);
      img.onerror = rej;
      img.src = reader.result;
    };
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}
