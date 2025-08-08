// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  push,
  onDisconnect,
} from "firebase/database";

/* ========== Mapbox ========== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ========== Firebase (dle tebe) ========== */
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
try {
  getAnalytics(app);
} catch {}
const db = getDatabase();

/* ========== Nastavení ========== */
const HEARTBEAT_MS = 20_000;
const PING_SOUND_URL =
  "https://notificationsounds.com/storage/sounds/file-sounds-1150-event.mp3";

/* Toast */
function Toast({ message }) {
  if (!message) return null;
  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: "50%",
        transform: "translateX(-50%)",
        background: "rgba(0,0,0,0.85)",
        color: "#fff",
        padding: "10px 14px",
        borderRadius: 10,
        zIndex: 9999,
        maxWidth: 380,
        boxShadow: "0 6px 16px rgba(0,0,0,.3)",
        fontSize: 14,
        lineHeight: 1.35,
        textAlign: "center",
      }}
    >
      {message}
    </div>
  );
}

/* Chat overlay */
function ChatModal({ me, peer, messages, onClose, onSend, soundEnabled }) {
  const [text, setText] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.35)",
        zIndex: 10000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          width: "min(92vw, 520px)",
          maxHeight: "80vh",
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,.25)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid #eee",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <b>Chat s {peer.name || "Uživatelem"}</b>
            {!peer.online && (
              <span style={{ marginLeft: 8, color: "#777", fontSize: 12 }}>
                (⚪ offline – zpráva se mu zobrazí po připojení)
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            style={{ border: "1px solid #ddd", borderRadius: 8, padding: "4px 8px" }}
          >
            ✕ Zavřít
          </button>
        </div>

        <div ref={listRef} style={{ padding: 12, overflowY: "auto", flex: 1 }}>
          {(messages || []).map((m) => (
            <div
              key={m.id}
              style={{
                display: "flex",
                marginBottom: 8,
                justifyContent: m.from === me ? "flex-end" : "flex-start",
              }}
            >
              <div
                style={{
                  background: m.from === me ? "#e8f5ff" : "#f5f5f5",
                  border: "1px solid #e1e1e1",
                  borderRadius: 10,
                  padding: "6px 8px",
                  maxWidth: "75%",
                }}
              >
                <div style={{ fontSize: 12, color: "#667", marginBottom: 2 }}>
                  {m.from === me ? "Ty" : m.fromName || "Uživatel"}
                </div>
                <div>{m.text}</div>
                <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
                  {new Date(m.ts).toLocaleString()}
                </div>
              </div>
            </div>
          ))}
          {(!messages || messages.length === 0) && (
            <div style={{ color: "#888", textAlign: "center", marginTop: 12 }}>
              Zatím žádné zprávy.
            </div>
          )}
        </div>

        <div
          style={{
            padding: 10,
            borderTop: "1px solid #eee",
            display: "flex",
            gap: 8,
          }}
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Napiš zprávu…"
            style={{
              flex: 1,
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: "8px 10px",
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && text.trim()) {
                onSend(text.trim());
                setText("");
              }
            }}
          />
          <button
            onClick={() => {
              if (text.trim()) {
                onSend(text.trim());
                setText("");
              }
            }}
            style={{
              border: "1px solid #ddd",
              borderRadius: 8,
              padding: "8px 12px",
              background: "#f6faff",
            }}
          >
            ➤ Odeslat
          </button>
        </div>
      </div>
    </div>
  );
}

/* Odemknutí zvuku (WebAudio) + potvrzovací pípnutí */
function useAudioUnlock() {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const ctxRef = useRef(null);
  const enableSound = async () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!ctxRef.current && Ctx) ctxRef.current = new Ctx();
      if (ctxRef.current && ctxRef.current.state !== "running")
        await ctxRef.current.resume();

      // potvrzovací pípnutí
      if (ctxRef.current) {
        const ctx = ctxRef.current;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = "sine";
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
        o.connect(g);
        g.connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.16);
      }

      if (window.Notification?.requestPermission) {
        try {
          await Notification.requestPermission();
        } catch {}
      }

      setSoundEnabled(true);
    } catch (e) {
      console.warn("Audio unlock fail:", e);
      setSoundEnabled(false);
    }
  };
  return { soundEnabled, enableSound };
}

/* Pomocný: ID konverzace = A_B (seřazené) */
const conversationId = (a, b) => [a, b].sort().join("_");

export default function App() {
  const [map, setMap] = useState(null);
  const [userId] = useState(
    localStorage.getItem("userId") || Math.random().toString(36).slice(2, 11)
  );
  const [name, setName] = useState(localStorage.getItem("userName") || "Anonym");
  const [toast, setToast] = useState("");

  const { soundEnabled, enableSound } = useAudioUnlock();

  const positionRef = useRef({ lat: 50.08804, lng: 14.42076 });
  const myMarkerRef = useRef(null);
  const markersRef = useRef({}); // { uid: { marker, popup, lastName } }

  // chat overlay state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPeer, setChatPeer] = useState(null); // { uid, name, online }
  const [chatMessages, setChatMessages] = useState([]);

  useEffect(() => {
    localStorage.setItem("userId", userId);
  }, [userId]);

  const showToast = (t, ms = 9000) => {
    setToast(t);
    if (ms > 0) setTimeout(() => setToast(""), ms);
  };

  /* Inicializace mapy + moje poloha + přítomnost */
  useEffect(() => {
    if (!navigator.geolocation) {
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

        const meRef = ref(db, `users/${userId}`);
        // Nastavím se jako online + první pozice
        set(meRef, {
          name: name || "Anonym",
          lat: latitude,
          lng: longitude,
          lastActive: Date.now(),
          online: true,
        });

        // PŘÍTOMNOST: když se odpojím, NEsmažu se – jen nastavím online:false
        onDisconnect(meRef).update({
          online: false,
          lastActive: Date.now(),
        });

        // můj marker (červený)
        const myPopup = new mapboxgl.Popup({ offset: 25 }).setHTML(
          `<b>${name || "Anonym"}</b><br>${new Date().toLocaleTimeString()}`
        );
        const myMarker = new mapboxgl.Marker({ color: "red" })
          .setLngLat([longitude, latitude])
          .setPopup(myPopup)
          .addTo(m);
        myMarkerRef.current = { marker: myMarker, popup: myPopup };

        // live update
        const watchId = navigator.geolocation.watchPosition(
          (p) => {
            const { latitude: lat, longitude: lng } = p.coords;
            positionRef.current = { lat, lng };
            update(meRef, {
              lat,
              lng,
              name: name || "Anonym",
              lastActive: Date.now(),
              online: true,
            });
            if (myMarkerRef.current)
              myMarkerRef.current.marker.setLngLat([lng, lat]);
          },
          () => {},
          { enableHighAccuracy: true }
        );

        // heartbeat (když se nehýbu)
        const hb = setInterval(() => {
          update(meRef, {
            name: name || "Anonym",
            lat: positionRef.current.lat,
            lng: positionRef.current.lng,
            lastActive: Date.now(),
            online: true,
          });
        }, HEARTBEAT_MS);

        // úklid
        return () => {
          clearInterval(hb);
          navigator.geolocation.clearWatch(watchId);
          // Při reloadu/odchodu onDisconnect zajistí online:false
        };
      },
      () => alert("Nepodařilo se získat polohu."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Uložit jméno */
  const saveName = () => {
    localStorage.setItem("userName", name);
    update(ref(db, `users/${userId}`), {
      name: name || "Anonym",
      lastActive: Date.now(),
      online: true,
    });
    if (myMarkerRef.current) {
      myMarkerRef.current.popup.setHTML(
        `<b>${name || "Anonym"}</b><br>${new Date().toLocaleTimeString()}`
      );
    }
    showToast("✅ Jméno uloženo", 2500);
  };

  /* Rychlý Ping */
  const sendPing = async (toUid) => {
    await push(ref(db, `pings/${toUid}`), {
      kind: "ping",
      from: userId,
      fromName: name || "Anonym",
      ts: Date.now(),
    });
    showToast("📩 Ping odeslán", 2500);
  };

  /* Chat – otevření, poslouchání historie, odeslání */
  const openChat = (peerUid, peerName, peerOnline) => {
    const cid = conversationId(userId, peerUid);
    setChatPeer({ uid: peerUid, name: peerName || "Uživatel", online: !!peerOnline });
    setChatOpen(true);

    const convRef = ref(db, `chats/${cid}`);
    onValue(
      convRef,
      (snap) => {
        const data = snap.val() || {};
        const list = Object.entries(data)
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([id, msg]) => ({ id, ...msg }));
        setChatMessages(list);
        // jemný zvuk při příchodu nové zprávy (když je overlay otevřený)
        if (list.length) {
          if (soundEnabled) {
            try {
              const a = new Audio(PING_SOUND_URL);
              a.preload = "auto";
              a.play().catch(() => {});
            } catch {}
          }
        }
      },
      { onlyOnce: false }
    );
  };
  const closeChat = () => {
    setChatOpen(false);
    setChatPeer(null);
    setChatMessages([]);
  };
  const sendChatMessage = async (text) => {
    if (!chatPeer) return;
    const cid = conversationId(userId, chatPeer.uid);
    await push(ref(db, `chats/${cid}`), {
      from: userId,
      fromName: name || "Anonym",
      text,
      ts: Date.now(),
    });
  };

  /* Legacy: příjem rychlých pingů (toast) */
  useEffect(() => {
    const unsub = onValue(ref(db, `pings/${userId}`), (snap) => {
      const all = snap.val() || {};
      const ids = Object.keys(all);
      if (!ids.length) return;

      ids.forEach((pid) => {
        const p = all[pid];
        const who = p.fromName ? ` od ${p.fromName}` : "";
        showToast(`📩 Ping${who}!`, 9000);
        if (soundEnabled) {
          try {
            const a = new Audio(PING_SOUND_URL);
            a.preload = "auto";
            a.play().catch(() => {});
          } catch {}
        }
        // nepromazáváme pings/{userId} → nechceme zahlcovat, ale legacy pings mohou zůstat – dle potřeby lze časem čistit CRONem
      });
    });
    return () => unsub();
  }, [userId, soundEnabled]);

  /* Ostatní uživatelé – zobrazit VŽDY (online i offline) */
  useEffect(() => {
    if (!map) return;

    const unsub = onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      const now = Date.now();

      Object.entries(data).forEach(([uid, u]) => {
        if (!u) return;
        if (uid === userId) return;

        // online stav – primárně podle u.online, fallback: lastActive < 5 min
        const isOnline =
          u.online === true ||
          (typeof u.lastActive === "number" && now - u.lastActive <= 5 * 60 * 1000);

        const popupHtml = `
          <div style="min-width:200px">
            <b>${u.name || "Uživatel"}</b><br>
            <small>${isOnline ? "🟢 online" : "⚪ offline"}</small><br>
            <div style="display:flex; gap:6px; margin-top:8px;">
              <button id="ping-${uid}" style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:8px;background:#f2f6ff">📩 Ping</button>
              <button id="chat-${uid}" style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:8px;background:#fff">💬 Chatovat</button>
            </div>
          </div>
        `;

        if (!markersRef.current[uid]) {
          const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(popupHtml);
          const marker = new mapboxgl.Marker({
            color: isOnline ? "blue" : "gray",
          })
            .setLngLat([u.lng, u.lat])
            .setPopup(popup)
            .addTo(map);

          popup.on("open", () => {
            const pingBtn = document.getElementById(`ping-${uid}`);
            const chatBtn = document.getElementById(`chat-${uid}`);
            if (pingBtn && !pingBtn.dataset.bound) {
              pingBtn.dataset.bound = "1";
              pingBtn.onclick = (e) => {
                e.stopPropagation();
                sendPing(uid);
              };
            }
            if (chatBtn && !chatBtn.dataset.bound) {
              chatBtn.dataset.bound = "1";
              chatBtn.onclick = (e) => {
                e.stopPropagation();
                openChat(uid, u.name, isOnline);
              };
            }
          });

          markersRef.current[uid] = {
            marker,
            popup,
            lastName: u.name || "",
          };
        } else {
          // update pozice + barvy
          const mk = markersRef.current[uid].marker;
          mk.setLngLat([u.lng, u.lat]);
          // změna barvy podle online
          mk.getElement().style.backgroundColor = isOnline ? "blue" : "gray";

          // když se změní jméno → obnovíme HTML a rebindneme handlers
          const prev = markersRef.current[uid].lastName;
          const curr = u.name || "";
          if (prev !== curr) {
            markersRef.current[uid].lastName = curr;
            markersRef.current[uid].popup.setHTML(popupHtml);
            markersRef.current[uid].popup.on("open", () => {
              const pingBtn = document.getElementById(`ping-${uid}`);
              const chatBtn = document.getElementById(`chat-${uid}`);
              if (pingBtn && !pingBtn.dataset.bound) {
                pingBtn.dataset.bound = "1";
                pingBtn.onclick = (e) => {
                  e.stopPropagation();
                  sendPing(uid);
                };
              }
              if (chatBtn && !chatBtn.dataset.bound) {
                chatBtn.dataset.bound = "1";
                chatBtn.onclick = (e) => {
                  e.stopPropagation();
                  openChat(uid, u.name, isOnline);
                };
              }
            });
          }
        }
      });

      // NEmažeme markery za „neaktivitu“ – zůstávají i offline
      // (kdybys někdy chtěl vyčistit smazané z DB, můžeš tu smazat markery, které nejsou v data)
      Object.keys(markersRef.current).forEach((uid) => {
        if (!data[uid]) {
          markersRef.current[uid].marker.remove();
          delete markersRef.current[uid];
        }
      });
    });

    return () => unsub();
  }, [map, userId]);

  return (
    <div>
      <Toast message={toast} />

      {/* horní lišta */}
      <div
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          top: 10,
          zIndex: 10,
          background: "#fff",
          borderRadius: 8,
          padding: 8,
          boxShadow: "0 4px 12px rgba(0,0,0,.15)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Zadej jméno"
          style={{
            padding: "6px 8px",
            minWidth: 180,
            border: "1px solid #ddd",
            borderRadius: 6,
          }}
        />
        <button
          onClick={saveName}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd" }}
        >
          Uložit
        </button>
        <button
          onClick={enableSound}
          disabled={soundEnabled}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #16a34a",
            background: soundEnabled ? "#16a34a" : "#fff",
            color: soundEnabled ? "#fff" : "#0f172a",
            cursor: soundEnabled ? "default" : "pointer",
            transition: "all .15s ease",
          }}
        >
          {soundEnabled ? "✅ Zvuk povolen" : "🔊 Povolit zvuk"}
        </button>
      </div>

      {/* mapa */}
      <div id="map" style={{ width: "100vw", height: "100vh" }} />

      {/* chat overlay */}
      {chatOpen && (
        <ChatModal
          me={userId}
          peer={chatPeer}
          messages={chatMessages}
          onClose={closeChat}
          onSend={sendChatMessage}
          soundEnabled={soundEnabled}
        />
      )}
    </div>
  );
}
