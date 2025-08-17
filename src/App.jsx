// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  ref,
  set,
  update,
  onValue,
  remove,
  push,
  serverTimestamp,
} from "firebase/database";
import {
  ref as sref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";
import { db, auth, storage } from "./firebase.js";

/* ───────────────────────────────── Mapbox ────────────────────────────────── */

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

/* ───────────────────────────── Pomocné funkce ───────────────────────────── */

function pairIdOf(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
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

// Zmenší obrázek (delší strana max 800 px) → JPEG Blob
async function compressImage(file, maxDim = 800, quality = 0.8) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });

  const { width, height } = img;
  const ratio = Math.min(maxDim / Math.max(width, height), 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  return blob;
}

/* ─────────────────────────────── Komponenta ─────────────────────────────── */

export default function App() {
  const [map, setMap] = useState(null);
  const [me, setMe] = useState(null); // {uid, name, photoURL, soundEnabled}
  const [users, setUsers] = useState({});
  const [pairPings, setPairPings] = useState({}); // pairId -> {uid: time}
  const [soundEnabled, setSoundEnabled] = useState(() => {
    const stored = localStorage.getItem("soundEnabled");
    return stored === null ? true : stored === "1";
  });
  const [showSettings, setShowSettings] = useState(false);
  const [draftName, setDraftName] = useState(
    localStorage.getItem("userName") || ""
  );

  // chat
  const [openChatWith, setOpenChatWith] = useState(null); // uid protistrany
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatText, setChatText] = useState("");
  const chatUnsub = useRef(null);

  // map markers cache
  const markers = useRef({}); // uid -> marker
  const openBubble = useRef(null); // uid otevřené bubliny
  const centeredOnMe = useRef(false);

  // zvuk pomocí Web Audio API
  const audioCtx = useRef(null);

  useEffect(() => {
    audioCtx.current = new (window.AudioContext || window.webkitAudioContext)();
    const unlock = () => {
      if (audioCtx.current.state === "suspended") {
        audioCtx.current.resume();
      }
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("click", unlock);
    window.addEventListener("touchstart", unlock);
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  function beep(freq = 880, duration = 0.2) {
    if (!soundEnabled || !audioCtx.current) return;
    const ctx = audioCtx.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  useEffect(() => {
    const unlock = () => {
      pingSound.current.play().catch(() => {});
      pingSound.current.pause();
      msgSound.current.play().catch(() => {});
      msgSound.current.pause();
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
    window.addEventListener("click", unlock);
    window.addEventListener("touchstart", unlock);
    return () => {
      window.removeEventListener("click", unlock);
      window.removeEventListener("touchstart", unlock);
    };
  }, []);

  useEffect(() => {
    if (localStorage.getItem("soundEnabled") === null) {
      alert("Zvuk je ve výchozím stavu zapnut. Ikonou 🔇/🔊 jej můžeš přepnout.");
      localStorage.setItem("soundEnabled", "1");
    }
  }, []);

  /* ───────────────────────────── Auth + Me init ─────────────────────────── */

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      let u = user;
      if (!u) {
        const cred = await signInAnonymously(auth);
        u = cred.user;
      }
      const uid = u.uid;
      const name = localStorage.getItem("userName") || "Anonym";
      setMe({ uid, name });

      // Založ záznam uživatele – jen pokud ještě není
      const meRef = ref(db, `users/${uid}`);
      update(meRef, {
        name,
        lastActive: Date.now(),
        online: true,
      });

      // geolokace (watch)
      if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            update(meRef, {
              lat: latitude,
              lng: longitude,
              lastActive: Date.now(),
              online: true,
            });
          },
          (err) => {
            console.warn("Geolocation error", err);
          },
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
      }
    });
    return () => unsub();
  }, []);

  /* ───────────────────────────── Init mapy ──────────────────────────────── */

  useEffect(() => {
    if (map || !me) return;

    // Pokus o start u poslední pozice v DB (nebo Praha)
    const center = [14.42076, 50.08804];
    const m = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center,
      zoom: 13,
    });
    setMap(m);

    return () => m.remove();
  }, [me]);

  /* ───────────────────── Sledování /users a kreslení ───────────────────── */

  useEffect(() => {
    if (!map || !me) return;

    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      setUsers(data);

      // aktualizace / přidání markerů
      Object.entries(data).forEach(([uid, u]) => {
        if (!Number.isFinite(u.lat) || !Number.isFinite(u.lng)) {
          if (markers.current[uid]) {
            if (openBubble.current === uid) openBubble.current = null;
            markers.current[uid].remove();
            delete markers.current[uid];
          }
          return;
        }

        // styl a viditelnost podle stavu
        const isMe = uid === me.uid;
        const isOnline =
          u.online && u.lastActive && Date.now() - u.lastActive < 5 * 60_000;

        // skrýt z mapy uživatele, kteří jsou offline (zůstává pouze můj marker)
        if (!isOnline && !isMe) {
          if (markers.current[uid]) {
            if (openBubble.current === uid) openBubble.current = null;
            markers.current[uid].remove();
            delete markers.current[uid];
          }
          return;
        }

        const color = isMe ? "red" : "#147af3";
        const draggable = false;

        if (!markers.current[uid]) {
          const wrapper = document.createElement("div");
          wrapper.className = "marker-wrapper";
          const avatar = document.createElement("div");
          avatar.className = "marker-avatar";
          setMarkerAppearance(avatar, u.photoURL, color);
          wrapper.appendChild(avatar);

          const bubble = getBubbleContent({
            uid,
            name: u.name || "Anonym",
            photoURL: u.photoURL,
            lastActive: u.lastActive,
          });
          wrapper.appendChild(bubble);

          avatar.addEventListener("click", (e) => {
            e.stopPropagation();
            toggleBubble(uid);
          });

          const mk = new mapboxgl.Marker({ element: wrapper, draggable, anchor: "bottom" })
            .setLngLat([u.lng, u.lat])
            .addTo(map);

          markers.current[uid] = mk;
        } else {
          if (isOnline) {
            markers.current[uid].setLngLat([u.lng, u.lat]);
          }

          const wrapper = markers.current[uid].getElement();
          const avatar = wrapper.querySelector(".marker-avatar");
          setMarkerAppearance(avatar, u.photoURL, color);

          const oldBubble = wrapper.querySelector(".marker-bubble");
          const newBubble = getBubbleContent({
            uid,
            name: u.name || "Anonym",
            photoURL: u.photoURL,
            lastActive: u.lastActive,
          });
          wrapper.replaceChild(newBubble, oldBubble);
          if (wrapper.classList.contains("active")) {
            wireBubbleButtons(uid);
          }
        }
      });

      // odmazat marker, když uživatel zmizel z DB
      Object.keys(markers.current).forEach((uid) => {
        if (!data[uid]) {
          if (openBubble.current === uid) openBubble.current = null;
          markers.current[uid].remove();
          delete markers.current[uid];
        }
      });
    });

    return () => unsub();
  }, [map, me]);

  useEffect(() => {
    if (!map || !me || centeredOnMe.current) return;
    const u = users[me.uid];
    if (
      u &&
      Number.isFinite(u.lat) &&
      Number.isFinite(u.lng)
    ) {
      map.setCenter([u.lng, u.lat]);
      centeredOnMe.current = true;
    }
  }, [map, me, users]);

  useEffect(() => {
    if (!map) return;
    const handler = () => {
      if (openBubble.current) {
        closeBubble(openBubble.current);
        openBubble.current = null;
      }
    };
    map.on("click", handler);
    return () => map.off("click", handler);
  }, [map]);

  // sledování vzájemných pingů
  useEffect(() => {
    if (!me) return;
    const pairRef = ref(db, "pairPings");
    const unsub = onValue(pairRef, (snap) => {
      setPairPings(snap.val() || {});
    });
    return () => unsub();
  }, [me]);

  // aktualizace bublin při změně pingů nebo uživatelů
  useEffect(() => {
    Object.entries(markers.current).forEach(([uid, mk]) => {
      const u = users[uid];
      if (!u) return;
      const wrapper = mk.getElement();
      const oldBubble = wrapper.querySelector(".marker-bubble");
      const newBubble = getBubbleContent({
        uid,
        name: u.name || "Anonym",
        photoURL: u.photoURL,
        lastActive: u.lastActive,
      });
      if (oldBubble) {
        wrapper.replaceChild(newBubble, oldBubble);
      } else {
        wrapper.appendChild(newBubble);
      }
      if (wrapper.classList.contains("active")) {
        wireBubbleButtons(uid);
      }

      const isMe = me && uid === me.uid;
      const isOnline =
        u.online && u.lastActive && Date.now() - u.lastActive < 5 * 60_000;

      if (!isOnline && !isMe) {
        if (openBubble.current === uid) openBubble.current = null;
        mk.remove();
        delete markers.current[uid];
        return;
      }

      const color = isMe ? "red" : "#147af3";
      const avatar = wrapper.querySelector(".marker-avatar");
      setMarkerAppearance(avatar, u.photoURL, color);
    });
  }, [pairPings, users, me]);

  function isSafeUrl(url) {
    try {
      const u = new URL(url, window.location.origin);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  function setMarkerAppearance(el, photoURL, color) {
    if (photoURL && isSafeUrl(photoURL)) {
      el.style.backgroundImage = `url(${photoURL})`;
      el.style.backgroundColor = "";
    } else {
      el.style.backgroundImage = "";
      el.style.backgroundColor = color;
    }
  }

  function toggleBubble(uid) {
    if (openBubble.current && openBubble.current !== uid) {
      closeBubble(openBubble.current);
    }
    const mk = markers.current[uid];
    if (!mk) return;
    const el = mk.getElement();
    const active = el.classList.contains("active");
    if (active) {
      el.classList.remove("active");
      openBubble.current = null;
    } else {
      el.classList.add("active");
      openBubble.current = uid;
      wireBubbleButtons(uid);
    }
  }

  function closeBubble(uid) {
    const mk = markers.current[uid];
    if (!mk) return;
    mk.getElement().classList.remove("active");
  }

  function getBubbleContent({ uid, name, photoURL, lastActive }) {
    const meVsOther = uid === me.uid;
    const pid = pairIdOf(me.uid, uid);
    const pair = pairPings[pid] || {};
    const canChat = pair[me.uid] && pair[uid];
    const last = lastActive ? timeAgo(lastActive) : "neznámo";

    const root = document.createElement("div");
    root.className = "marker-bubble";
    root.addEventListener("click", (e) => e.stopPropagation());

    let img;
    if (photoURL && isSafeUrl(photoURL)) {
      img = document.createElement("img");
      img.src = photoURL;
      img.className = "bubble-img";
    } else {
      img = document.createElement("div");
      img.className = "bubble-img empty";
    }
    root.appendChild(img);

    const bottom = document.createElement("div");
    bottom.className = "bubble-bottom";

    const nameDiv = document.createElement("div");
    nameDiv.className = "bubble-name";
    nameDiv.textContent = name + (meVsOther ? " (ty)" : "");
    bottom.appendChild(nameDiv);

    const infoDiv = document.createElement("div");
    infoDiv.className = "bubble-info";
    infoDiv.textContent = meVsOther ? "teď" : `Naposledy online: ${last}`;
    bottom.appendChild(infoDiv);

    if (!meVsOther) {
      const actions = document.createElement("div");
      actions.className = "bubble-actions";
      const pingBtn = document.createElement("button");
      pingBtn.id = `btnPing_${uid}`;
      pingBtn.textContent = "📩 Ping";
      actions.appendChild(pingBtn);
      if (canChat) {
        const chatBtn = document.createElement("button");
        chatBtn.id = `btnChat_${uid}`;
        chatBtn.textContent = "💬 Chat";
        actions.appendChild(chatBtn);
      }
      bottom.appendChild(actions);
    }

    root.appendChild(bottom);

    return root;
  }

  function wireBubbleButtons(uid) {
    const mk = markers.current[uid];
    if (!mk) return;
    const el = mk.getElement();
    const pingBtn = el.querySelector(`#btnPing_${uid}`);
    const chatBtn = el.querySelector(`#btnChat_${uid}`);
    if (pingBtn)
      pingBtn.onclick = (e) => {
        e.stopPropagation();
        sendPing(uid);
      };
    if (chatBtn)
      chatBtn.onclick = (e) => {
        e.stopPropagation();
        openChat(uid);
      };
  }

  /* ─────────────────────────────── Ping / zvuk ──────────────────────────── */

  useEffect(() => {
    if (!me) return;
    const inboxRef = ref(db, `pings/${me.uid}`);
    const unsub = onValue(inboxRef, (snap) => {
      const data = snap.val();
      if (!data) return;

      // každé dítě je ping od někoho
      Object.entries(data).forEach(([fromUid, obj]) => {
        // přehraj zvuk a smaž ping
        if (soundEnabled) {
          beep(880);
        }
        remove(ref(db, `pings/${me.uid}/${fromUid}`));
      });
    });
    return () => unsub();
  }, [me, soundEnabled]);

  async function sendPing(toUid) {
    if (!me) return;
    await set(ref(db, `pings/${toUid}/${me.uid}`), {
      time: serverTimestamp(),
    });
    const pid = pairIdOf(me.uid, toUid);
    await set(ref(db, `pairPings/${pid}/${me.uid}`), serverTimestamp());
    // také krátké pípnutí odesílateli, aby věděl, že kliknul
    if (soundEnabled) {
      beep(880);
    }
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    localStorage.setItem("soundEnabled", next ? "1" : "0");
    if (next) {
      audioCtx.current?.resume();
    }
  }

  /* ─────────────────────────────── Chat vlákna ──────────────────────────── */

  useEffect(() => {
    if (!me || !openChatWith) {
      setChatMsgs([]);
      return;
    }
    const pid = pairIdOf(me.uid, openChatWith);
    const msgsRef = ref(db, `messages/${pid}`);
    const unsub = onValue(msgsRef, (snap) => {
      const data = snap.val() || {};
      const arr = Object.entries(data)
        .map(([id, m]) => ({ id, ...m }))
        .sort((a, b) => (a.time || 0) - (b.time || 0));
      setChatMsgs(arr);
      const last = arr[arr.length - 1];
      if (last && last.from !== me.uid && soundEnabled) {
        beep(660);
      }
    });
    chatUnsub.current = unsub;
    return () => {
      chatUnsub.current?.();
      chatUnsub.current = null;
    };
  }, [openChatWith, me, soundEnabled]);

  function openChat(uid) {
    if (!me) return;
    const pid = pairIdOf(me.uid, uid);
    const pair = pairPings[pid] || {};
    if (!(pair[me.uid] && pair[uid])) {
      alert("Chat je dostupný až po vzájemném pingnutí.");
      return;
    }
    setOpenChatWith(uid);
  }

  async function sendMessage() {
    const to = openChatWith;
    if (!me || !to || !chatText.trim()) return;
    const pid = pairIdOf(me.uid, to);
    await push(ref(db, `messages/${pid}`), {
      from: me.uid,
      to,
      text: chatText.trim(),
      time: Date.now(),
    });
    setChatText("");
  }

  /* ───────────────────────────── Nastavení / profil ─────────────────────── */

  useEffect(() => {
    if (!me) return;
    const u = users[me.uid];
    if (u && u.name && !draftName) {
      setDraftName(u.name);
      localStorage.setItem("userName", u.name);
    }
  }, [users, me]); // načtení jména z DB při prvním fetchi

  async function saveProfile() {
    if (!me) return;
    const meRef = ref(db, `users/${me.uid}`);
    await update(meRef, {
      name: draftName || "Anonym",
      lastActive: Date.now(),
    });
    localStorage.setItem("userName", draftName || "Anonym");
    setShowSettings(false);
  }

  async function onPickAvatar(e) {
    if (!me) return;
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const small = await compressImage(file, 800, 0.8);
      const dest = sref(storage, `avatars/${me.uid}.jpg`);
      await uploadBytes(dest, small, { contentType: "image/jpeg" });
      const url = await getDownloadURL(dest);
      await update(ref(db, `users/${me.uid}`), {
        photoURL: url,
        lastActive: Date.now(),
      });
      alert("🖼️ Fotka nahrána.");
    } catch (e2) {
      console.error(e2);
      alert("Nahrání fotky se nezdařilo – zkus menší obrázek.");
    } finally {
      e.target.value = "";
    }
  }

  /* ──────────────────────────────── Render UI ───────────────────────────── */

  return (
    <div>
      {/* Plovoucí tlačítka – jen ozubené kolo, ostatní v modalu */}
      <div
        style={{
          position: "absolute",
          bottom: 10,
          right: 10,
          zIndex: 10,
          display: "flex",
          gap: 8,
        }}
      >
        <button
          onClick={toggleSound}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
          }}
          title={soundEnabled ? "Vypnout zvuk" : "Zapnout zvuk"}
        >
          {soundEnabled ? "🔊" : "🔇"}
        </button>
        <button
          onClick={() => setShowSettings(true)}
          style={{
            padding: "8px 10px",
            borderRadius: 10,
            border: "1px solid #ddd",
            background: "#fff",
            cursor: "pointer",
          }}
          title="Nastavení"
        >
          ⚙️
        </button>
      </div>

      {/* Mapa */}
      <div id="map" style={{ width: "100vw", height: "100vh" }} />

      {/* Chat panel */}
      {openChatWith && (
        <div
          style={{
            position: "absolute",
            right: 12,
            bottom: 12,
            width: 320,
            maxHeight: 420,
            background: "#fff",
            border: "1px solid #ddd",
            borderRadius: 12,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            zIndex: 20,
          }}
        >
          <div
            style={{
              padding: 10,
              borderBottom: "1px solid #eee",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontWeight: 600,
            }}
          >
            Chat
            <button
              onClick={() => setOpenChatWith(null)}
              style={{ border: "none", background: "transparent", cursor: "pointer" }}
            >
              ✖
            </button>
          </div>
          <div style={{ padding: 10, gap: 6, display: "flex", flexDirection: "column", overflowY: "auto" }}>
            {chatMsgs.map((m) => {
              const mine = m.from === me?.uid;
              return (
                <div
                  key={m.id}
                  style={{
                    alignSelf: mine ? "flex-end" : "flex-start",
                    background: mine ? "#e6f0ff" : "#f2f2f2",
                    borderRadius: 10,
                    padding: "6px 8px",
                    maxWidth: "80%",
                  }}
                >
                  <div style={{ fontSize: 12, color: "#666" }}>
                    {new Date(m.time || Date.now()).toLocaleTimeString()}
                  </div>
                  <div>{m.text}</div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: 8, borderTop: "1px solid #eee", display: "flex", gap: 6 }}>
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Napiš zprávu…"
              style={{
                flex: 1,
                border: "1px solid #ddd",
                borderRadius: 8,
                padding: "8px 10px",
              }}
            />
            <button
              onClick={sendMessage}
              style={{
                padding: "8px 12px",
                border: "1px solid #ddd",
                borderRadius: 8,
                background: "#fff",
                cursor: "pointer",
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}

      {/* Nastavení (modal) */}
      {showSettings && (
        <div
          onClick={() => setShowSettings(false)}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 30,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 360,
              background: "#fff",
              borderRadius: 14,
              padding: 16,
              boxShadow: "0 10px 30px rgba(0,0,0,.15)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 10, fontSize: 16 }}>
              Nastavení
            </div>

            <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
              Jméno
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                style={{
                  display: "block",
                  width: "100%",
                  border: "1px solid #ddd",
                  borderRadius: 8,
                  padding: "8px 10px",
                  marginTop: 5,
                }}
              />
            </label>

            <div style={{ marginBottom: 10 }}>
              <button
                onClick={toggleSound}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: soundEnabled ? "#e8fff1" : "#fff",
                  cursor: "pointer",
                }}
              >
                {soundEnabled ? "🔊 Zvuk povolen" : "🔈 Povolit zvuk"}
              </button>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <input
                id="fileAvatar"
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={onPickAvatar}
              />
              <button
                onClick={() => document.getElementById("fileAvatar")?.click()}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                📷 Přidat / změnit fotku
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                onClick={() => setShowSettings(false)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid #ddd",
                  background: "#fff",
                  cursor: "pointer",
                }}
              >
                Zavřít
              </button>
              <button
                onClick={saveProfile}
                style={{
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "1px solid #147af3",
                  background: "#147af3",
                  color: "#fff",
                  cursor: "pointer",
                }}
              >
                Uložit
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
