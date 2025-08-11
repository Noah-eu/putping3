import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase, ref, set, update, onValue, push, off
} from "firebase/database";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  getStorage, ref as sref, uploadBytes, getDownloadURL
} from "firebase/storage";

/* ============ KONFIGURACE ============ */

mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

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

/* ============ STYLY (FAB opraven) ============ */

const styles = {
  map: { width: "100vw", height: "100vh" },
  fab: {
    position: "absolute",
    bottom: "calc(env(safe-area-inset-bottom, 0px) + 96px)",
    right: "calc(env(safe-area-inset-right, 0px) + 16px)",
    width: 56,
    height: 56,
    borderRadius: "50%",
    background: "#111",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
    cursor: "pointer",
    zIndex: 1000,
    fontSize: 22,
  },
  sheet: {
    position: "absolute",
    right: "calc(env(safe-area-inset-right, 0px) + 12px)",
    bottom: "calc(env(safe-area-inset-bottom, 0px) + 160px)",
    width: 320,
    maxWidth: "calc(100vw - 24px)",
    background: "#fff",
    borderRadius: 16,
    boxShadow: "0 16px 40px rgba(0,0,0,0.25)",
    padding: 16,
    zIndex: 1000,
  },
  btn: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    background: "#111",
    color: "#fff",
    border: 0,
    marginTop: 8,
    fontSize: 15,
  },
  secondary: {
    width: "100%",
    padding: "10px 12px",
    borderRadius: 10,
    background: "#f4f4f5",
    color: "#111",
    border: 0,
    marginTop: 8,
    fontSize: 15,
  },
  list: { marginTop: 8, maxHeight: 200, overflowY: "auto" },
  chatBox: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
    background: "#fff",
    borderRadius: 12,
    boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
    padding: 10,
    zIndex: 1000,
  },
  msgList: { maxHeight: 220, overflowY: "auto", marginBottom: 8 },
  msg: (me) => ({
    background: me ? "#111" : "#f4f4f5",
    color: me ? "#fff" : "#111",
    padding: "8px 10px",
    borderRadius: 10,
    margin: "6px 0",
    alignSelf: me ? "flex-end" : "flex-start",
    maxWidth: "80%",
  }),
};

/* ============ POMOCNÉ ============ */

const TTL_INACTIVE_MS = 5 * 60 * 1000; // po 5 min šedý (poslední známá poloha)

function timeAgo(ts) {
  if (!ts) return "neznámo";
  const now = Date.now();
  const diff = Math.max(0, Math.floor((now - ts) / 1000));
  if (diff < 60) return `před ${diff} s`;
  const min = Math.floor(diff / 60);
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.floor(h / 24);
  return `před ${d} dny`;
}

const convId = (a, b) => [a, b].sort().join("_");

/* ============ APLIKACE ============ */

export default function App() {
  const [user, setUser] = useState(null);           // {uid, name, photoUrl}
  const [name, setName] = useState(localStorage.getItem("name") || "Anonymní uživatel");
  const [soundOn, setSoundOn] = useState(localStorage.getItem("soundOn") === "1");
  const [showSheet, setShowSheet] = useState(false);
  const [map, setMap] = useState(null);
  const markers = useRef({}); // uid -> Marker
  const [chats, setChats] = useState([]); // [{uid, name, photoUrl, last}]
  const [openChatWith, setOpenChatWith] = useState(null); // uid
  const [messages, setMessages] = useState([]); // aktuální vlákno
  const fileInput = useRef(null);
  const pingSound = useRef(new Audio("https://cdn.freesound.org/previews/341/341695_6261199-lq.mp3"));

  // Přihlášení anonymně
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        const cred = await signInAnonymously(auth);
        handleSignedIn(cred.user);
      } else {
        handleSignedIn(u);
      }
    });
    return () => unsub();
    // eslint-disable-next-line
  }, []);

  // Po přihlášení
  const handleSignedIn = async (u) => {
    const uid = u.uid;
    const meRef = ref(db, `users/${uid}`);

    // První zápis + každých 15 s refresh polohy/online
    const initLocation = () =>
      new Promise((resolve) => {
        if (!("geolocation" in navigator)) return resolve(null);
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 10000 }
        );
      });

    const loc = await initLocation();
    await set(meRef, {
      name,
      photoUrl: user?.photoUrl || "",
      lastActive: Date.now(),
      ...(loc ? { lat: loc.lat, lng: loc.lng } : {}),
    });

    // keepalive
    setInterval(async () => {
      const p = await initLocation();
      await update(meRef, {
        lastActive: Date.now(),
        ...(p ? { lat: p.lat, lng: p.lng } : {}),
        name,
      });
    }, 15000);

    setUser({ uid, name, photoUrl: "" });
  };

  // Mapa
  useEffect(() => {
    if (map) return;
    const m = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.42076, 50.08804],
      zoom: 5,
    });
    setMap(m);
  }, [map]);

  // Uživatelé → markery
  useEffect(() => {
    if (!map) return;
    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const all = snap.val() || {};
      const now = Date.now();

      // přidej/aktualizuj markery
      Object.entries(all).forEach(([uid, u]) => {
        if (!u.lat || !u.lng) return;
        const inactive = !u.lastActive || now - u.lastActive > TTL_INACTIVE_MS;
        const color = inactive ? "#9ca3af" : uid === user?.uid ? "#ef4444" : "#2563eb";

        // element s avatar/barevný kruh
        const el = document.createElement("div");
        el.style.width = "32px";
        el.style.height = "32px";
        el.style.borderRadius = "50%";
        el.style.boxShadow = "0 0 0 2px white, 0 4px 12px rgba(0,0,0,.25)";
        el.style.background = color;

        if (u.photoUrl) {
          el.style.background = `url("${u.photoUrl}") center/cover no-repeat`;
          el.style.border = `2px solid ${inactive ? "#9ca3af" : color}`;
        }

        if (!markers.current[uid]) {
          const mk = new mapboxgl.Marker({ element: el })
            .setLngLat([u.lng, u.lat])
            .setPopup(
              new mapboxgl.Popup({ offset: 18 }).setHTML(`
                <div style="min-width:180px">
                  <div style="font-weight:600">${u.name || "Anonym"} ${inactive ? "(offline)" : ""}</div>
                  <div style="font-size:12px;color:#555">naposledy: ${timeAgo(u.lastActive)}</div>
                  <div style="display:flex;gap:8px;margin-top:8px">
                    <button id="ping-${uid}" style="flex:1;padding:6px 8px;border-radius:8px;border:0;background:#111;color:#fff">📩 Ping</button>
                    <button id="chat-${uid}" style="flex:1;padding:6px 8px;border-radius:8px;border:0;background:#f4f4f5">💬 Chat</button>
                  </div>
                </div>
              `)
            )
            .addTo(map);

          mk.getElement().addEventListener("click", () => {
            // nic – řešíme přes id tlačítek v on('open')
          });

          mk.getPopup().on("open", () => {
            const pingBtn = document.getElementById(`ping-${uid}`);
            const chatBtn = document.getElementById(`chat-${uid}`);
            if (pingBtn)
              pingBtn.onclick = () => sendPing(uid);
            if (chatBtn)
              chatBtn.onclick = () => openChat(uid);
          });

          markers.current[uid] = mk;
        } else {
          markers.current[uid].setLngLat([u.lng, u.lat]);
          // vyměň element kvůli barvě/avat.
          const old = markers.current[uid].getElement();
          old.replaceWith(el);
          markers.current[uid]._element = el;
        }
      });

      // smaž markery kteří zmizeli
      Object.keys(markers.current).forEach((uid) => {
        if (!all[uid]) {
          markers.current[uid].remove();
          delete markers.current[uid];
        }
      });
    });
    return () => unsub();
  }, [map, user]);

  // PING – když A pošle B a B pošle zpět A, rovnou otevřeme chat
  const sendPing = async (toUid) => {
    if (!user) return;
    await set(ref(db, `pings/${toUid}/${user.uid}`), {
      from: user.uid,
      ts: Date.now(),
    });
  };

  // Sleduj pings → když přijde ping a já už jsem poslal jemu, otevře se chat
  useEffect(() => {
    if (!user) return;
    const pRef = ref(db, `pings/${user.uid}`);
    const unsub = onValue(pRef, async (snap) => {
      const items = snap.val() || {};
      const senders = Object.keys(items);
      if (senders.length && soundOn) {
        // pokus o zvuk
        pingSound.current.play().catch(() => {});
      }
      // pokud jsme si už navzájem pingli → automaticky chat
      for (const from of senders) {
        const theyPingedMe = true;
        const iPingedThemSnap = await new Promise((r) =>
          onValue(ref(db, `pings/${from}/${user.uid}`), (s) => {
            off(ref(db, `pings/${from}/${user.uid}`));
            r(s.exists());
          })
        );
        if (theyPingedMe && iPingedThemSnap) {
          openChat(from);
        }
      }
    });
    return () => unsub();
  }, [user, soundOn]);

  /* ====== CHAT ====== */

  const openChat = (otherUid) => {
    if (!user) return;
    setOpenChatWith(otherUid);
    const id = convId(user.uid, otherUid);
    const cRef = ref(db, `conversations/${id}`);
    onValue(cRef, (snap) => {
      const msgs = Object.values(snap.val() || {}).sort((a, b) => (a.ts || 0) - (b.ts || 0));
      setMessages(msgs);
    });
  };

  const sendMessage = async (text) => {
    if (!text.trim() || !user || !openChatWith) return;
    const id = convId(user.uid, openChatWith);
    await push(ref(db, `conversations/${id}`), {
      from: user.uid,
      text: text.trim(),
      ts: Date.now(),
    });
  };

  // Seznam chatů (lidé, se kterými jsem si psal) – jednoduchý build z users + conversations indexu
  useEffect(() => {
    if (!user) return;
    const idxRef = ref(db, "conversations");
    const uRef = ref(db, "users");
    const unsub = onValue(idxRef, (allConvSnap) => {
      const allConv = allConvSnap.val() || {};
      const mine = [];
      Object.entries(allConv).forEach(([cid, msgs]) => {
        const [a, b] = cid.split("_");
        if (a === user.uid || b === user.uid) {
          const last = Object.values(msgs).reduce((acc, m) => (!acc || (m.ts || 0) > acc.ts ? m : acc), null);
          mine.push({ cid, other: a === user.uid ? b : a, last });
        }
      });
      // dosypat jména/fotky
      onValue(uRef, (us) => {
        const mapU = us.val() || {};
        setChats(
          mine
            .map((c) => ({
              uid: c.other,
              name: mapU[c.other]?.name || "Anonym",
              photoUrl: mapU[c.other]?.photoUrl || "",
              last: c.last,
            }))
            .sort((x, y) => (y.last?.ts || 0) - (x.last?.ts || 0))
        );
      });
    });
    return () => unsub();
  }, [user]);

  /* ====== SETTINGS (⚙️) ====== */

  const saveName = async () => {
    if (!user) return;
    localStorage.setItem("name", name);
    await update(ref(db, `users/${user.uid}`), { name });
    alert("Jméno uloženo.");
  };

  const toggleSound = async () => {
    try {
      // krátký zvuk – vytvoří „user gesture“
      await pingSound.current.play();
      pingSound.current.pause();
      pingSound.current.currentTime = 0;
      localStorage.setItem("soundOn", soundOn ? "0" : "1");
      setSoundOn((s) => !s);
    } catch {
      alert("Prohlížeč odmítl přehrát zvuk – zkus klepnout znovu.");
    }
  };

  const pickPhoto = () => fileInput.current?.click();

  const onFilePicked = async (e) => {
    if (!user) return;
    const f = e.target.files?.[0];
    if (!f) return;
    // lehká komprese na klientu (mobil to zvládá) – necháme to jednoduché: nahrát přímo
    const path = `avatars/${user.uid}/${Date.now()}_${f.name}`;
    const refS = sref(storage, path);
    await uploadBytes(refS, f, { contentType: f.type });
    const url = await getDownloadURL(refS);
    await update(ref(db, `users/${user.uid}`), { photoUrl: url });
    setUser((u) => ({ ...u, photoUrl: url }));
    alert("Fotka aktualizována.");
  };

  return (
    <>
      <div id="map" style={styles.map} />

      {/* ⚙️ */}
      <div style={styles.fab} onClick={() => setShowSheet((s) => !s)} aria-label="Nastavení">
        ⚙️
      </div>

      {showSheet && (
        <div style={styles.sheet}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Nastavení</div>

          <label style={{ fontSize: 12, color: "#555" }}>Jméno</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #e5e7eb", marginTop: 4 }}
          />
          <button style={styles.btn} onClick={saveName}>Uložit</button>

          <button style={styles.secondary} onClick={toggleSound}>
            {soundOn ? "🔊 Zvuk povolen" : "🔇 Povolit zvuk"}
          </button>

          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: "none" }}
            onChange={onFilePicked}
          />
          <button style={styles.secondary} onClick={pickPhoto}>🖼️ Nahrát profilovou fotku</button>

          <div style={{ marginTop: 12, fontWeight: 700 }}>Chaty</div>
          <div style={styles.list}>
            {chats.length === 0 && <div style={{ color: "#666", fontSize: 14 }}>Zatím žádné konverzace.</div>}
            {chats.map((c) => (
              <div
                key={c.uid}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 6px",
                  borderBottom: "1px solid #eee",
                  cursor: "pointer",
                }}
                onClick={() => { setShowSheet(false); openChat(c.uid); }}
              >
                <div
                  style={{
                    width: 36, height: 36, borderRadius: "50%",
                    background: c.photoUrl ? `url("${c.photoUrl}") center/cover no-repeat` : "#ddd",
                    boxShadow: "0 0 0 2px #fff, 0 2px 8px rgba(0,0,0,.2)",
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{c.name}</div>
                  {c.last && <div style={{ fontSize: 12, color: "#666" }}>{c.last.text}</div>}
                </div>
                {c.last && <div style={{ fontSize: 12, color: "#666" }}>{timeAgo(c.last.ts)}</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* CHAT okno */}
      {openChatWith && (
        <ChatBox
          me={user?.uid}
          withUid={openChatWith}
          messages={messages}
          onClose={() => setOpenChatWith(null)}
          onSend={sendMessage}
        />
      )}
    </>
  );
}

/* ============ Chat UI ============ */

function ChatBox({ me, withUid, messages, onSend, onClose }) {
  const [text, setText] = useState("");
  const boxRef = useRef(null);

  useEffect(() => {
    // autoscroll
    if (boxRef.current) {
      boxRef.current.scrollTop = boxRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div style={styles.chatBox}>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 6 }}>
        <div style={{ fontWeight: 700 }}>Chat</div>
        <div style={{ marginLeft: "auto", cursor: "pointer" }} onClick={onClose}>✖</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, ...styles.msgList }} ref={boxRef}>
        {messages.map((m, i) => (
          <div key={i} style={styles.msg(m.from === me)}>{m.text}</div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Napiš zprávu…"
          style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              onSend(text);
              setText("");
            }
          }}
        />
        <button
          style={{ ...styles.btn, padding: "10px 16px", width: 90 }}
          onClick={() => { onSend(text); setText(""); }}
        >
          Odeslat
        </button>
      </div>
    </div>
  );
}
