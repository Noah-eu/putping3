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
  onDisconnect,
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

/* ====== Mapbox token ====== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ====== Firebase config (tvůj) ====== */
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

/* ====== Pomocníci ====== */
function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60_000) return "před pár sekundami";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.floor(h / 24);
  return `před ${d} dny`;
}

export default function App() {
  const [map, setMap] = useState(null);

  const [meId, setMeId] = useState(
    () => localStorage.getItem("userId") || ""
  );
  const [myName, setMyName] = useState(
    () => localStorage.getItem("userName") || "Anonymní uživatel"
  );
  const [soundEnabled, setSoundEnabled] = useState(
    () => localStorage.getItem("soundEnabled") === "1"
  );

  const [chatWith, setChatWith] = useState(null); // { id, name }
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]); // [{id,from,to,text,ts}]

  const markersRef = useRef({}); // uid -> marker
  const myMarkerRef = useRef(null);
  const soundRef = useRef(null);

  /* Init audio once */
  useEffect(() => {
    soundRef.current = new Audio(
      "https://cdn.pixabay.com/audio/2022/03/15/audio_3f61f7cdd2.mp3"
    );
  }, []);

  /* Anonymous sign-in */
  useEffect(() => {
    let cancelled = false;
    if (!meId) {
      signInAnonymously(auth)
        .then((cred) => {
          if (cancelled) return;
          const uid = cred.user.uid;
          setMeId(uid);
          localStorage.setItem("userId", uid);
        })
        .catch(console.error);
    }
    return () => {
      cancelled = true;
    };
  }, [meId]);

  /* Start map after geolocation + write my user doc */
  useEffect(() => {
    if (!meId || map) return;

    if (!("geolocation" in navigator)) {
      alert("Prohlížeč nepodporuje geolokaci.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;

        const m = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v11",
          center: [longitude, latitude],
          zoom: 14,
        });
        setMap(m);

        // můj marker (červený)
        myMarkerRef.current = new mapboxgl.Marker({ color: "red" })
          .setLngLat([longitude, latitude])
          .setPopup(
            new mapboxgl.Popup({ offset: 25 }).setHTML(
              `<b>${escapeHtml(myName)}</b><br>${new Date().toLocaleTimeString()}`
            )
          )
          .addTo(m);

        // napíšu se do DB
        const meR = dbRef(db, `users/${meId}`);
        set(meR, {
          name: myName || "Anonymní uživatel",
          lat: latitude,
          lng: longitude,
          lastActive: Date.now(),
          photoUrl: "", // zatím prázdné
        });
        onDisconnect(meR).update({ lastActive: Date.now() });

        // průběžný update pozice + lastActive
        const watchId = navigator.geolocation.watchPosition(
          (p) => {
            const { latitude: la, longitude: lo } = p.coords;
            if (myMarkerRef.current) {
              myMarkerRef.current.setLngLat([lo, la]);
            }
            update(meR, {
              lat: la,
              lng: lo,
              name: myName || "Anonymní uživatel",
              lastActive: Date.now(),
            });
          },
          (err) => console.warn(err),
          { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
        );

        // clear watch na unmount
        return () => navigator.geolocation.clearWatch(watchId);
      },
      () => alert("Nepodařilo se získat polohu."),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
    );
  }, [meId, map, myName]);

  /* Poslech všech uživatelů – modré markery */
  useEffect(() => {
    if (!map || !meId) return;
    const usersR = dbRef(db, "users");
    const unsub = onValue(usersR, (snap) => {
      const data = snap.val() || {};
      // přidej/aktualizuj
      Object.entries(data).forEach(([uid, u]) => {
        if (uid === meId) return;
        if (!u || typeof u.lng !== "number" || typeof u.lat !== "number") return;

        let marker = markersRef.current[uid];
        const name = u.name || "Anonym";
        const last = u.lastActive ? timeAgo(u.lastActive) : "neznámo";

        const popupHtml =
          (u.photoUrl
            ? `<div style="margin-bottom:6px"><img src="${u.photoUrl}" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover" /></div>`
            : "") +
          `<b>${escapeHtml(name)}</b><br><small>Naposledy online: ${last}</small>
           <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
             <button data-act="ping" data-uid="${uid}" class="pp-btn">Ping</button>
             <button data-act="chat" data-uid="${uid}" class="pp-btn">Chat</button>
           </div>`;

        if (!marker) {
          marker = new mapboxgl.Marker({ color: "blue" })
            .setLngLat([u.lng, u.lat])
            .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(popupHtml))
            .addTo(map);

          marker.getElement().addEventListener("click", () => {
            // mapbox popup se otevře – připojíme click-handlery po krátké prodlevě
            setTimeout(attachPopupHandlers, 50);
          });

          markersRef.current[uid] = marker;
        } else {
          marker.setLngLat([u.lng, u.lat]);
          marker.getPopup()?.setHTML(popupHtml);
        }
      });

      // ukliď markery smazaných
      Object.keys(markersRef.current).forEach((uid) => {
        if (!data[uid]) {
          markersRef.current[uid].remove();
          delete markersRef.current[uid];
        }
      });
    });
    return unsub;
  }, [map, meId]);

  /* Poslech příchozích zpráv – pípni jen pokud nejsou moje */
  useEffect(() => {
    if (!meId) return;
    const inboxR = dbRef(db, `messages/${meId}`);
    const unsub = onValue(inboxR, (snap) => {
      const all = snap.val() || {};
      let gotForeign = false;

      // zkontroluj, zda existuje nepřečtená/nová zpráva od cizího
      Object.values(all).forEach((group) => {
        Object.values(group || {}).forEach((msg) => {
          if (msg && msg.from && msg.from !== meId) {
            gotForeign = true;
          }
        });
      });

      if (gotForeign && soundEnabled && soundRef.current) {
        // přehraj až po potvrzeném odemčení
        soundRef.current
          .play()
          .catch(() => console.warn("Zvuk se nepodařilo přehrát"));
      }

      // pokud je otevřený chat, načti jeho vlákno
      if (chatWith && chatWith.id) {
        const thread = (all[chatWith.id] && Object.values(all[chatWith.id])) || [];
        const sorted = thread.sort((a, b) => (a.ts || 0) - (b.ts || 0));
        setChatMessages(sorted);
      }
    });
    return unsub;
  }, [meId, soundEnabled, chatWith]);

  /* Attach kliky v popupu (Ping, Chat) */
  function attachPopupHandlers() {
    document.querySelectorAll(".pp-btn").forEach((btn) => {
      const act = btn.getAttribute("data-act");
      const uid = btn.getAttribute("data-uid");
      if (!uid) return;
      if (act === "ping") {
        btn.onclick = () => sendPing(uid);
      } else if (act === "chat") {
        btn.onclick = () => openChat(uid);
      }
    });
  }

  /* Ping */
  function sendPing(targetId) {
    if (!meId || !targetId) return;
    const targetInbox = dbRef(db, `pings/${targetId}`);
    const id = push(targetInbox).key;
    if (!id) return;
    set(dbRef(db, `pings/${targetId}/${id}`), {
      from: meId,
      ts: Date.now(),
    });
  }

  /* Otevřít chat s uživatelem */
  function openChat(uid) {
    if (!uid || !meId) return;
    const uR = dbRef(db, `users/${uid}`);
    onValue(
      uR,
      (s) => {
        const u = s.val() || {};
        setChatWith({ id: uid, name: u.name || "Anonym", photoUrl: u.photoUrl || "" });
      },
      { onlyOnce: true }
    );
  }

  /* Odeslat zprávu do vlákna (oboustranně) */
  function sendMessage() {
    if (!chatWith || !chatWith.id || !chatInput.trim()) return;
    const text = chatInput.trim();
    const ts = Date.now();

    // moje vlákno /messages/me/peer
    const myThread = dbRef(db, `messages/${meId}/${chatWith.id}`);
    const peerThread = dbRef(db, `messages/${chatWith.id}/${meId}`);

    const msgMe = push(myThread);
    const msgPeer = push(peerThread);

    const payload = { from: meId, to: chatWith.id, text, ts };
    set(msgMe, payload);
    set(msgPeer, payload);

    setChatInput("");
  }

  /* Povolit zvuk – unlock audio (nutné pro mobily) */
  function enableSound() {
    setSoundEnabled(true);
    localStorage.setItem("soundEnabled", "1");
    if (soundRef.current) {
      soundRef.current
        .play()
        .then(() => {
          // vizuální odezva
          alert("Zvuk povolen ✅");
        })
        .catch(() => {
          alert("Prohlížeč blokuje zvuk – zkuste znovu klepnout.");
        });
    }
  }

  /* Uložit jméno (lokálně i do DB) */
  function saveName() {
    localStorage.setItem("userName", myName);
    if (meId) {
      update(dbRef(db, `users/${meId}`), { name: myName, lastActive: Date.now() });
    }
  }

  /* Upload fotky do Storage a zapsat photoUrl do DB */
  async function handlePhotoUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file || !meId) return;
    try {
      const objRef = storageRef(storage, `profilePics/${meId}.jpg`);
      await uploadBytes(objRef, file);
      const url = await getDownloadURL(objRef);
      await update(dbRef(db, `users/${meId}`), { photoUrl: url, lastActive: Date.now() });
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
          padding: "6px",
          background: "white",
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,.1)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input
          value={myName}
          onChange={(e) => setMyName(e.target.value)}
          placeholder="Zadej jméno"
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

      {/* Chat panel */}
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
            boxShadow: "0 8px 24px rgba(0,0,0,.18)",
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

/* Malý helper kvůli bezpečnému vložení textu do popupu */
function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
