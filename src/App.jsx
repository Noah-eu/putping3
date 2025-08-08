import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  remove,
  onDisconnect,
} from "firebase/database";

/* TODO: doplň vlastní token */
mapboxgl.accessToken = "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* TODO: doplň vlastní Firebase config (hlavně databaseURL) */
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app/",
  databaseURL: "https://xxx-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
};

initializeApp(firebaseConfig);
const db = getDatabase();

/* Konst / nastavení */
const TTL_MS = 5 * 60 * 1000;      // zobrazuj jen uživatele aktivní posledních 5 min
const HEARTBEAT_MS = 20_000;       // update do DB každých 20 s

/* Jednoduchý toast overlay */
const Toast = ({ message }) => (
  <div
    style={{
      position: "fixed",
      top: 12,
      left: "50%",
      transform: "translateX(-50%)",
      background: "rgba(0,0,0,0.85)",
      color: "white",
      padding: "10px 14px",
      borderRadius: 10,
      zIndex: 9999,
      maxWidth: 360,
      boxShadow: "0 4px 16px rgba(0,0,0,.3)",
      fontSize: 14,
      lineHeight: 1.35,
      textAlign: "center",
    }}
  >
    {message}
  </div>
);

export default function App() {
  /* Identita a stav */
  const [map, setMap] = useState(null);
  const [userId] = useState(
    localStorage.getItem("userId") || Math.random().toString(36).slice(2, 11)
  );
  const [name, setName] = useState(localStorage.getItem("userName") || "Anonym");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [toastText, setToastText] = useState(""); // text aktuálního toastu

  /* Markery */
  const selfMarkerRef = useRef(null);
  const markersById = useRef({});

  const positionRef = useRef({ lat: 50.08804, lng: 14.42076 }); // default Praha
  const pingSound = useRef(
    new Audio(
      "https://notificationsounds.com/storage/sounds/file-sounds-1150-event.mp3"
    )
  );

  /* Ulož si userId */
  useEffect(() => {
    localStorage.setItem("userId", userId);
  }, [userId]);

  /* Toast helper */
  const showToast = (text, ms = 7000) => {
    setToastText(text);
    if (ms > 0) {
      setTimeout(() => setToastText(""), ms);
    }
  };

  /* Inicializace mapy + získání polohy */
  useEffect(() => {
    let watchId;

    const init = () => {
      if (!navigator.geolocation) {
        const m = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v11",
          center: [positionRef.current.lng, positionRef.current.lat],
          zoom: 13,
        });
        setMap(m);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          positionRef.current = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          const m = new mapboxgl.Map({
            container: "map",
            style: "mapbox://styles/mapbox/streets-v11",
            center: [positionRef.current.lng, positionRef.current.lat],
            zoom: 15,
          });
          setMap(m);
        },
        () => {
          const m = new mapboxgl.Map({
            container: "map",
            style: "mapbox://styles/mapbox/streets-v11",
            center: [positionRef.current.lng, positionRef.current.lat],
            zoom: 13,
          });
          setMap(m);
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );

      // průběžné sledování polohy
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          positionRef.current = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 5000 }
      );
    };

    init();
    return () => {
      if (watchId && navigator.geolocation.clearWatch) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, []);

  /* Registrace v DB + heartbeat + onDisconnect */
  useEffect(() => {
    if (!map) return;

    const meRef = ref(db, users/${userId});

    // vlastní marker
    if (!selfMarkerRef.current) {
      selfMarkerRef.current = new mapboxgl.Marker({ color: "red" })
        .setLngLat([positionRef.current.lng, positionRef.current.lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(
            <b>${name || "Anonymní uživatel"}</b><br>${new Date().toLocaleTimeString()}
          )
        )
        .addTo(map);
    }

    // prvotní zápis
    set(meRef, {
      name: name || "Anonym",
      lat: positionRef.current.lat,
      lng: positionRef.current.lng,
      lastActive: Date.now(),
    });
    onDisconnect(meRef).remove();

    // heartbeat — posílej lastActive + polohu a hýbej markerem
    const hb = setInterval(() => {
      if (selfMarkerRef.current) {
        selfMarkerRef.current.setLngLat([
          positionRef.current.lng,
          positionRef.current.lat,
        ]);
      }
      update(meRef, {
        name: name || "Anonym",
        lat: positionRef.current.lat,
        lng: positionRef.current.lng,
        lastActive: Date.now(),
      });
    }, HEARTBEAT_MS);

    return () => clearInterval(hb);
  }, [map, userId, name]);

  /* Popup DOM pro uživatele: Ping + Zpráva */
  const buildPopupDOM = (targetId, targetName) => {
    const wrap = document.createElement("div");
    wrap.style.minWidth = "200px";
    wrap.innerHTML = `
      <div style="font-weight:600;margin-bottom:4px">${targetName || "Anonym"}</div>
      <div style="display:flex; gap:6px; margin-bottom:8px;">
        <button id="pp_ping" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:6px;background:#f2f6ff">📩 Ping</button>
      </div>
      <div style="display:flex; gap:6px;">
        <input id="pp_msg" type="text" placeholder="Napsat zprávu…" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:6px"/>
        <button id="pp_send" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;background:#fff">➡</button>
      </div>
    `;

    // events
    setTimeout(() => {
      const btnPing = wrap.querySelector("#pp_ping");
      const inputMsg = wrap.querySelector("#pp_msg");
      const btnSend = wrap.querySelector("#pp_send");

      if (btnPing) {
        btnPing.addEventListener("click", () => {
          sendPingTo(targetId);
        });
      }
      if (btnSend && inputMsg) {
        btnSend.addEventListener("click", () => {
          const text = inputMsg.value.trim();
          if (text.length === 0) return;
          sendMessageTo(targetId, text);
          inputMsg.value = "";
        });
      }
    }, 0);

    return wrap;
  };

  /* Poslouchej ostatní uživatele – zobrazuj markery */
  useEffect(() => {
    if (!map) return;

    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const all = snap.val() || {};
      const now = Date.now();

      // vytvořit / aktualizovat markery
      Object.entries(all).forEach(([id, u]) => {
        if (id === userId) return;
        if (!u || !u.lastActive || now - u.lastActive > TTL_MS) {
          // neaktivní → odstranit
          if (markersById.current[id]) {
            markersById.current[id].remove();
            delete markersById.current[id];
          }
          return;
        }

        if (!markersById.current[id]) {
          const popupEl = buildPopupDOM(id, u.name);
          const popup = new mapboxgl.Popup({ offset: 25 }).setDOMContent(popupEl);

          markersById.current[id] = new mapboxgl.Marker({ color: "blue" })
            .setLngLat([u.lng, u.lat])
            .setPopup(popup)
            .addTo(map);
        } else {
          markersById.current[id].setLngLat([u.lng, u.lat]);
          // pro jistotu zaktualizuj jméno v popupu (vytvoříme novou DOM)
          const popupEl = buildPopupDOM(id, u.name);
          markersById.current[id].getPopup()?.setDOMContent(popupEl);
        }
      });

      // odstranit markery už neexistujících
      Object.keys(markersById.current).forEach((id) => {
        if (!all[id]) {
          markersById.current[id].remove();
          delete markersById.current[id];
        }
      });
    });

    return () => unsub();
  }, [map, userId]);

  /* Odeslat ping /pings/{targetId}/{pingId} */
  const sendPingTo = (targetId) => {
    const pingId = Math.random().toString(36).slice(2, 10);
    set(ref(db, pings/${targetId}/${pingId}), {
      kind: "ping",
      fromId: userId,
      fromName: name || "Anonym",
      time: Date.now(),
    });
    showToast("📩 Ping odeslán");
  };

  /* Odeslat textovou zprávu */
  const sendMessageTo = (targetId, text) => {
    const msgId = Math.random().toString(36).slice(2, 10);
    set(ref(db, pings/${targetId}/${msgId}), {
      kind: "message",
      fromId: userId,
      fromName: name || "Anonym",
      text,
      time: Date.now(),
    });
    showToast("💬 Zpráva odeslána");
  };

  /* Příjem pingů / zpráv pro mě */
  useEffect(() => {
    const myPingsRef = ref(db, pings/${userId});
    const unsub = onValue(myPingsRef, (snap) => {
      const data = snap.val();
      if (!data) return;

      Object.entries(data).forEach(([id, payload]) => {
        if (!payload) return;

        if (payload.kind === "ping") {
          if (soundEnabled) {
            pingSound.current
              .play()
              .catch(() => console.warn("Zvuk se nepodařilo přehrát."));
          }
          showToast(📩 Ping od: ${payload.fromName || "neznámý"}, 9000);
        } else if (payload.kind === "message") {
          if (soundEnabled) {
            pingSound.current
              .play()
              .catch(() => console.warn("Zvuk se nepodařilo přehrát."));
          }
          const text = (payload.text || "").slice(0, 140);
          showToast(💬 Zpráva od ${payload.fromName || "neznámý"}: ${text}, 12000);
        }

        // uklidit přečtený ping/zprávu
        remove(ref(db, pings/${userId}/${id}));
      });
    });

    return () => unsub();
  }, [userId, soundEnabled]);

  /* Ovládací prvky */
  const saveName = () => {
    localStorage.setItem("userName", name);
    update(ref(db, users/${userId}), { name });
    showToast("✅ Jméno uloženo");
  };

  const enableSound = () => {
    pingSound.current
      .play()
      .then(() => {
        pingSound.current.pause();
        pingSound.current.currentTime = 0;
        setSoundEnabled(true);
        showToast("🔊 Zvuk povolen (může být ztlumen v systému)");
      })
      .catch(() => {
        setSoundEnabled(true);
        showToast("🔊 Pokus o povolení zvuku – zkontroluj hlasitost systému.");
      });
  };

  return (
    <div>
      {toastText && <Toast message={toastText} />}

      <div
        style={{
          position: "absolute",
          top: 10,
          left: 10,
          zIndex: 10,
          background: "white",
          padding: 8,
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,.15)",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Zadej jméno"
          style={{ padding: 6, borderRadius: 6, border: "1px solid #ddd" }}
        />
        <button onClick={saveName}>Uložit</button>
        <button onClick={enableSound} disabled={soundEnabled}>
          🔊 {soundEnabled ? "Zvuk povolen" : "Povolit zvuk"}
        </button>
      </div>

      <div id="map" style={{ width: "100vw", height: "100vh" }} />
    </div>
  );
}
