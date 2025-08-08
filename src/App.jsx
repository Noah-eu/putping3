import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  push,
  onValue,
  update,
  serverTimestamp,
  onDisconnect
} from "firebase/database";

// ---------- MAPBOX ----------
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

// ---------- FIREBASE ----------
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
const db = getDatabase(app);

// ---------- Helpers ----------
function uid() {
  const existing = localStorage.getItem("uid");
  if (existing) return existing;
  const u = Math.random().toString(36).slice(2, 11);
  localStorage.setItem("uid", u);
  return u;
}
function threadId(a, b) {
  return a < b ? a + "" + b : b + "" + a;
}
function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "před pár sekundami";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return před ${min} min;
  const h = Math.floor(min / 60);
  if (h < 24) return před ${h} h;
  const d = Math.floor(h / 24);
  return před ${d} dny;
}

// ---------- Component ----------
export default function App() {
  const me = uid();

  // UI state
  const [map, setMap] = useState(null);
  const [name, setName] = useState(localStorage.getItem("name") || "Anonymní uživatel");
  const [soundAllowed, setSoundAllowed] = useState(localStorage.getItem("soundAllowed") === "true");
  const [markers, setMarkers] = useState({}); // {uid: marker}
  const markersRef = useRef({});              // runtime reference

  // unread counts per other user
  const [unreads, setUnreads] = useState({});
  const unreadsRef = useRef({});

  // settings panel toggle (ozubené kolo)
  const [showSettings, setShowSettings] = useState(!(localStorage.getItem("nameSaved") === "true" && soundAllowed));

  // chat overlay state
  const [chatOpenFor, setChatOpenFor] = useState(null); // other userId or null
  const [chatOtherName, setChatOtherName] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState([]); // [{id, from, to, text, ts}]

  // audio
  const pingAudio = useRef(new Audio("https://cdn.pixabay.com/download/audio/2023/03/22/audio_7d7d3d6b42.mp3?filename=pop-94319.mp3"));

  // ---------- init map + presence ----------
  useEffect(() => {
    let watchId = null;

    // init map
    const initMap = (lng, lat) => {
      const m = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/streets-v11",
        center: [lng, lat],
        zoom: 14
      });
      setMap(m);
    };

    // try geolocation
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { longitude, latitude } = pos.coords;
          initMap(longitude, latitude);
          // start watch
          watchId = navigator.geolocation.watchPosition(
            (p) => {
              // update my location in DB
              update(ref(db, "users/" + me), {
                lng: p.coords.longitude,
                lat: p.coords.latitude,
                lastActive: Date.now(),
                name,
                online: true
              });
            },
            () => { /* ignore */ },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
          );
          // initial presence write
          set(ref(db, "users/" + me), {
            lng: longitude,
            lat: latitude,
            lastActive: Date.now(),
            name,
            online: true
          });
          // set offline on disconnect
          onDisconnect(ref(db, "users/" + me)).update({
            online: false,
            lastActive: serverTimestamp()
          });
        },
        () => {
          // fallback Prague
          initMap(14.42076, 50.08804);
          set(ref(db, "users/" + me), {
            lng: 14.42076,
            lat: 50.08804,
            lastActive: Date.now(),
            name,
            online: true
          });
          onDisconnect(ref(db, "users/" + me)).update({
            online: false,
            lastActive: serverTimestamp()
          });
        }
      );
    } else {
      initMap(14.42076, 50.08804);
    }

    return () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
    };
  }, [me, name]);

  // ---------- subscribe users -> markers ----------
  useEffect(() => {
    if (!map) return;

    const usersRef = ref(db, "users");
    const off = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      // create/update markers
      Object.keys(data).forEach((id) => {
        const u = data[id];
        if (!u || typeof u.lng !== "number" || typeof u.lat !== "number") return;

        const hasUnread = unreadsRef.current[id] > 0;
        const color = id === me ? "red" : hasUnread ? "orange" : (u.online ? "blue" : "#777");

        if (!markersRef.current[id]) {
          const el = document.createElement("div");
          el.style.width = "14px";
          el.style.height = "14px";
          el.style.borderRadius = "50%";
          el.style.background = color;
          el.style.boxShadow = "0 0 0 2px white";
          const mk = new mapboxgl.Marker({ element: el })
            .setLngLat([u.lng, u.lat])
            .setPopup(new mapboxgl.Popup({ offset: 25 }).setDOMContent(buildPopupDom(id, u.name || "Anonym")))
            .addTo(map);

          markersRef.current[id] = { marker: mk, el };
        } else {
          const { marker, el } = markersRef.current[id];
          marker.setLngLat([u.lng, u.lat]);
          el.style.background = color;
          // refresh popup DOM (kvůli času online)
          marker.setPopup(new mapboxgl.Popup({ offset: 25 }).setDOMContent(buildPopupDom(id, u.name || "Anonym")));
        }
      });

      // remove markers of deleted users
      Object.keys(markersRef.current).forEach((id) => {
        if (!data[id]) {
          markersRef.current[id].marker.remove();
          delete markersRef.current[id];
        }
      });

      // move state mirror
      setMarkers({ ...markersRef.current });
    });

    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // ---------- build popup content (Ping + Chat) ----------
  const buildPopupDom = (userId, userName) => {
    const wrap = document.createElement("div");
    wrap.style.minWidth = "180px";

    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.textContent = userName || "Anonym";
    wrap.appendChild(title);

    const sub = document.createElement("div");
    sub.style.fontSize = "12px";
    sub.style.color = "#666";
    // doplníme posledně online z DB – připojeno níž v onValue (refresh při každé změně)
    const userRef = ref(db, "users/" + userId);
    onValue(userRef, (s) => {
      const u = s.val();
      sub.textContent = u?.online ? "online" : "naposledy " + timeAgo(u?.lastActive || 0);
    }, { onlyOnce: true });
    wrap.appendChild(sub);

    if (userId !== me) {
      const row = document.createElement("div");
      row.style.display = "flex";
      row.style.gap = "8px";
      row.style.marginTop = "8px";

      const pingBtn = document.createElement("button");
      pingBtn.textContent = "📩 Ping";
      pingBtn.style.padding = "6px 10px";
      pingBtn.onclick = () => sendPing(userId, userName || "Anonym");
      row.appendChild(pingBtn);

      const chatBtn = document.createElement("button");
      chatBtn.textContent = "💬 Chat";
      chatBtn.style.padding = "6px 10px";
      chatBtn.onclick = () => openChat(userId, userName || "Anonym");
      row.appendChild(chatBtn);

      wrap.appendChild(row);
    }

    return wrap;
  };

  // ---------- pings listener ----------
  useEffect(() => {
    const pRef = ref(db, "pings/" + me);
    const off = onValue(pRef, (snap) => {
      const data = snap.val() || {};
      const ids = Object.keys(data);
      if (!ids.length) return;

      // pro každý ping: přehraj zvuk (pokud povolen), zobraz nenáročné oznámení
      ids.forEach((id) => {
        const p = data[id];
        if (soundAllowed) {
          pingAudio.current.currentTime = 0;
          pingAudio.current.play().catch(() => {});
        }
        // jednoduché toast oznámení
        showToast(Ping od ${p?.fromName || "neznámý"});
      });

      // vyčistit pings/uid (jednorázové)
      set(ref(db, "pings/" + me), null);
    });

    return () => off();
  }, [me, soundAllowed]);

  const sendPing = (to, toName) => {
    const pRef = push(ref(db, "pings/" + to));
    set(pRef, {
      from: me,
      fromName: name,
      to,
      ts: Date.now()
    });
    showToast("Ping odeslán " + (toName || ""));
  };

  // ---------- chat ----------
  // unread subscriptions pro mě
  useEffect(() => {
    const uRef = ref(db, "unreads/" + me);
    const off = onValue(uRef, (snap) => {
      const v = snap.val() || {};
      unreadsRef.current = v;
      setUnreads(v);
      // přebarvit markery dle unread (provedeme další render)
      setMarkers({ ...markersRef.current });
    });
    return () => off();
  }, [me]);

  const openChat = (otherId, otherName) => {
    setChatOpenFor(otherId);
    setChatOtherName(otherName);
    // načti historii
    const thId = threadId(me, otherId);
    const mRef = ref(db, "messages/" + thId);
    onValue(mRef, (snap) => {
      const v = snap.val() || {};
      const arr = Object.keys(v)
        .map((id) => ({ id, ...v[id] }))
        .sort((a, b) => (a.ts || 0) - (b.ts || 0));
      setChatMessages(arr);
    });

    // vynulovat unread pro tohoto uživatele
    update(ref(db, "unreads/" + me), { [otherId]: 0 });
  };

  const closeChat = () => {
    setChatOpenFor(null);
    setChatMessages([]);
  };

  const sendChat = () => {
    const text = chatInput.trim();
    if (!text || !chatOpenFor) return;

    const thId = threadId(me, chatOpenFor);
    const msg = {
      from: me,
      to: chatOpenFor,
      text,
      ts: Date.now()
    };
    push(ref(db, "messages/" + thId), msg);
    setChatInput("");

    // navýšit unread u příjemce
    const recUnreadRef = ref(db, "unreads/" + chatOpenFor + "/" + me);
    onValue(recUnreadRef, (s) => {
      const curr = s.val() || 0;
      update(ref(db, "unreads/" + chatOpenFor), { [me]: curr + 1 });
    }, { onlyOnce: true });
  };

  // ---------- top bar / settings ----------
  const saveBasics = () => {
    localStorage.setItem("name", name);
    localStorage.setItem("nameSaved", "true");
    update(ref(db, "users/" + me), { name });
    if (soundAllowed) setShowSettings(false);
  };
  const toggleSound = async () => {
    try {
      await pingAudio.current.play();
      pingAudio.current.pause();
      pingAudio.current.currentTime = 0;
      setSoundAllowed(true);
      localStorage.setItem("soundAllowed", "true");
      if (localStorage.getItem("nameSaved") === "true") setShowSettings(false);
      showToast("Zvuk povolen ✔");
    } catch {
      showToast("Pro povolení zvuku klepni znovu");
    }
  };

  // ---------- mini toast ----------
  const toastRef = useRef(null);
  const showToast = (msg) => {
    if (!toastRef.current) {
      const t = document.createElement("div");
      t.style.position = "fixed";
      t.style.bottom = "16px";
      t.style.left = "50%";
      t.style.transform = "translateX(-50%)";
      t.style.background = "rgba(0,0,0,.8)";
      t.style.color = "white";
      t.style.padding = "8px 12px";
      t.style.borderRadius = "8px";
      t.style.zIndex = "9999";
      document.body.appendChild(t);
      toastRef.current = t;
    }
    toastRef.current.textContent = msg;
    toastRef.current.style.opacity = "1";
    setTimeout(() => {
      if (toastRef.current) toastRef.current.style.opacity = "0";
    }, 2000);
  };

  // ---------- render ----------
  return (
    <div>
      {/* Settings / ozubené kolo */}
      {showSettings ? (
        <div
          style={{
            position: "absolute",
            zIndex: 3,
            top: 10,
            left: 10,
            right: 10,
            padding: 10,
            background: "white",
            borderRadius: 12,
            boxShadow: "0 2px 10px rgba(0,0,0,.1)",
            display: "flex",
            gap: 8,
            alignItems: "center"
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Zadej jméno"
            style={{ flex: 1, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
          />
          <button onClick={saveBasics} style={{ padding: "8px 12px" }}>Uložit</button>
          <button
            onClick={toggleSound}
            style={{
              padding: "8px 12px",
              background: soundAllowed ? "#16a34a" : "#f59e0b",
              color: "white",
              borderRadius: 8,
              border: "none"
            }}
          >
            {soundAllowed ? "Zvuk ✔" : "Povolit zvuk"}
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowSettings(true)}
          title="Nastavení"
          style={{
            position: "absolute",
            zIndex: 3,
            top: 10,
            right: 10,
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: "white",
            border: "1px solid #ddd",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 2px 10px rgba(0,0,0,.1)"
          }}
        >
          ⚙️
        </button>
      )}

      {/* map */}
      <div id="map" style={{ width: "100vw", height: "100vh" }} />

      {/* Chat overlay */}
      {chatOpenFor && (
        <div
          style={{
            position: "absolute",
            zIndex: 4,
            bottom: 10,
            left: 10,
            right: 10,
            background: "white",
            borderRadius: 12,
            boxShadow: "0 2px 12px rgba(0,0,0,.15)",
            display: "flex",
            flexDirection: "column",
            maxHeight: "45vh"
          }}
        >
          <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee", display: "flex", justifyContent: "space-between" }}>
            <strong>Chat s {chatOtherName}</strong>
            <button onClick={closeChat}>✖</button>
          </div>
          <div style={{ padding: 12, overflowY: "auto", flex: 1 }}>
            {chatMessages.map((m) => (
              <div key={m.id} style={{ margin: "6px 0", textAlign: m.from === me ? "right" : "left" }}>
                <div
                  style={{
                    display: "inline-block",
                    background: m.from === me ? "#e0ffe6" : "#f0f0f0",
                    padding: "6px 10px",
                    borderRadius: 8,
                    maxWidth: "80%"
                  }}
                >
                  <div style={{ fontSize: 12, opacity: 0.7 }}>{new Date(m.ts).toLocaleTimeString()}</div>
                  <div>{m.text}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid #eee" }}>
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Napiš zprávu…"
              style={{ flex: 1, padding: "8px 10px", border: "1px solid #ddd", borderRadius: 8 }}
            />
            <button onClick={sendChat} style={{ padding: "8px 12px" }}>Odeslat</button>
          </div>
        </div>
      )}
    </div>
  );
}
