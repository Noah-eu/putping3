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
  push
} from "firebase/database";

/* ========= Mapbox ========= */
mapboxgl.accessToken = "TVŮJ_MAPBOX_TOKEN";

/* ========= Firebase ========= */
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

/* ========= Pomocné ========= */
function timeAgo(ts) {
  if (!ts) return "neznámo";
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "před pár sekundami";
  const m = Math.floor(s / 60);
  if (m < 60) return ${m} min;
  const h = Math.floor(m / 60);
  if (h < 24) return ${h} h;
  const d = Math.floor(h / 24);
  return ${d} d;
}

export default function App() {
  const [map, setMap] = useState(null);
  const [name, setName] = useState(localStorage.getItem("name") || "");
  const [soundOn, setSoundOn] = useState(false);

  // per‑session userId (uložíme lokálně, ať se drží mezi refreshem)
  const [userId] = useState(() => {
    const cached = localStorage.getItem("userId");
    if (cached) return cached;
    const id = Math.random().toString(36).slice(2, 10);
    localStorage.setItem("userId", id);
    return id;
  });

  // markery uživatelů
  const markers = useRef({});
  const myRef = useRef(null);
  const audioRef = useRef(
    new Audio(
      "https://notificationsounds.com/storage/sounds/file-sounds-1150-event.mp3"
    )
  );

  /* ====== Init mapy + moje poloha ====== */
  useEffect(() => {
    let watchId = null;

    // počkáme na 1. fix pro centrování
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const m = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v11",
          center: [longitude, latitude],
          zoom: 14
        });
        setMap(m);

        // zapiš uživatele (neodstraňuj při odpojení, chceme ho ponechat)
        const r = ref(db, users/${userId});
        myRef.current = r;
        set(r, {
          name: name || "Anonymní uživatel",
          lat: latitude,
          lng: longitude,
          lastActive: Date.now()
        });
        onDisconnect(r).update({ lastActive: Date.now() }); // jen aktualizace času

        // průběžný watch
        watchId = navigator.geolocation.watchPosition(
          (p) => {
            const { latitude: la, longitude: lo } = p.coords;
            update(r, {
              lat: la,
              lng: lo,
              name: name || "Anonymní uživatel",
              lastActive: Date.now()
            });
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
        );
      },
      () => {
        // fallback mapa na Prahu
        const m = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v11",
          center: [14.42076, 50.08804],
          zoom: 12
        });
        setMap(m);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );

    return () => {
      if (watchId) navigator.geolocation.clearWatch(watchId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  /* ====== Ukládání jména ====== */
  const saveName = () => {
    localStorage.setItem("name", name);
    if (myRef.current) {
      update(myRef.current, {
        name: name || "Anonymní uživatel",
        lastActive: Date.now()
      });
    }
  };

  /* ====== Stream uživatelů → markery ====== */
  useEffect(() => {
    if (!map) return;
    const usersRef = ref(db, "users");

    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};

      // vytvořit/aktualizovat markery
      Object.entries(data).forEach(([id, u]) => {
        if (!u || typeof u.lng !== "number" || typeof u.lat !== "number")
          return;

        const isMe = id === userId;
        const color = isMe ? "red" : "blue";
        const last = u.lastActive || Date.now();

        const html = `
          <div style="min-width:160px">
            <b>${u.name || "Anonymní uživatel"}</b><br/>
            <small>naposledy: ${timeAgo(last)}</small><br/>
            ${
              !isMe
                ? <button id="pp-send-${id}" style="margin-top:6px;width:100%;">📩 Send ping</button>
                : ""
            }
          </div>
        `;

        if (!markers.current[id]) {
          const marker = new mapboxgl.Marker({ color })
            .setLngLat([u.lng, u.lat])
            .setPopup(new mapboxgl.Popup({ offset: 25 }).setHTML(html))
            .addTo(map);

          markers.current[id] = marker;

          // přivěsit handler po otevření popupu (kvůli buttonu)
          marker.getPopup().on("open", () => {
            const btn = document.getElementById(pp-send-${id});
            if (btn) {
              btn.onclick = () => sendPing(id, u.name || "Anonymní uživatel");
            }
          });
        } else {
          markers.current[id].setLngLat([u.lng, u.lat]);
          // aktualizovat popup text
          const popup = markers.current[id].getPopup();
          if (popup) popup.setHTML(html);
        }
      });

      // uklid: markery pro uživatele, co už nejsou v DB
      Object.keys(markers.current).forEach((id) => {
        if (!data[id]) {
          markers.current[id].remove();
          delete markers.current[id];
        }
      });
    });

    return () => unsub();
  }, [map, userId]);

  /* ====== PING – odeslání a příjem ====== */
  const sendPing = (targetId, targetName) => {
    // zapiš ping příjemci
    const pRef = ref(db, pings/${targetId});
    const itemRef = push(pRef);
    set(itemRef, {
      fromId: userId,
      fromName: name || "Anonymní uživatel",
      ts: Date.now()
    });

    // volitelně zobraz info o odeslání
    if (markers.current[targetId]) {
      markers.current[targetId].togglePopup();
      markers.current[targetId].togglePopup();
    }
  };

  // poslouchat příchozí pingy
  useEffect(() => {
    const myPingsRef = ref(db, pings/${userId});
    const unsub = onValue(myPingsRef, (snap) => {
      const data = snap.val();
      if (!data) return;

      // přehraj zvuk (pokud povolen)
      if (soundOn) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
      }

      // najdi poslední ping a ukaž alert s odesílatelem
      const lastKey = Object.keys(data).sort().pop();
      const last = lastKey ? data[lastKey] : null;
      const from = last?.fromName || "neznámý";
      alert(📩 Dostal jsi ping od: ${from});

      // smaž pings (vyčistit frontu)
      remove(myPingsRef);
    });

    return () => unsub();
  }, [userId, soundOn]);

  /* ====== UI ====== */
  const unlockSound = async () => {
    try {
      await audioRef.current.play();
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setSoundOn(true);
    } catch {
      setSoundOn(false);
    }
  };

  return (
    <div>
      {/* horní pruh */}
      <div
        style={{
          position: "absolute",
          zIndex: 2,
          left: 8,
          top: 8,
          background: "white",
          padding: 8,
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,.15)",
          display: "flex",
          gap: 8,
          alignItems: "center"
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Zadej jméno"
          style={{ padding: "6px 8px", width: 160 }}
        />
        <button onClick={saveName}>Uložit</button>
        <button
          onClick={unlockSound}
          style={{
            background: soundOn ? "#0ea5e9" : "#eee",
            color: soundOn ? "white" : "black"
          }}
        >
          {soundOn ? "🔊 Zvuk povolen" : "🔇 Povolit zvuk"}
        </button>
      </div>

      {/* mapa */}
      <div id="map" style={{ width: "100vw", height: "100vh" }} />
    </div>
  );
}
