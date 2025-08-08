// App.jsx
import { useEffect, useRef, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  onValue,
  remove,
  push,
} from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import mapboxgl from "mapbox-gl";

// --- Firebase config (tvoje)
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

initializeApp(firebaseConfig);
const db = getDatabase();
const auth = getAuth();

// --- Mapbox
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

// --- Audio: připravený zvuk pingu
const pingSound = new Audio(
  "https://notificationsounds.com/notification-sounds/event-538/download/mp3"
);

export default function Home() {
  const [map, setMap] = useState(null);
  const [userId, setUserId] = useState(null);

  const [users, setUsers] = useState({});
  const [name, setName] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const [pingMessage, setPingMessage] = useState("");

  // držíme reference na Markery, ať je můžeme aktualizovat
  const markersRef = useRef({});

  // ---------- 1) anonymní přihlášení ----------
  useEffect(() => {
    signInAnonymously(auth).then((cred) => {
      setUserId(cred.user.uid);
    });
  }, []);

  // ---------- 2) inicializace mapy ----------
  useEffect(() => {
    if (!map && document.getElementById("map")) {
      const m = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/streets-v11",
        center: [14.42076, 50.08804], // Praha
        zoom: 12,
      });
      setMap(m);
    }
  }, [map]);

  // ---------- 3) uložení jména ----------
  useEffect(() => {
    if (!userId) return;
    const nameRef = ref(db, `users/${userId}/name`);
    onValue(nameRef, (snap) => {
      const n = snap.val();
      if (typeof n === "string") setName(n);
    });
  }, [userId]);

  const saveName = async () => {
    if (!userId) return;
    await set(ref(db, `users/${userId}/name`), name || "");
  };

  // ---------- 4) geolokace – uložit polohu do DB ----------
  useEffect(() => {
    if (!userId) return;
    if (!("geolocation" in navigator)) {
      console.warn("Geolokace není podporovaná tímto prohlížečem.");
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        set(ref(db, `users/${userId}/location`), {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          ts: Date.now(),
        });
      },
      (err) => {
        console.warn("Geolokaci se nepodařilo získat:", err);
      },
      { enableHighAccuracy: true, maximumAge: 0 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [userId]);

  // ---------- 5) přehled všech uživatelů + markery ----------
  useEffect(() => {
    if (!map) return;
    const unsub = onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      setUsers(data);

      Object.entries(data).forEach(([uid, u]) => {
        if (!u?.location) return;

        // marker pro daného uživatele
        const key = uid;
        const color = uid === userId ? "red" : "blue";
        const el = document.createElement("div");
        el.style.width = "14px";
        el.style.height = "14px";
        el.style.borderRadius = "50%";
        el.style.background = color;
        el.style.border = "2px solid white";
        el.style.boxShadow = "0 0 0 2px rgba(0,0,0,0.15)";

        // popup se jménem + čas
        const label = u?.name ? u.name : "Anonym";
        const when = u?.location?.ts
          ? new Date(u.location.ts).toLocaleTimeString()
          : "";
        const popup = new mapboxgl.Popup({ offset: 12 }).setHTML(
          `<b>${label}</b><br/><small>${when}</small>`
        );

        // vytvořit / aktualizovat marker
        if (markersRef.current[key]) {
          markersRef.current[key]
            .setLngLat([u.location.lng, u.location.lat])
            .setPopup(popup);
        } else {
          markersRef.current[key] = new mapboxgl
            .Marker({ element: el })
            .setLngLat([u.location.lng, u.location.lat])
            .setPopup(popup)
            .addTo(map);
        }
      });
    });
    return () => unsub();
  }, [map, userId]);

  // ---------- 6) Příjem pingů (notifikace, zvuk) ----------
  useEffect(() => {
    if (!userId) return;

    // pokus o povolení notifikací (nevadí, když uživatel odmítne)
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    const pingsRef = ref(db, `pings/${userId}`);
    const unsub = onValue(pingsRef, (snap) => {
      const pings = snap.val();
      if (!pings) return;

      Object.entries(pings).forEach(([pingId, pingData]) => {
        // krátký text nahoře
        setPingMessage("📨 Dostal jsi ping!");

        // zkusit notifikaci (pokud user povolil)
        if ("Notification" in window && Notification.permission === "granted") {
          try {
            new Notification("📨 Dostal jsi ping!");
          } catch (_) {}
        }

        // zvuk přehrajeme jen když to uživatel dříve povolil tlačítkem
        if (soundEnabled) {
          pingSound
            .play()
            .catch(() =>
              console.warn("Zvuk se nepodařilo přehrát (policy/autoplay).")
            );
        }

        // uklidit ping z DB
        remove(ref(db, `pings/${userId}/${pingId}`));

        // schovat hlášku po 4s
        setTimeout(() => setPingMessage(""), 4000);
      });
    });
    return () => unsub();
  }, [userId, soundEnabled]);

  // ---------- 7) poslat ping všem ostatním ----------
  const sendPing = async () => {
    if (!userId) return;
    // pošli všem kromě mě
    const targets = Object.keys(users).filter((uid) => uid !== userId);
    await Promise.all(
      targets.map(async (uid) => {
        const kRef = push(ref(db, `pings/${uid}`));
        await set(kRef, {
          from: userId,
          ts: Date.now(),
        });
      })
    );
  };

  // ---------- 8) povolit zvuk (priming) ----------
  const enableSound = async () => {
    try {
      // „priming“ – jednou přehrát, hned zastavit, tím se odemkne zvuk pro další přehrávání
      await pingSound.play();
      pingSound.pause();
      pingSound.currentTime = 0;
      setSoundEnabled(true);
    } catch (e) {
      console.warn("Nepodařilo se povolit zvuk:", e);
      setSoundEnabled(false);
    }
  };

  return (
    <div>
      {/* horní lišta ovládání */}
      <div
        style={{
          position: "fixed",
          top: 8,
          left: 8,
          right: 8,
          zIndex: 10,
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: "rgba(255,255,255,0.9)",
          padding: 8,
          borderRadius: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,.15)",
          flexWrap: "wrap",
        }}
      >
        <input
          placeholder="Zadej jméno"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #ccc",
            minWidth: 180,
          }}
        />
        <button
          onClick={saveName}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #ccc",
            background: "#f4f4f4",
            cursor: "pointer",
          }}
        >
          Uložit
        </button>

        <button
          onClick={sendPing}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #ccc",
            background: "#e8f5ff",
            cursor: "pointer",
          }}
        >
          📡 Send ping
        </button>

        {!soundEnabled && (
          <button
            onClick={enableSound}
            style={{
              padding: "6px 10px",
              borderRadius: 6,
              border: "1px solid #ccc",
              background: "#fff7e6",
              cursor: "pointer",
            }}
          >
            🔊 Povolit zvuk
          </button>
        )}

        {pingMessage && (
          <div
            style={{
              marginLeft: "auto",
              padding: "6px 10px",
              borderRadius: 6,
              background: "#fff3cd",
              border: "1px solid #ffeeba",
              color: "#856404",
              fontWeight: 600,
            }}
          >
            {pingMessage}
          </div>
        )}
      </div>

      {/* mapa */}
      <div id="map" style={{ width: "100vw", height: "100vh" }} />
    </div>
  );
}

