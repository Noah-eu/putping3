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
  remove,
  onDisconnect,
  push,
} from "firebase/database";

/* ========== Mapbox ========== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ========== Firebase (přesně jak jsi poslal) ========== */
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.firebasestorage.app",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X"
};
const app = initializeApp(firebaseConfig);
// Analytics může v SSR/Netlify prostředí hodit chybu → obalíme try/catch
try {
  getAnalytics(app);
} catch {}

/* ========== Konstanta a util ========== */
const TTL_MS = 5 * 60 * 1000;      // zobrazuj jen uživatele aktivní posledních 5 minut
const HEARTBEAT_MS = 20_000;       // heartbeat každých 20 s
const PING_SOUND_URL = "https://notificationsounds.com/storage/sounds/file-sounds-1150-event.mp3";

/* Jednoduchý toast overlay (nahoře) */
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

/* WebAudio odemknutí (kvůli autoplay blokacím na mobilech) + potvrzovací pípnutí */
function useAudioUnlock() {
  const [soundEnabled, setSoundEnabled] = useState(false);
  const audioCtxRef = useRef(null);

  const enableSound = async () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!audioCtxRef.current && Ctx) audioCtxRef.current = new Ctx();
      if (audioCtxRef.current && audioCtxRef.current.state !== "running") {
        await audioCtxRef.current.resume();
      }

      // krátké potvrzovací pípnutí (~0.15s)
      if (audioCtxRef.current) {
        const ctx = audioCtxRef.current;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.16);
      }

      // volitelně si vyžádat i notifikace
      if (window.Notification?.requestPermission) {
        try { await Notification.requestPermission(); } catch {}
      }

      setSoundEnabled(true);
    } catch (e) {
      console.warn("Nepodařilo se povolit zvuk:", e);
      setSoundEnabled(false);
    }
  };

  return { soundEnabled, enableSound };
}

export default function App() {
  const db = getDatabase();

  const [map, setMap] = useState(null);
  const [userId] = useState(
    localStorage.getItem("userId") || Math.random().toString(36).slice(2, 11)
  );
  const [name, setName] = useState(localStorage.getItem("userName") || "Anonym");
  const [toast, setToast] = useState("");

  const { soundEnabled, enableSound } = useAudioUnlock();
  const markersRef = useRef({}); // { uid: { marker, popup, lastName } }
  const myMarkerRef = useRef(null);
  const positionRef = useRef({ lat: 50.08804, lng: 14.42076 }); // default Praha

  // id ulož do localStorage
  useEffect(() => {
    localStorage.setItem("userId", userId);
  }, [userId]);

  // helper: toast
  const showToast = (text, ms = 9000) => {
    setToast(text);
    if (ms > 0) setTimeout(() => setToast(""), ms);
  };

  // inicializace mapy a mé polohy (+ zápis do DB, heartbeat)
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

        // můj záznam v DB
        const meRef = ref(db, `users/${userId}`);
        set(meRef, {
          name: name || "Anonym",
          lat: latitude,
          lng: longitude,
          lastActive: Date.now(),
        });
        onDisconnect(meRef).remove();

        // můj marker (červený)
        const myPopup = new mapboxgl.Popup({ offset: 25 }).setHTML(
          `<b>${name || "Anonym"}</b><br>${new Date().toLocaleTimeString()}`
        );
        const myMarker = new mapboxgl.Marker({ color: "red" })
          .setLngLat([longitude, latitude])
          .setPopup(myPopup)
          .addTo(m);
        myMarkerRef.current = { marker: myMarker, popup: myPopup };

        // průběžný update polohy
        const watchId = navigator.geolocation.watchPosition(
          (p) => {
            const { latitude: lat, longitude: lng } = p.coords;
            positionRef.current = { lat, lng };
            update(meRef, {
              lat,
              lng,
              name: name || "Anonym",
              lastActive: Date.now(),
            });
            if (myMarkerRef.current) {
              myMarkerRef.current.marker.setLngLat([lng, lat]);
            }
          },
          () => {},
          { enableHighAccuracy: true }
        );

        // heartbeat i bez pohybu
        const hb = setInterval(() => {
          update(meRef, {
            name: name || "Anonym",
            lat: positionRef.current.lat,
            lng: positionRef.current.lng,
            lastActive: Date.now(),
          });
        }, HEARTBEAT_MS);

        // úklid
        return () => {
          clearInterval(hb);
          navigator.geolocation.clearWatch(watchId);
        };
      },
      () => alert("Nepodařilo se získat polohu."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // uložit jméno
  const saveName = () => {
    localStorage.setItem("userName", name);
    update(ref(db, `users/${userId}`), {
      name: name || "Anonym",
      lastActive: Date.now(),
    });
    if (myMarkerRef.current) {
      myMarkerRef.current.popup.setHTML(
        `<b>${name || "Anonym"}</b><br>${new Date().toLocaleTimeString()}`
      );
    }
    showToast("✅ Jméno uloženo", 2500);
  };

  // poslat ping / zprávu
  const sendPing = async (toUid, text = "") => {
    await push(ref(db, `pings/${toUid}`), {
      kind: text ? "message" : "ping",
      from: userId,
      fromName: name || "Anonym",
      text: text || "",
      ts: Date.now(),
    });
    showToast(text ? "💬 Zpráva odeslána" : "📩 Ping odeslán", 2500);
  };

  // příchozí pings/zprávy pro mě (toast + případně zvuk)
  useEffect(() => {
    const unsub = onValue(ref(db, `pings/${userId}`), (snap) => {
      const all = snap.val() || {};
      const ids = Object.keys(all);
      if (!ids.length) return;

      ids.forEach((pid) => {
        const p = all[pid];
        const who = p.fromName ? ` od ${p.fromName}` : "";
        if (p.kind === "message" && p.text) {
          showToast(`💬 Zpráva${who}: ${p.text}`, 12000);
        } else {
          showToast(`📩 Ping${who}!`, 9000);
        }

        if (soundEnabled) {
          try {
            const a = new Audio(PING_SOUND_URL);
            a.preload = "auto";
            a.play().catch(() => {});
          } catch {}
        }

        // spotřebovat zprávu/ping
        remove(ref(db, `pings/${userId}/${pid}`));
      });
    });
    return () => unsub();
  }, [userId, soundEnabled, db]);

  // ostatní uživatelé (modré markery + popup s Ping/Zprávou)
  useEffect(() => {
    if (!map) return;

    const unsub = onValue(ref(db, "users"), (snap) => {
      const now = Date.now();
      const data = snap.val() || {};

      // přidej/aktualizuj markery
      Object.entries(data).forEach(([uid, u]) => {
        if (uid === userId) return;
        if (!u || !u.lastActive || now - u.lastActive > TTL_MS) {
          if (markersRef.current[uid]) {
            markersRef.current[uid].marker.remove();
            delete markersRef.current[uid];
          }
          return;
        }

        const createPopupHtml = (displayName, lastActive) => `
          <div style="min-width:190px">
            <b>${displayName || "Uživatel"}</b><br>
            <small>${new Date(lastActive).toLocaleTimeString()}</small><br>
            <div style="margin-top:6px">
              <button id="ping-${uid}" style="padding:4px 8px">📩 Ping</button>
            </div>
            <div style="margin-top:6px; display:flex; gap:4px">
              <input id="msg-${uid}" placeholder="Zpráva" style="flex:1;padding:4px" />
              <button id="sendmsg-${uid}" style="padding:4px 8px">💬</button>
            </div>
          </div>
        `;

        if (!markersRef.current[uid]) {
          const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(
            createPopupHtml(u.name, u.lastActive)
          );
          const marker = new mapboxgl.Marker({ color: "blue" })
            .setLngLat([u.lng, u.lat])
            .setPopup(popup)
            .addTo(map);

          popup.on("open", () => {
            const pingBtn = document.getElementById(`ping-${uid}`);
            const msgInput = document.getElementById(`msg-${uid}`);
            const sendBtn = document.getElementById(`sendmsg-${uid}`);

            if (pingBtn && !pingBtn.dataset.bound) {
              pingBtn.dataset.bound = "1";
              pingBtn.onclick = (e) => {
                e.stopPropagation();
                sendPing(uid, "");
              };
            }
            if (sendBtn && msgInput && !sendBtn.dataset.bound) {
              sendBtn.dataset.bound = "1";
              sendBtn.onclick = (e) => {
                e.stopPropagation();
                const txt = msgInput.value.trim();
                if (!txt) return;
                sendPing(uid, txt);
                msgInput.value = ""; // ← vyčistit input po odeslání
              };
            }
          });

          markersRef.current[uid] = {
            marker,
            popup,
            lastName: u.name || "",
          };
        } else {
          // jen posunout marker (HTML popupu nesahejte, aby se nám neztratil text)
          markersRef.current[uid].marker.setLngLat([u.lng, u.lat]);

          // pokud se změnilo jméno → znovu nastavíme HTML a rebindneme handlers
          const prev = markersRef.current[uid].lastName;
          const curr = u.name || "";
          if (prev !== curr) {
            markersRef.current[uid].lastName = curr;
            markersRef.current[uid].popup.setHTML(
              createPopupHtml(curr, u.lastActive)
            );
            markersRef.current[uid].popup.on("open", () => {
              const pingBtn = document.getElementById(`ping-${uid}`);
              const msgInput = document.getElementById(`msg-${uid}`);
              const sendBtn = document.getElementById(`sendmsg-${uid}`);
              if (pingBtn && !pingBtn.dataset.bound) {
                pingBtn.dataset.bound = "1";
                pingBtn.onclick = (e) => {
                  e.stopPropagation();
                  sendPing(uid, "");
                };
              }
              if (sendBtn && msgInput && !sendBtn.dataset.bound) {
                sendBtn.dataset.bound = "1";
                sendBtn.onclick = (e) => {
                  e.stopPropagation();
                  const txt = msgInput.value.trim();
                  if (!txt) return;
                  sendPing(uid, txt);
                  msgInput.value = "";
                };
              }
            });
          }
        }
      });

      // odeber markery, které v DB už nejsou
      Object.keys(markersRef.current).forEach((uid) => {
        if (!data[uid]) {
          markersRef.current[uid].marker.remove();
          delete markersRef.current[uid];
        }
      });
    });

    return () => unsub();
  }, [map, userId, db]);

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
          style={{ padding: "6px 8px", minWidth: 180, border: "1px solid #ddd", borderRadius: 6 }}
        />
        <button onClick={saveName} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd" }}>
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
    </div>
  );
}
