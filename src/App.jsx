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
  query,
  limitToLast,
} from "firebase/database";
import {
  getStorage,
  ref as sRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

/* ========= Mapbox ========= */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ========= Firebase (dle tebe) ========= */
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
const db = getDatabase(app);
const storage = getStorage(app);

/* ========= Nastavení ========= */
const HEARTBEAT_MS = 20_000;
const PING_SOUND_URL =
  "https://notificationsounds.com/storage/sounds/file-sounds-1150-event.mp3";

/* ========= Pomocné funkce ========= */
const conversationId = (a, b) => [a, b].sort().join("_");

const timeAgo = (ts) => {
  if (!ts) return "neznámo";
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return "před pár sekundami";
  const m = Math.floor(s / 60);
  if (m < 60) return před ${m} min;
  const h = Math.floor(m / 60);
  if (h < 24) return před ${h} h;
  const d = Math.floor(h / 24);
  return před ${d} dny;
};

const haversineKm = (a, b) => {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(sa));
};

/* ========= UI komponenty ========= */
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

function ChatModal({ me, peer, messages, onClose, onSend }) {
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
      onClick={onClose}
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
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            padding: "10px 12px",
            borderBottom: "1px solid #eee",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {peer.photoUrl && (
              <img
                src={peer.photoUrl}
                alt="pfp"
                style={{ width: 28, height: 28, borderRadius: "50%" }}
              />
            )}
            <div>
              <b>{peer.name || "Uživatel"}</b>{" "}
              <small style={{ color: "#777" }}>
                {peer.online ? "🟢 online" : ⚪ offline (${timeAgo(peer.lastActive)})}
              </small>
            </div>
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

function SettingsModal({
  name,
  setName,
  onSaveName,
  soundEnabled,
  onEnableSound,
  onClose,
  photoUrl,
  onFilePicked,
}) {
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
      onClick={onClose}
    >
      <div
        style={{
          width: "min(92vw, 420px)",
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 10px 30px rgba(0,0,0,.25)",
          padding: 14,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <b>Nastavení</b>
          <button
            onClick={onClose}
            style={{ border: "1px solid #ddd", borderRadius: 8, padding: "4px 8px" }}
          >
            ✕ Zavřít
          </button>
        </div>

        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <img
            src={photoUrl || "https://via.placeholder.com/64?text=PF"}
            alt="pfp"
            style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover" }}
          />
          <div>
            <input
              type="file"
              accept="image/*"
              onChange={onFilePicked}
              style={{ marginBottom: 6 }}
            />
            <div style={{ fontSize: 12, color: "#666" }}>
              Nahraj fotku (čtverec vypadá nejlíp).
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tvoje jméno"
            style={{ flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: "8px 10px" }}
          />
          <button
            onClick={onSaveName}
            style={{ border: "1px solid #ddd", borderRadius: 8, padding: "8px 12px" }}
          >
            Uložit
          </button>
        </div>

        <button
          onClick={onEnableSound}
          disabled={soundEnabled}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid #16a34a",
            background: soundEnabled ? "#16a34a" : "#fff",
            color: soundEnabled ? "#fff" : "#0f172a",
            cursor: soundEnabled ? "default" : "pointer",
          }}
        >
          {soundEnabled ? "✅ Zvuk povolen" : "🔊 Povolit zvuk"}
        </button>
      </div>
    </div>
  );
}

/* Odemknutí zvuku (WebAudio) + potvrzovací pípnutí */
function useAudioUnlock() {
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("soundEnabled") === "1"
  );
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
      localStorage.setItem("soundEnabled", "1");
    } catch (e) {
      console.warn("Audio unlock fail:", e);
      setSoundEnabled(false);
      localStorage.setItem("soundEnabled", "0");
    }
  };
  return { soundEnabled, enableSound };
}

/* ========= Hlavní App ========= */
export default function App() {
  const [map, setMap] = useState(null);
  const [userId] = useState(
    localStorage.getItem("userId") || Math.random().toString(36).slice(2, 11)
  );
  const [name, setName] = useState(localStorage.getItem("userName") || "Anonym");
  const [toast, setToast] = useState("");
  const [photoUrl, setPhotoUrl] = useState(
    localStorage.getItem("photoUrl") || ""
  );
  const [settingsOpen, setSettingsOpen] = useState(false);

  const { soundEnabled, enableSound } = useAudioUnlock();

  const positionRef = useRef({ lat: 50.08804, lng: 14.42076 });
  const myMarkerRef = useRef(null);
  const markersRef = useRef({}); // uid -> { marker, popup, domEl, lastName }
  const lastReadsRef = useRef({}); // peerUid -> ts (naposledy přečteno)
  const latestMsgTsByPeer = useRef({}); // peerUid -> ts (poslední zpráva v konverzaci)

  // vyhledání & filtr vzdálenosti
  const [filterName, setFilterName] = useState("");
  const [filterKm, setFilterKm] = useState(""); // prázdné = bez filtru

  // chat overlay
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPeer, setChatPeer] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);

  useEffect(() => {
    localStorage.setItem("userId", userId);
  }, [userId]);

  const showToast = (t, ms = 9000) => {
    setToast(t);
    if (ms > 0) setTimeout(() => setToast(""), ms);
  };

  /* ====== INIT map + moje poloha + prezence ====== */
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

        const meRef = ref(db, users/${userId});
        set(meRef, {
          name: name || "Anonym",
          lat: latitude,
          lng: longitude,
          lastActive: Date.now(),
          online: true,
          photoUrl: photoUrl || "",
        });
        onDisconnect(meRef).update({
          online: false,
          lastActive: Date.now(),
        });

        // vlastní marker
        const myPopup = new mapboxgl.Popup({ offset: 25 }).setHTML(
          <b>${name || "Anonym"}</b><br>${new Date().toLocaleTimeString()}
        );
        const myMarker = new mapboxgl.Marker({ color: "red" })
          .setLngLat([longitude, latitude])
          .setPopup(myPopup)
          .addTo(m);
        myMarkerRef.current = { marker: myMarker, popup: myPopup };

        // sledování polohy
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
              photoUrl: photoUrl || "",
            });
            if (myMarkerRef.current)
              myMarkerRef.current.marker.setLngLat([lng, lat]);
          },
          () => {},
          { enableHighAccuracy: true }
        );

        // heartbeat
        const hb = setInterval(() => {
          update(meRef, {
            name: name || "Anonym",
            lat: positionRef.current.lat,
            lng: positionRef.current.lng,
            lastActive: Date.now(),
            online: true,
            photoUrl: photoUrl || "",
          });
        }, HEARTBEAT_MS);

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

  /* ====== Načti lastReads (pro nepřečtené) ====== */
  useEffect(() => {
    const lrRef = ref(db, lastReads/${userId});
    return onValue(lrRef, (snap) => {
      lastReadsRef.current = snap.val() || {};
    });
  }, [userId]);

  /* ====== Poslech všech uživatelů + markery + poslední zprávy ====== */
  useEffect(() => {
    if (!map) return;

    const unsubUsers = onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      const now = Date.now();

      Object.entries(data).forEach(([uid, u]) => {
        if (!u || uid === userId) return;

        // filtrování podle jména
        if (filterName && !(u.name || "").toLowerCase().includes(filterName.toLowerCase())) {
          if (markersRef.current[uid]) {
            markersRef.current[uid].marker.remove();
            delete markersRef.current[uid];
          }
          return;
        }
        // filtr vzdálenosti
        if (filterKm) {
          const me = positionRef.current;
          const dist = haversineKm(me, { lat: u.lat, lng: u.lng });
          if (isFinite(dist) && dist > Number(filterKm)) {
            if (markersRef.current[uid]) {
              markersRef.current[uid].marker.remove();
              delete markersRef.current[uid];
            }
            return;
          }
        }

        const isOnline =
          u.online === true ||
          (typeof u.lastActive === "number" && now - u.lastActive <= 5 * 60 * 1000);

        // poslední zpráva v konverzaci – posloucháme 1 poslední položku
        const cid = conversationId(userId, uid);
        if (!latestMsgTsByPeer.current[uid]) {
          const lastMsgQ = query(ref(db, chats/${cid}), limitToLast(1));
          onValue(lastMsgQ, (s2) => {
            let ts = 0;
            s2.forEach((child) => {
              const val = child.val();
              ts = val?.ts || 0;
            });
            latestMsgTsByPeer.current[uid] = ts;
            // přebarvení markeru se udělá níže
          });
        }

        // marker DOM prvek (pro snadné barvení)
        const ensureMarker = () => {
          if (markersRef.current[uid]) return markersRef.current[uid];

          const el = document.createElement("div");
          el.style.width = "16px";
          el.style.height = "16px";
          el.style.borderRadius = "50%";
          el.style.boxShadow = "0 0 0 2px #fff, 0 2px 8px rgba(0,0,0,.25)";
          el.style.border = "1px solid rgba(0,0,0,.2)";

          const popupHtml = `
            <div style="min-width:210px">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                ${
                  u.photoUrl
                    ? <img src="${u.photoUrl}" alt="pfp" style="width:28px;height:28px;border-radius:50%;object-fit:cover" />
                    : ""
                }
                <div>
                  <b>${u.name || "Uživatel"}</b><br>
                  <small>${
                    isOnline
                      ? "🟢 online"
                      : ⚪ offline (naposledy ${timeAgo(u.lastActive)})
                  }</small>
                </div>
              </div>
              <div style="display:flex; gap:6px; margin-top:8px;">
                <button id="ping-${uid}" style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:8px;background:#f2f6ff">📩 Ping</button>
                <button id="chat-${uid}" style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:8px;background:#fff">💬 Chatovat</button>
              </div>
            </div>
          `;
          const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(popupHtml);
          const marker = new mapboxgl.Marker({ element: el })
            .setLngLat([u.lng, u.lat])
            .setPopup(popup)
            .addTo(map);

          popup.on("open", () => {
            const pingBtn = document.getElementById(ping-${uid});
            const chatBtn = document.getElementById(chat-${uid});
            if (pingBtn && !pingBtn.dataset.bound) {
              pingBtn.dataset.bound = "1";
              pingBtn.onclick = (e) => {
                e.stopPropagation();
                push(ref(db, pings/${uid}), {
                  kind: "ping",
                  from: userId,
                  fromName: name || "Anonym",
                  ts: Date.now(),
                });
                setToast("📩 Ping odeslán");
                setTimeout(() => setToast(""), 2500);
              };
            }
            if (chatBtn && !chatBtn.dataset.bound) {
              chatBtn.dataset.bound = "1";
              chatBtn.onclick = (e) => {
                e.stopPropagation();
                openChat(uid, u);
              };
            }
          });

          markersRef.current[uid] = {
            marker,
            popup,
            domEl: el,
            lastName: u.name || "",
          };
          return markersRef.current[uid];
        };

        const entry = ensureMarker();
        // posun markeru
        entry.marker.setLngLat([u.lng, u.lat]);

        // barva markeru podle nepřečtených
        const latestTs = latestMsgTsByPeer.current[uid] || 0;
        const lastRead = lastReadsRef.current?.[uid] || 0;
        const hasUnread = latestTs > lastRead;

        entry.domEl.style.background = hasUnread
          ? "#ff9800" // ORANŽOVÝ = nepřečtené
          : isOnline
          ? "#2563eb" // MODRÝ = online
          : "#9ca3af"; // ŠEDÝ = offline

        // změna jména → refresh popupu
        if ((u.name || "") !== entry.lastName) {
          entry.lastName = u.name || "";
          const html = `
            <div style="min-width:210px">
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
                ${
                  u.photoUrl
                    ? <img src="${u.photoUrl}" alt="pfp" style="width:28px;height:28px;border-radius:50%;object-fit:cover" />
                    : ""
                }
                <div>
                  <b>${u.name || "Uživatel"}</b><br>
                  <small>${
                    isOnline
                      ? "🟢 online"
                      : ⚪ offline (naposledy ${timeAgo(u.lastActive)})
                  }</small>
                </div>
              </div>
              <div style="display:flex; gap:6px; margin-top:8px;">
                <button id="ping-${uid}" style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:8px;background:#f2f6ff">📩 Ping</button>
                <button id="chat-${uid}" style="flex:1;padding:6px 8px;border:1px solid #ddd;border-radius:8px;background:#fff">💬 Chatovat</button>
              </div>
            </div>
          `;
          entry.popup.setHTML(html);
          entry.popup.on("open", () => {
            const pingBtn = document.getElementById(ping-${uid});
            const chatBtn = document.getElementById(chat-${uid});
            if (pingBtn && !pingBtn.dataset.bound) {
              pingBtn.dataset.bound = "1";
              pingBtn.onclick = (e) => {
                e.stopPropagation();
                push(ref(db, pings/${uid}), {
                  kind: "ping",
                  from: userId,
                  fromName: name || "Anonym",
                  ts: Date.now(),
                });
                setToast("📩 Ping odeslán");
                setTimeout(() => setToast(""), 2500);
              };
            }
            if (chatBtn && !chatBtn.dataset.bound) {
              chatBtn.dataset.bound = "1";
              chatBtn.onclick = (e) => {
                e.stopPropagation();
                openChat(uid, u);
              };
            }
          });
        }
      });

      // smazané z DB odstraníme z mapy
      Object.keys(markersRef.current).forEach((uid) => {
        if (!data[uid]) {
          markersRef.current[uid].marker.remove();
          delete markersRef.current[uid];
        }
      });
    });

    return () => unsubUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, filterName, filterKm, name, photoUrl]);

  /* ====== Příjem quick pingů (toast + zvuk) ====== */
  useEffect(() => {
    return onValue(ref(db, pings/${userId}), (snap) => {
      const all = snap.val() || {};
      const ids = Object.keys(all);
      if (!ids.length) return;

      ids.forEach((pid) => {
        const p = all[pid];
        const who = p.fromName ? ` od ${p.fromName}` : "";
        setToast(📩 Ping${who}!);
        setTimeout(() => setToast(""), 4000);
        if (soundEnabled) {
          try {
            const a = new Audio(PING_SOUND_URL);
            a.preload = "auto";
            a.play().catch(() => {});
          } catch {}
        }
        // nechávám v DB; klidně můžeš mazat, když chceš
        // remove(ref(db, pings/${userId}/${pid}));
      });
    });
  }, [userId, soundEnabled]);

  /* ====== CHAT ====== */
  const openChat = (peerUid, peerUserObj) => {
    const cid = conversationId(userId, peerUid);
    setChatPeer({
      uid: peerUid,
      name: peerUserObj?.name || "Uživatel",
      online: !!peerUserObj?.online,
      lastActive: peerUserObj?.lastActive,
      photoUrl: peerUserObj?.photoUrl || "",
    });
    setChatOpen(true);

    // historie
    onValue(ref(db, chats/${cid}), (snap) => {
      const data = snap.val() || {};
      const list = Object.entries(data)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([id, msg]) => ({ id, ...msg }));
      setChatMessages(list);

      // pípnutí při nové zprávě
      if (list.length && soundEnabled) {
        try {
          const a = new Audio(PING_SOUND_URL);
          a.preload = "auto";
          a.play().catch(() => {});
        } catch {}
      }

      // update lastRead
      const latestTs = list.length ? list[list.length - 1].ts || 0 : 0;
      if (latestTs) {
        update(ref(db, lastReads/${userId}), { [peerUid]: latestTs });
      }
    });
  };

  const closeChat = () => {
    setChatOpen(false);
    setChatPeer(null);
    setChatMessages([]);
  };

  const sendChatMessage = async (text) => {
    if (!chatPeer) return;
    const cid = conversationId(userId, chatPeer.uid);
    await push(ref(db, chats/${cid}), {
      from: userId,
      fromName: name || "Anonym",
      text,
      ts: Date.now(),
    });
  };

  /* ====== Horní lišta → po nastavení zmizí, nahradí ji ⚙️ ====== */
  const setupDone =
    (localStorage.getItem("userName") || "").trim().length > 0 &&
    localStorage.getItem("soundEnabled") === "1";

  const handleSaveName = () => {
    localStorage.setItem("userName", name);
    update(ref(db, users/${userId}), {
      name: name || "Anonym",
      lastActive: Date.now(),
      online: true,
      photoUrl: photoUrl || "",
    });
    setToast("✅ Jméno uloženo");
    setTimeout(() => setToast(""), 2500);
  };

  const handleFilePicked = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const path = profilePics/${userId}.jpg;
      const fileRef = sRef(storage, path);
      await uploadBytes(fileRef, f);
      const url = await getDownloadURL(fileRef);
      setPhotoUrl(url);
      localStorage.setItem("photoUrl", url);
      await update(ref(db, users/${userId}), {
        photoUrl: url,
        lastActive: Date.now(),
      });
      setToast("🖼️ Fotka nahrána");
      setTimeout(() => setToast(""), 2500);
    } catch (e) {
      console.warn(e);
      setToast("❌ Chyba při nahrávání fotky");
      setTimeout(() => setToast(""), 3500);
    }
  };

  return (
    <div>
      <Toast message={toast} />

      {/* horní lišta (pouze dokud není setup hotový) */}
      {!setupDone && (
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
            onClick={handleSaveName}
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
      )}

      {/* ⚙️ ozubené kolo (vždy) */}
      <button
        onClick={() => setSettingsOpen(true)}
        style={{
          position: "absolute",
          right: 12,
          top: 12,
          zIndex: 11,
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: "1px solid #ddd",
          background: "#fff",
          boxShadow: "0 2px 8px rgba(0,0,0,.15)",
          fontSize: 18,
        }}
        title="Nastavení"
      >
        ⚙️
      </button>

      {/* vyhledávání a filtr vzdálenosti */}
      <div
        style={{
          position: "absolute",
          left: 10,
          bottom: 10,
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
          value={filterName}
          onChange={(e) => setFilterName(e.target.value)}
          placeholder="Hledat jméno…"
          style={{ padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6 }}
        />
        <input
          value={filterKm}
          onChange={(e) => setFilterKm(e.target.value.replace(/[^\d.]/g, ""))}
          placeholder="Vzdál. km"
          style={{ width: 90, padding: "6px 8px", border: "1px solid #ddd", borderRadius: 6 }}
        />
        <button
          onClick={() => {
            setFilterName("");
            setFilterKm("");
          }}
          style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd" }}
        >
          Reset
        </button>
      </div>

      {/* mapa */}
      <div id="map" style={{ width: "100vw", height: "100vh" }} />

      {/* modaly */}
      {settingsOpen && (
        <SettingsModal
          name={name}
          setName={setName}
          onSaveName={handleSaveName}
          soundEnabled={soundEnabled}
          onEnableSound={enableSound}
          onClose={() => setSettingsOpen(false)}
          photoUrl={photoUrl}
          onFilePicked={handleFilePicked}
        />
      )}

      {chatOpen && (
        <ChatModal
          me={userId}
          peer={chatPeer}
          messages={chatMessages}
          onClose={closeChat}
          onSend={sendChatMessage}
        />
      )}
    </div>
  );
}
