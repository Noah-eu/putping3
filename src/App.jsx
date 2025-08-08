import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import {
  initializeApp
} from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  onDisconnect,
  serverTimestamp,
  remove,
  push
} from "firebase/database";
import {
  getAuth,
  signInAnonymously
} from "firebase/auth";

// ===== Mapbox token =====
mapboxgl.accessToken = "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

// ===== Firebase config =====
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

initializeApp(firebaseConfig);
const db = getDatabase();
const auth = getAuth();

// drobný a spolehlivý zvuk (krátké „ding“)
const DING_URL =
  "https://actions.google.com/sounds/v1/alarms/digital_watch_alarm_long.ogg";

export default function App() {
  const [map, setMap] = useState(null);
  const [userId, setUserId] = useState(null);
  const [userName, setUserName] = useState("Anonymní uživatel");
  const [pingMessage, setPingMessage] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);

  const meRef = useRef(null);
  const watchIdRef = useRef(null);
  const markersById = useRef({}); // { [uid]: mapboxgl.Marker }

  // odemčený Audio element (po kliknutí na „Povolit zvuk“)
  const audioRef = useRef(null);

  // ===== 1) Auth (anonymně) =====
  useEffect(() => {
    signInAnonymously(auth).then((cred) => {
      setUserId(cred.user.uid);
    });
  }, []);

  // ===== 2) Inicializace mapy =====
  useEffect(() => {
    if (map || !document.getElementById("map")) return;

    const m = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v11",
      center: [14.42076, 50.08804],
      zoom: 13
    });

    setMap(m);
    return () => m.remove();
  }, [map]);

  // ===== 3) Získání / sledování polohy a zápis do DB =====
  useEffect(() => {
    if (!userId || !map) return;

    meRef.current = ref(db, users/${userId});

    // úklid po odpojení
    onDisconnect(meRef.current).remove();

    // inicializační získání polohy + zápis
    const writePosition = (coords) => {
      const { latitude, longitude } = coords;
      set(meRef.current, {
        name: userName,
        lat: latitude,
        lng: longitude,
        lastActive: serverTimestamp()
      });

      // zaměř mapu lehce na začátku
      map.setCenter([longitude, latitude]);
    };

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => writePosition(pos.coords),
        () => {
          // fallback – nic
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );

      // průběžný update pozice (živě)
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude } = pos.coords;
          update(meRef.current, {
            lat: latitude,
            lng: longitude,
            lastActive: serverTimestamp(),
            name: userName
          });
        },
        () => {},
        { enableHighAccuracy: true }
      );
    }

    // průběžné obnovování lastActive i bez pohybu
    const heart = setInterval(() => {
      update(meRef.current, { lastActive: serverTimestamp(), name: userName });
    }, 20000);

    return () => {
      clearInterval(heart);
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
      // při unmountu markerů se postará cleanup posluchač níže
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, map]);

  // ===== 4) Změna jména – uložit do DB =====
  const saveName = async () => {
    if (meRef.current) {
      await update(meRef.current, { name: userName, lastActive: serverTimestamp() });
    }
  };

  // ===== 5) Zobrazování ostatních (jen aktivních) bez duplicit =====
  useEffect(() => {
    if (!map || !userId) return;

    const TTL_MS = 5 * 60 * 1000; // 5 min
    const usersRef = ref(db, "users");

    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      const now = Date.now();

      // přidat/aktualizovat markery
      Object.entries(data).forEach(([id, u]) => {
        if (id === userId) return; // sebe modře nezobrazuj
        if (!u || typeof u.lat !== "number" || typeof u.lng !== "number") return;

        // poslední aktivita (serverTimestamp může být objekt, proto fallback)
        const lastNum =
          typeof u.lastActive === "number"
            ? u.lastActive
            : (u.lastActive && u.lastActive.toMillis && u.lastActive.toMillis()) || 0;

        if (!lastNum || now - lastNum > TTL_MS) {
          // starý – odstranit případný existující marker
          if (markersById.current[id]) {
            markersById.current[id].remove();
            delete markersById.current[id];
          }
          return;
        }

        // vytvořit/aktualizovat
        if (!markersById.current[id]) {
          const mk = new mapboxgl.Marker({ color: "blue" })
            .setLngLat([u.lng, u.lat])
            .setPopup(
              new mapboxgl.Popup({ offset: 18 }).setHTML(`
                <div style="font-size:14px;">
                  <strong>${u.name || "Anonym"}</strong><br/>
                </div>
              `)
            )
            .addTo(map);
          markersById.current[id] = mk;
        } else {
          markersById.current[id].setLngLat([u.lng, u.lat]);
          // popup text aktualizujeme vytvořením nového popupu (jednoduché a spolehlivé)
          markersById.current[id].setPopup(
            new mapboxgl.Popup({ offset: 18 }).setHTML(`
              <div style="font-size:14px;">
                <strong>${u.name || "Anonym"}</strong><br/>
              </div>
            `)
          );
        }
      });

      // smazat markery, které už v DB nejsou
      Object.keys(markersById.current).forEach((id) => {
        if (!data[id]) {
          markersById.current[id].remove();
          delete markersById.current[id];
        }
      });
    });

    return () => {
      unsub();
      // vyčistíme markery
      Object.values(markersById.current).forEach((m) => m.remove());
      markersById.current = {};
    };
  }, [map, userId]);

  // ===== 6) PING: poslat všem ostatním =====
  const sendPing = async () => {
    if (!userId) return;
    // načti aktuální seznam uživatelů a rozdej ping každému jinému
    const usersRef = ref(db, "users");
    onValue(
      usersRef,
      (snap) => {
        const all = snap.val() || {};
        Object.keys(all)
          .filter((id) => id !== userId)
          .forEach((targetId) => {
            const inboxRef = ref(db, pings/${targetId});
            const msg = {
              from: userId,
              name: userName,
              ts: Date.now()
            };
            push(inboxRef, msg);
          });
      },
      { onlyOnce: true }
    );
  };

  // ===== 7) Příjem pingů pro mě + zvuk/oznámení =====
  useEffect(() => {
    if (!userId) return;
    const myPingsRef = ref(db, pings/${userId});

    const unsub = onValue(myPingsRef, (snap) => {
      const pings = snap.val();
      if (!pings) return;

      Object.entries(pings).forEach(([pingId, pingData]) => {
        setPingMessage("📩 Dostal jsi ping!");

        // HTML5 Notification (pokud je povolená)
        if (Notification?.permission === "granted") {
          // malá notifikace (bez zvuku)
          new Notification("📩 Dostal jsi ping!");
        }

        // zvuk – přehraj, pokud je odemčený
        if (soundEnabled && audioRef.current) {
          audioRef.current.currentTime = 0;
          audioRef.current.play().catch(() => {});
        }

        // vymazat ping, ať se nezobrazuje znovu
        remove(ref(db, pings/${userId}/${pingId}));

        // toast schovat po 4 s
        setTimeout(() => setPingMessage(""), 4000);
      });
    });

    return () => unsub();
  }, [userId, soundEnabled]);

  // ===== 8) Odemknout zvuk (nutné kvůli mobilním autoplay politikám) =====
  const enableSound = async () => {
    if (!audioRef.current) {
      audioRef.current = new Audio(DING_URL);
      audioRef.current.preload = "auto";
    }
    try {
      await audioRef.current.play(); // první klik přehraje (odemkne)
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      setSoundEnabled(true);
    } catch (e) {
      // když prohlížeč stále blokuje
      setSoundEnabled(false);
      alert("Nepodařilo se povolit zvuk. Zkus kliknout znovu.");
    }
    // zároveň si vyžádej povolení pro Notification (není povinné)
    if (Notification && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }
  };

  return (
    <div>
      {/* ovládací panel */}
      <div
        style={{
          position: "absolute",
          zIndex: 5,
          left: 12,
          top: 12,
          background: "white",
          padding: 10,
          borderRadius: 10,
          boxShadow: "0 6px 18px rgba(0,0,0,.15)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          maxWidth: 640
        }}
      >
        <input
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          placeholder="Zadej jméno"
          style={{
            height: 36,
            padding: "0 10px",
            borderRadius: 8,
            border: "1px solid #ddd",
            minWidth: 160
          }}
        />
        <button
          onClick={saveName}
          style={{
            height: 36,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#f8f8f8",
            cursor: "pointer"
          }}
        >
          Uložit
        </button>
        <button
          onClick={sendPing}
          style={{
            height: 36,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: "#f0f7ff",
            cursor: "pointer"
          }}
        >
          📤 Send ping
        </button>
        <button
          onClick={enableSound}
          style={{
            height: 36,
            padding: "0 12px",
            borderRadius: 8,
            border: "1px solid #ddd",
            background: soundEnabled ? "#eaffea" : "#fff8e6",
            cursor: "pointer"
          }}
        >
          🔊 {soundEnabled ? "Zvuk povolen" : "Povolit zvuk"}
        </button>

        {pingMessage && (
          <div
            style={{
              marginLeft: 6,
              padding: "6px 10px",
              borderRadius: 8,
              background: "#ffe9a6",
              border: "1px solid #f0d27a",
              color: "#6b4d00",
              fontWeight: 600
            }}
          >
            {pingMessage}
          </div>
        )}
      </div>

      <div id="map" style={{ width: "100vw", height: "100vh" }} />
    </div>
  );
}
