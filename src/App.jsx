import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  push,
  onDisconnect,
  remove,
  serverTimestamp
} from "firebase/database";

/* ==== Mapbox token ==== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ==== Firebase config – tvoje hodnoty (jak jsi poslal) ==== */
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL:
    "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.firebasestorage.app",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X"
};
initializeApp(firebaseConfig);
const db = getDatabase();

/* ==== Pomocníci ==== */
const uidLocal = () =>
  localStorage.getItem("userId") ||
  (localStorage.setItem("userId", crypto.randomUUID()), localStorage.getItem("userId"));

const now = () => Date.now();

/** formát: „před 3 min“, „před 2 h“, „před pár sekundami“ */
function timeAgo(ts) {
  if (!ts) return "neznámo";
  const diff = now() - ts;
  if (diff < 60_000) return "před pár sekundami";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.floor(h / 24);
  return `před ${d} dny`;
}

/** pro konverzaci použijeme vždy setříděné uid */
function convoId(a, b) {
  return [a, b].sort().join("_");
}

/* ====== Hlavní komponenta ====== */
export default function App() {
  const userId = useRef(uidLocal()).current;

  const [map, setMap] = useState(null);
  const [name, setName] = useState(localStorage.getItem("userName") || "");
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("soundEnabled") === "1"
  );
  const [settingsOpen, setSettingsOpen] = useState(
    !(localStorage.getItem("userName") && localStorage.getItem("soundEnabled") === "1")
  );

  const markers = useRef(new Map()); // id -> {marker, popup, lastUnreadCount}
  const myMarker = useRef(null);
  const myRef = useRef(null);
  const watchers = useRef([]); // unsubs

  const pingSound = useRef(
    new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg")
  );
  const chatSound = useRef(
    new Audio("https://actions.google.com/sounds/v1/alarms/beep_short.ogg")
  );

  /* ====== Inicializace mapy a uložení/aktualizace sebe ====== */
  useEffect(() => {
    let mounted = true;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!mounted) return;
        const { latitude, longitude } = pos.coords;

        const m = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v11",
          center: [longitude, latitude],
          zoom: 14
        });
        setMap(m);

        // Ulož sebe do DB + cleanup na disconnect
        myRef.current = ref(db, `users/${userId}`);
        set(myRef.current, {
          name: name || "Anonym",
          lat: latitude,
          lng: longitude,
          lastActive: now()
        });
        onDisconnect(myRef.current).update({ lastActive: now() });

        // vlastni marker (červený)
        const el = document.createElement("div");
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.borderRadius = "50%";
        el.style.background = "red";
        myMarker.current = new mapboxgl.Marker({ element: el })
          .setLngLat([longitude, latitude])
          .setPopup(
            new mapboxgl.Popup({ offset: 25 }).setHTML(
              `<b>${name || "Anonymní uživatel"}</b><br/>${new Date().toLocaleTimeString()}`
            )
          )
          .addTo(m);

        // periodicky aktualizace polohy / lastActive
        const id = setInterval(() => {
          navigator.geolocation.getCurrentPosition(
            (p2) => {
              if (!myRef.current) return;
              update(myRef.current, {
                lat: p2.coords.latitude,
                lng: p2.coords.longitude,
                name: localStorage.getItem("userName") || "Anonym",
                lastActive: now()
              });
              myMarker.current?.setLngLat([p2.coords.longitude, p2.coords.latitude]);
            },
            () => {
              // i když polohu nedáme, čerstvě označíme aktivitu
              update(myRef.current, {
                name: localStorage.getItem("userName") || "Anonym",
                lastActive: now()
              });
            },
            { enableHighAccuracy: true }
          );
        }, 20_000);

        watchers.current.push(() => clearInterval(id));
      },
      (err) => {
        alert("Nepodařilo se získat polohu. Aplikace poběží, ale bez tvé pozice.");
        // i bez polohy vytvoříme „sebe“, ale bez lat/lng
        myRef.current = ref(db, `users/${userId}`);
        set(myRef.current, {
          name: name || "Anonym",
          lastActive: now()
        });
        onDisconnect(myRef.current).update({ lastActive: now() });
      },
      { enableHighAccuracy: true }
    );

    return () => {
      mounted = false;
      watchers.current.forEach((u) => u());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ====== Watch všech uživatelů a render markerů ====== */
  useEffect(() => {
    if (!map) return;

    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};

      // Přidej/aktualizuj
      Object.entries(data).forEach(([uid, u]) => {
        if (uid === userId) return; // sebe děláme jinde

        // Vyhodnot online/offline
        const isOnline = u.lastActive && now() - u.lastActive < 120_000;

        // barva markeru: online = blue, offline = gray
        const color = isOnline ? "#1976d2" : "#8e8e8e";

        // počet nepřečtených
        const conv = convoId(userId, uid);

        const ensureMarker = () => {
          if (!markers.current.has(uid)) {
            const el = document.createElement("div");
            el.style.width = "14px";
            el.style.height = "14px";
            el.style.borderRadius = "50%";
            el.style.background = color;
            el.style.boxShadow = "0 0 0 2px white";

            const mk = new mapboxgl.Marker({ element: el });

            const popupNode = document.createElement("div");
            popupNode.style.minWidth = "220px";
            popupNode.style.fontSize = "14px";
            popupNode.style.lineHeight = "1.35";
            popupNode.style.paddingRight = "4px";

            const nameSpan = document.createElement("b");
            nameSpan.textContent = u.name || "Anonym";

            const meta = document.createElement("div");
            meta.style.color = "#666";
            meta.style.marginTop = "2px";
            meta.textContent = isOnline
              ? "online"
              : `offline, ${timeAgo(u.lastActive)}`;

            // tlačítko ping
            const pingBtn = document.createElement("button");
            pingBtn.textContent = "📩 Ping";
            pingBtn.style.marginTop = "8px";
            pingBtn.onclick = () => sendPing(uid, u.name || "Anonym");

            // tlačítko chat
            const chatBtn = document.createElement("button");
            chatBtn.textContent = "💬 Chat";
            chatBtn.style.marginLeft = "6px";
            chatBtn.onclick = () => openChat(uid, u.name || "Anonym", mk);

            popupNode.appendChild(nameSpan);
            popupNode.appendChild(document.createElement("br"));
            popupNode.appendChild(meta);
            popupNode.appendChild(pingBtn);
            popupNode.appendChild(chatBtn);

            const popup = new mapboxgl.Popup({ offset: 18 }).setDOMContent(popupNode);
            mk.setPopup(popup);

            markers.current.set(uid, { marker: mk, popup, el, meta, nameSpan, lastUnread: 0 });
          }

          // aktualizace vzhledu
          const m = markers.current.get(uid);
          m.el.style.background = color;
          m.nameSpan.textContent = u.name || "Anonym";
          m.meta.textContent = isOnline ? "online" : `offline, ${timeAgo(u.lastActive)}`;
          if (u.lat != null && u.lng != null) {
            m.marker.setLngLat([u.lng, u.lat]).addTo(map);
          } else {
            // bez polohy jen nenasazujeme na mapu
          }
        };

        ensureMarker();

        // watch nepřečtených zpráv
        const unreadRef = ref(db, `unread/${uid}/${userId}/${conv}`);
        onValue(unreadRef, (unreadSnap) => {
          const count = unreadSnap.val() || 0;
          const m = markers.current.get(uid);
          if (!m) return;

          // zvýrazni marker při nepřečtených
          m.el.style.transform = count > 0 ? "scale(1.25)" : "scale(1)";
          m.el.style.boxShadow = count > 0 ? "0 0 0 3px #ffd54f" : "0 0 0 2px white";
          m.lastUnread = count;
        });
      });

      // smaž markery, které už v DB nejsou (nemělo by se stávat, ale pro jistotu)
      for (const id of Array.from(markers.current.keys())) {
        if (!data[id]) {
          const m = markers.current.get(id);
          m.marker.remove();
          markers.current.delete(id);
        }
      }
    });

    watchers.current.push(unsub);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  /* ====== Pingy a chat – poslech pro mě ====== */
  useEffect(() => {
    // pingy
    const myPingsRef = ref(db, `pings/${userId}`);
    const unsubPings = onValue(myPingsRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      // přehraj zvuk + notifikaci
      try {
        if (soundEnabled) pingSound.current.play();
      } catch {}
      const last = Object.values(data).at(-1);
      const fromName = last?.fromName || "Někdo";
      alert(`📩 Ping od: ${fromName}`);
      // smaž
      remove(myPingsRef);
    });

    // příchozí zprávy
    const inboxRef = ref(db, `inbox/${userId}`);
    const unsubInbox = onValue(inboxRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      try {
        if (soundEnabled) chatSound.current.play();
      } catch {}
      // nechceme blokující alerty při každé zprávě; viz chat UI
      // uložíme jen info o nepřečtených (řeší se výše přes unread)
    });

    watchers.current.push(unsubPings);
    watchers.current.push(unsubInbox);
  }, [soundEnabled, userId]);

  /* ====== Akce ====== */

  function persistNameSound() {
    localStorage.setItem("userName", name);
    localStorage.setItem("soundEnabled", soundEnabled ? "1" : "0");
    if (myRef.current) update(myRef.current, { name });
    // po potvrzení schovej horní panel
    setSettingsOpen(false);
  }

  function askEnableSound() {
    // „odemkne“ audio (uživatelské gesto)
    pingSound.current.play().catch(() => {});
    chatSound.current.play().catch(() => {});
    setSoundEnabled(true);
  }

  function sendPing(toUid, toName) {
    const pRef = ref(db, `pings/${toUid}`);
    const item = push(pRef);
    set(item, {
      from: userId,
      fromName: localStorage.getItem("userName") || "Anonym",
      at: now()
    });
  }

  function openChat(withUid, withName, markerInstance) {
    const conv = convoId(userId, withUid);
    const content = document.createElement("div");
    content.style.width = "260px";
    content.style.maxHeight = "260px";
    content.style.overflow = "auto";
    content.style.display = "flex";
    content.style.flexDirection = "column";
    content.style.gap = "6px";

    const header = document.createElement("div");
    header.innerHTML = `<b>${withName}</b>`;
    content.appendChild(header);

    const list = document.createElement("div");
    list.style.flex = "1";
    list.style.minHeight = "120px";
    list.style.border = "1px solid #ddd";
    list.style.padding = "6px";
    list.style.borderRadius = "6px";
    list.style.background = "#fafafa";
    content.appendChild(list);

    const form = document.createElement("div");
    form.style.display = "flex";
    form.style.gap = "6px";
    form.style.marginTop = "6px";

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Napiš zprávu…";
    input.style.flex = "1";
    input.style.padding = "6px";
    input.style.border = "1px solid #ccc";
    input.style.borderRadius = "6px";

    const sendBtn = document.createElement("button");
    sendBtn.textContent = "Odeslat";

    form.appendChild(input);
    form.appendChild(sendBtn);
    content.appendChild(form);

    const popup = new mapboxgl.Popup({ offset: 18 }).setDOMContent(content);
    markerInstance.setPopup(popup).togglePopup();

    // načti historii
    const msgsRef = ref(db, `messages/${conv}`);
    const unsub = onValue(msgsRef, (snap) => {
      const all = snap.val() || {};
      list.innerHTML = "";
      Object.values(all)
        .sort((a, b) => (a.at || 0) - (b.at || 0))
        .forEach((m) => {
          const row = document.createElement("div");
          row.style.display = "flex";
          row.style.gap = "6px";
          row.style.alignItems = "baseline";
          const who = document.createElement("span");
          who.style.fontWeight = "600";
          who.textContent =
            m.from === userId ? (localStorage.getItem("userName") || "Ty") : withName;
          const txt = document.createElement("span");
          txt.textContent = `: ${m.text}`;
          const when = document.createElement("span");
          when.style.color = "#888";
          when.style.fontSize = "12px";
          when.textContent = ` (${new Date(m.at).toLocaleTimeString()})`;
          row.appendChild(who);
          row.appendChild(txt);
          row.appendChild(when);
          list.appendChild(row);
          list.scrollTop = list.scrollHeight;
        });

      // vynuluj nepřečtené pro mě (já jsem příjemce)
      const unreadMe = ref(db, `unread/${userId}/${withUid}/${conv}`);
      set(unreadMe, 0);
    });

    popup.on("close", () => unsub());

    // odeslání
    sendBtn.onclick = () => {
      const text = input.value.trim();
      if (!text) return;
      const item = push(msgsRef);
      set(item, {
        from: userId,
        to: withUid,
        text,
        at: now()
      });
      input.value = "";
      // navýš nepřečtené příjemci
      const unreadRef = ref(db, `unread/${withUid}/${userId}/${conv}`);
      onValue(
        unreadRef,
        (s) => {
          const cur = s.val() || 0;
          set(unreadRef, cur + 1);
        },
        { onlyOnce: true }
      );

      // lehký zvuk u mě (feedback)
      try {
        if (soundEnabled) chatSound.current.play();
      } catch {}
    };
  }

  /* ====== UI ====== */
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {/* Horní lišta – po prvním uložení zmizí, pak dostupné přes ozubené kolo */}
      {settingsOpen ? (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            zIndex: 2,
            padding: 8,
            background: "white",
            borderRadius: 8,
            boxShadow: "0 2px 8px rgba(0,0,0,.15)",
            display: "flex",
            gap: 8,
            alignItems: "center"
          }}
        >
          <input
            style={{ padding: 6 }}
            value={name}
            placeholder="Tvé jméno"
            onChange={(e) => setName(e.target.value)}
          />
          <button
            onClick={() => {
              askEnableSound();
              setSoundEnabled(true);
            }}
            style={{
              background: soundEnabled ? "#dcedc8" : "#fff",
              border: "1px solid #ccc",
              padding: "6px 10px",
              borderRadius: 6
            }}
          >
            {soundEnabled ? "🔊 Zvuk povolen" : "🔇 Povolit zvuk"}
          </button>
          <button
            onClick={persistNameSound}
            style={{ padding: "6px 10px", borderRadius: 6 }}
          >
            Uložit
          </button>
        </div>
      ) : (
        <button
          title="Nastavení"
          onClick={() => setSettingsOpen(true)}
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            zIndex: 2,
            width: 38,
            height: 38,
            borderRadius: "50%",
            border: "1px solid #ccc",
            background: "white"
          }}
        >
          ⚙️
        </button>
      )}

      <div id="map" style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
