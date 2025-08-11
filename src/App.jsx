import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue
} from "firebase/database";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "firebase/auth";

// ---------- Mapbox token (tvůj) ----------
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

// ---------- Firebase config (tvůj) ----------
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

// ---------- Firebase init ----------
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

// Pomocná funkce – bezpečné čtení localStorage i na mobilu
const ls = {
  get(key, def = "") {
    try {
      const v = localStorage.getItem(key);
      return v == null ? def : v;
    } catch {
      return def;
    }
  },
  set(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch {}
  }
};

export default function App() {
  const mapRef = useRef(null);
  const mapboxRef = useRef(null);
  const myMarkerRef = useRef(null);

  const [uid, setUid] = useState(ls.get("uid", ""));
  const [name, setName] = useState(ls.get("name", "Anonymní uživatel"));
  const [soundEnabled, setSoundEnabled] = useState(ls.get("sound", "0") === "1");
  const [ready, setReady] = useState(false);

  // ---------- Auth (anonymous) ----------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setUid(user.uid);
        ls.set("uid", user.uid);
        setReady(true);
      } else {
        const cred = await signInAnonymously(auth);
        setUid(cred.user.uid);
        ls.set("uid", cred.user.uid);
        setReady(true);
      }
    });
    return () => unsub();
  }, []);

  // ---------- Inicializace mapy ----------
  useEffect(() => {
    if (!ready || mapboxRef.current) return;

    // Základní fallback: centrum Prahy
    const fallback = [14.42076, 50.08804];

    const buildMap = (centerLngLat) => {
      mapboxRef.current = new mapboxgl.Map({
        container: mapRef.current,
        style: "mapbox://styles/mapbox/streets-v11",
        center: centerLngLat,
        zoom: 13
      });

      // Můj marker (červený)
      myMarkerRef.current = new mapboxgl.Marker({ color: "red" })
        .setLngLat(centerLngLat)
        .addTo(mapboxRef.current);
    };

    // Vyžádání polohy
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const center = [pos.coords.longitude, pos.coords.latitude];
          buildMap(center);
          // Zapiš i hned do DB první polohu
          if (uid) {
            update(ref(db, `users/${uid}`), {
              name,
              location: { lng: center[0], lat: center[1] },
              lastActive: Date.now()
            });
          }
        },
        () => buildMap(fallback),
        { enableHighAccuracy: true, timeout: 10000 }
      );
    } else {
      buildMap(fallback);
    }
  }, [ready, uid, name]);

  // ---------- Sledování polohy a zápis do DB ----------
  useEffect(() => {
    if (!ready || !uid) return;
    let watchId = null;

    if ("geolocation" in navigator) {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          const lng = pos.coords.longitude;
          const lat = pos.coords.latitude;

          // Posuň můj marker
          if (myMarkerRef.current) {
            myMarkerRef.current.setLngLat([lng, lat]);
          }

          // Zapiš polohu do DB
          update(ref(db, `users/${uid}`), {
            name,
            location: { lng, lat },
            lastActive: Date.now()
          });
        },
        () => {
          // ignore
        },
        { enableHighAccuracy: true }
      );
    }

    return () => {
      if (watchId != null) {
        navigator.geolocation.clearWatch(watchId);
      }
    };
  }, [ready, uid, name]);

  // ---------- Zobrazení ostatních uživatelů (modré markery) ----------
  useEffect(() => {
    if (!mapboxRef.current) return;

    const usersRef = ref(db, "users");
    const markers = new Map(); // uid -> marker

    const unsub = onValue(usersRef, (snap) => {
      const all = snap.val() || {};
      Object.entries(all).forEach(([id, u]) => {
        if (!u?.location) return;

        if (id === uid) return; // sebe vykreslujeme červeně zvlášť

        const lngLat = [u.location.lng, u.location.lat];

        if (!markers.has(id)) {
          const m = new mapboxgl.Marker({ color: "blue" })
            .setLngLat(lngLat)
            .setPopup(
              new mapboxgl.Popup({ offset: 18 }).setHTML(
                `<b>${u.name || "Uživatel"}</b>`
              )
            )
            .addTo(mapboxRef.current);
          markers.set(id, m);
        } else {
          markers.get(id).setLngLat(lngLat);
        }
      });

      // Smaž markery, pro které už v DB není záznam
      for (const [id, m] of markers) {
        if (!all[id]) {
          m.remove();
          markers.delete(id);
        }
      }
    });

    return () => unsub();
  }, [ready, uid]);

  // ---------- UI akce ----------
  const saveName = () => {
    ls.set("name", name);
    if (uid) {
      update(ref(db, `users/${uid}`), { name });
    }
  };

  const allowSound = async () => {
    try {
      // jedno krátké pípnutí, aby si prohlížeč odemkl audio
      const a = new Audio(
        "data:audio/mp3;base64,//uQZAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQAA"
      );
      await a.play();
      setSoundEnabled(true);
      ls.set("sound", "1");
    } catch {
      setSoundEnabled(true);
      ls.set("sound", "1");
    }
  };

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {/* horní lišta */}
      <div
        style={{
          position: "fixed",
          top: 8,
          left: 8,
          right: 8,
          zIndex: 10,
          display: "flex",
          gap: 8,
          flexWrap: "wrap"
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Zadej jméno"
          style={{
            flex: "1 1 200px",
            minWidth: 180,
            padding: 10,
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "#fff"
          }}
        />
        <button
          onClick={saveName}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #ddd",
            background: "#fff"
          }}
        >
          Uložit
        </button>
        <button
          onClick={allowSound}
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            border: "1px solid #ddd",
            background: soundEnabled ? "#e8f5e9" : "#fff"
          }}
        >
          {soundEnabled ? "🔊 Zvuk povolen" : "🔈 Povolit zvuk"}
        </button>
      </div>

      {/* mapa */}
      <div
        ref={mapRef}
        id="map"
        style={{
          position: "absolute",
          inset: 0
        }}
      />
    </div>
  );
}
