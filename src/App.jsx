// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref as dbRef,
  set,
  update,
  onValue,
  push,
  remove,
} from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

/* ========== Mapbox ========== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ========== Firebase (tvé údaje) ========== */
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
const db = getDatabase(app);
const storage = getStorage(app);
const auth = getAuth(app);

/* ========== Helpers ========== */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "před pár sekundami";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.floor(h / 24);
  return `před ${d} dny`;
}

/* Rychlé odeslání zprávy bez otevírání panelu (oboustranně) */
async function sendMessageDirect(db, meId, toUserId, text) {
  const ts = Date.now();
  const myThread = push(dbRef(db, `messages/${meId}/${toUserId}`));
  const peerThread = push(dbRef(db, `messages/${toUserId}/${meId}`));
  const payload = { from: meId, to: toUserId, text, ts };
  await set(myThread, payload);
  await set(peerThread, payload);
}

export default function App() {
  const [map, setMap] = useState(null);
  const [meId, setMeId] = useState(localStorage.getItem("userId") || "");
  const [myName, setMyName] = useState(
    localStorage.getItem("userName") || "Anonymní uživatel"
  );
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("soundEnabled") === "1"
  );

  const markersRef = useRef({}); // uid -> { marker, popup }
  const myMarkerRef = useRef(null);
  const soundRef = useRef(null);

  // Chat panel
  const [chatWith, setChatWith] = useState(null); // {id,name,photoUrl}
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");

  /* Init audio */
  useEffect(() => {
    soundRef.current = new Audio(
      "https://cdn.pixabay.com/audio/2022/03/15/audio_3f61f7cdd2.mp3"
    );
  }, []);

  /* Anonymous auth → userId */
  useEffect(() => {
    if (meId) return;
    signInAnonymously(auth)
      .then((cred) => {
        const uid = cred.user.uid;
        setMeId(uid);
        localStorage.setItem("userId", uid);
      })
      .catch(console.error);
  }, [meId]);

  /* Init mapy + moje poloha + zápis do DB (fallback Praha) */
  useEffect(() => {
    if (map || !meId) return;

    const startMap = (lng, lat) => {
      const m = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/streets-v11",
        center: [lng, lat],
        zoom: 14,
      });
      setMap(m);

      myMarkerRef.current = new mapboxgl.Marker({ color: "red" })
        .setLngLat([lng, lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(
            `<b>${escapeHtml(myName)}</b><br>${new Date().toLocaleTimeString()}`
          )
        )
        .addTo(m);

      // zapiš/aktualizuj se v DB
      const meR = dbRef(db, `users/${meId}`);
      set(meR, {
        name: myName || "Anonymní uživatel",
        lat,
        lng,
        lastActive: Date.now(),
        photoUrl: "", // doplní se po nahrání
      });
    };

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { longitude, latitude } = pos.coords;
          startMap(longitude, latitude);

          const meR = dbRef(db, `users/${meId}`);
          // kontinuální update pozice
          const watch = navigator.geolocation.watchPosition(
            (p) => {
              const { longitude: lo, latitude: la } = p.coords;
              if (myMarkerRef.current)
                myMarkerRef.current.setLngLat([lo, la]);
              update(meR, {
                lat: la,
                lng: lo,
                name: myName || "Anonymní uživatel",
                lastActive: Date.now(),
              });
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
          );
          return () => navigator.geolocation.clearWatch(watch);
        },
        () => {
          // fallback: Praha
          startMap(14.42076, 50.08804);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
      );
    } else {
      startMap(14.42076, 50.08804);
    }
  }, [map, meId, myName]);

  /* Poslech uživatelů -> markery + popup handlery */
  useEffect(() => {
    if (!map || !meId) return;
    const usersR = dbRef(db, "users");
    return onValue(usersR, (snap) => {
      const data = snap.val() || {};

      Object.entries(data).forEach(([uid, u]) => {
        if (!u || typeof u.lng !== "number" || typeof u.lat !== "number") return;
        if (uid === meId) return;

        const name = u.name || "Anonym";
        const last = u.lastActive ? timeAgo(u.lastActive) : "neznámo";
        const popupHtml = `
          <div style="font:12px/1.4 sans-serif;min-width:190px">
            ${
              u.photoUrl
                ? `<img src="${u.photoUrl}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;margin-bottom:6px;" />`
                : ""
            }
            <b>${escapeHtml(name)}</b><br/>
            <small>Naposledy: ${last}</small>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
              <button data-act="ping" data-uid="${uid}" class="pp-btn">📩 Ping</button>
              <button data-act="chat" data-uid="${uid}" class="pp-btn">💬 Chat</button>
            </div>
            <div style="margin-top:6px">
              <input id="pp-msg-${uid}" placeholder="Napiš zprávu…" style="width:160px;padding:4px" />
              <button data-act="send" data-uid="${uid}" class="pp-btn">Odeslat</button>
            </div>
          </div>
        `;

        if (!markersRef.current[uid]) {
          const popup = new mapboxgl.Popup({ offset: 18 }).setHTML(popupHtml);
          const marker = new mapboxgl.Marker({ color: "blue" })
            .setLngLat([u.lng, u.lat])
            .setPopup(popup)
            .addTo(map);

          // napoj kliky až po otevření popupu (spolehlivě)
          popup.on("open", () => {
            const root = popup.getElement();
            const pingBtn = root.querySelector(
              `[data-act="ping"][data-uid="${uid}"]`
            );
            const chatBtn = root.querySelector(
              `[data-act="chat"][data-uid="${uid}"]`
            );
            const sendBtn = root.querySelector(
              `[data-act="send"][data-uid="${uid}"]`
            );
            const inputEl = root.querySelector(`#pp-msg-${uid}`);

            if (pingBtn)
              pingBtn.onclick = () => {
                const id = push(dbRef(db, `pings/${uid}`)).key;
                if (id) {
                  set(dbRef(db, `pings/${uid}/${id}`), {
                    from: meId,
                    ts: Date.now(),
                  });
                }
              };
            if (chatBtn)
              chatBtn.onclick = () => openChat(uid);
            if (sendBtn && inputEl)
              sendBtn.onclick = async () => {
                const text = (inputEl.value || "").trim();
                if (!text) return;
                await sendMessageDirect(db, meId, uid, text);
                inputEl.value = "";
              };
          });

          markersRef.current[uid] = { marker, popup };
        } else {
          // update pozice + obsah popupu
          markersRef.current[uid].marker.setLngLat([u.lng, u.lat]);
          markersRef.current[uid].popup.setHTML(popupHtml);
        }
      });

      // úklid markerů smazaných userů
      Object.keys(markersRef.current).forEach((uid) => {
        if (!data[uid]) {
          markersRef.current[uid].marker.remove();
          delete markersRef.current[uid];
        }
      });
    });
  }, [map, meId]);

  /* Ping listener → zvuk jen na příchozí */
  useEffect(() => {
    if (!meId) return;
    const r = dbRef(db, `pings/${meId}`);
    return onValue(r, (snap) => {
      const data = snap.val() || {};
      const keys = Object.keys(data);
      if (!keys.length) return;
      const last = data[keys[keys.length - 1]];
      if (last && last.from && last.from !== meId) {
        if (soundEnabled && soundRef.current) {
          soundRef.current.currentTime = 0;
          soundRef.current.play().catch(() => {});
        }
        alert("📩 Ping!");
      }
      // smaž poslední odpracovaný ping
      remove(dbRef(db, `pings/${meId}/${keys[keys.length - 1]}`));
    });
  }, [meId, soundEnabled]);

  /* Příchozí zprávy → zvuk jen když nejsou ode mě + chat panel doplňuj */
  useEffect(() => {
    if (!meId) return;
    const inbox = dbRef(db, `messages/${meId}`);
    return onValue(inbox, (snap) => {
      const all = snap.val() || {};

      // zvuk u cizí zprávy
      let gotForeign = false;
      Object.values(all).forEach((grp) => {
        Object.values(grp || {}).forEach((m) => {
          if (m?.from && m.from !== meId) gotForeign = true;
        });
      });
      if (gotForeign && soundEnabled && soundRef.current) {
        soundRef.current.currentTime = 0;
        soundRef.current.play().catch(() => {});
      }

      // pokud je otevřený chat, načti jeho vlákno
      if (chatWith?.id && all[chatWith.id]) {
        const arr = Object.values(all[chatWith.id]).sort(
          (a, b) => (a.ts || 0) - (b.ts || 0)
        );
        setChatMessages(arr);
      }
    });
  }, [meId, soundEnabled, chatWith]);

  /* Otevři chat s uživatelem */
  function openChat(uid) {
    const uR = dbRef(db, `users/${uid}`);
    onValue(
      uR,
      (s) => {
        const u = s.val() || {};
        setChatWith({
          id: uid,
          name: u.name || "Uživatel",
          photoUrl: u.photoUrl || "",
        });
      },
      { onlyOnce: true }
    );
  }

  /* Odeslat zprávu z chat panelu */
  async function sendMessage() {
    if (!chatWith?.id || !chatInput.trim()) return;
    await sendMessageDirect(db, meId, chatWith.id, chatInput.trim());
    setChatInput("");
  }

  /* Uložit jméno do localStorage + DB */
  function saveName() {
    localStorage.setItem("userName", myName);
    if (meId) {
      update(dbRef(db, `users/${meId}`), {
        name: myName,
        lastActive: Date.now(),
      });
    }
  }

  /* Povolit zvuk (odemknout audio) */
  function enableSound() {
    setSoundEnabled(true);
    localStorage.setItem("soundEnabled", "1");
    if (soundRef.current) {
      soundRef.current.currentTime = 0;
      soundRef.current.play().catch(() => {});
    }
  }

  /* Upload fotky do Storage + URL do DB */
  async function handlePhotoUpload(e) {
    const file = e.target.files?.[0];
    if (!file || !meId) return;
    try {
      const obj = storageRef(storage, `profilePics/${meId}.jpg`);
      await uploadBytes(obj, file);
      const url = await getDownloadURL(obj);
      await update(dbRef(db, `users/${meId}`), {
        photoUrl: url,
        lastActive: Date.now(),
      });
      alert("Fotka nahrána ✅");
    } catch (err) {
      console.error(err);
      alert("Nahrání se nepodařilo.");
    }
  }

  return (
    <div>
      {/* horní lišta */}
      <div
        style={{
          position: "absolute",
          zIndex: 10,
          top: 10,
          left: 10,
          right: 10,
          padding: 8,
          background: "white",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,.12)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input
          value={myName}
          onChange={(e) => setMyName(e.target.value)}
          placeholder="Tvoje jméno"
          style={{ flex: "1 1 180px", padding: "8px 10px" }}
        />
        <button onClick={saveName}>Uložit</button>
        <button
          onClick={enableSound}
          style={{
            background: soundEnabled ? "#1e90ff" : "",
            color: soundEnabled ? "white" : "",
          }}
        >
          🔊 {soundEnabled ? "Zvuk povolen" : "Povolit zvuk"}
        </button>
        <label
          style={{
            border: "1px solid #ddd",
            padding: "7px 10px",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          📷 Nahrát fotku
          <input
            type="file"
            accept="image/*"
            onChange={handlePhotoUpload}
            style={{ display: "none" }}
          />
        </label>
      </div>

      {/* mapa */}
      <div id="map" style={{ width: "100vw", height: "100vh" }} />

      {/* chat panel */}
      {chatWith && (
        <div
          style={{
            position: "absolute",
            zIndex: 12,
            right: 10,
            bottom: 10,
            width: 320,
            maxHeight: "60vh",
            background: "white",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.16)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 10,
              borderBottom: "1px solid #eee",
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {chatWith.photoUrl ? (
              <img
                src={chatWith.photoUrl}
                alt=""
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  objectFit: "cover",
                }}
              />
            ) : (
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  background: "#eee",
                }}
              />
            )}
            <b style={{ flex: 1 }}>{chatWith.name || "Chat"}</b>
            <button onClick={() => setChatWith(null)}>✕</button>
          </div>

          <div
            style={{
              padding: 10,
              flex: 1,
              overflow: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {chatMessages.map((m) => {
              const mine = m.from === meId;
              return (
                <div
                  key={m.ts + (m.text || "")}
                  style={{
                    alignSelf: mine ? "flex-end" : "flex-start",
                    background: mine ? "#e6f2ff" : "#f5f5f5",
                    borderRadius: 8,
                    padding: "6px 8px",
                    maxWidth: "75%",
                  }}
                >
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {new Date(m.ts).toLocaleTimeString()}
                  </div>
                  <div>{m.text}</div>
                </div>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              padding: 10,
              borderTop: "1px solid #eee",
            }}
          >
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Napiš zprávu…"
              style={{ flex: 1, padding: "8px 10px" }}
            />
            <button onClick={sendMessage}>Odeslat</button>
          </div>
        </div>
      )}
    </div>
  );
}
