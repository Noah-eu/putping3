import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

// Firebase
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  serverTimestamp,
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

/* ====== TVÉ TOKENY / KONFIG ====== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL:
    "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X",
};
/* ================================= */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

// Pomoc: “x času zpět”
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

export default function App() {
  // Auth / identita
  const [uid, setUid] = useState(localStorage.getItem("uid") || "");
  const [name, setName] = useState(localStorage.getItem("name") || "Anonym");
  const [soundOn, setSoundOn] = useState(
    localStorage.getItem("soundOn") === "true"
  );
  const [showOffline, setShowOffline] = useState(
    localStorage.getItem("showOffline") !== "false"
  );

  // UI
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Mapbox
  const mapRef = useRef(null);
  const myMarkerRef = useRef(null);
  const markersRef = useRef({}); // ostatní uživatelé podle ID

  // zvuk (malé nenápadné „ding“)
  const ding = useRef(
    new Audio(
      "https://cdn.pixabay.com/download/audio/2022/03/15/audio_0e4e4b7f05.mp3?filename=click-124467.mp3"
    )
  );

  // ====== AUTH (anon) ======
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUid(u.uid);
        localStorage.setItem("uid", u.uid);
      }
    });
    if (!auth.currentUser) signInAnonymously(auth).catch(() => {});
    return () => unsub();
  }, []);

  // ====== MAPA ======
  useEffect(() => {
    if (mapRef.current) return;
    const map = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.42076, 50.08804],
      zoom: 6,
    });
    mapRef.current = map;

    // ovládání
    map.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), "bottom-right");
  }, []);

  // ====== VLASTNÍ POLOHA – pouze geolokace, ne z feedu ======
  useEffect(() => {
    if (!uid || !mapRef.current) return;

    let watchId = null;

    const ensureMyMarker = () => {
      if (myMarkerRef.current) return;
      // element pro marker
      const el = document.createElement("div");
      Object.assign(el.style, {
        width: "28px",
        height: "28px",
        borderRadius: "50%",
        background: "#fff",
        border: "4px solid #e74c3c",
        boxShadow: "0 0 0 3px rgba(231,76,60,.25)",
      });
      myMarkerRef.current = new mapboxgl.Marker({ element: el });
    };

    const onPos = (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      ensureMyMarker();
      myMarkerRef.current.setLngLat([lng, lat]).addTo(mapRef.current);

      // napíšu do DB (ať ostatní vidí)
      const uref = ref(db, `users/${uid}`);
      update(uref, {
        name: name || "Anonym",
        lat,
        lng,
        lastActive: Date.now(),
      }).catch(() => {});
    };

    const onErr = () => {
      // nic dramatického
    };

    // první jednorázový dotaz – ať se mapa posune
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          mapRef.current.jumpTo({ center: [lng, lat], zoom: 14 });
          onPos(pos);
        },
        onErr,
        { enableHighAccuracy: true, timeout: 10000 }
      );
      // kontinuální sledování
      watchId = navigator.geolocation.watchPosition(onPos, onErr, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000,
      });
    }

    return () => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
  }, [uid, name]);

  // ====== FEED OSTATNÍCH UŽIVATELŮ ======
  useEffect(() => {
    if (!mapRef.current) return;
    const TTL = 5 * 60 * 1000; // 5 min = online

    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      const now = Date.now();

      // přidej/aktualizuj markery
      Object.entries(data).forEach(([id, u]) => {
        if (!u || !u.lat || !u.lng) return;

        // můj marker si kreslím sám => přeskoč
        if (id === uid) return;

        const offline = now - (u.lastActive || 0) > TTL;
        if (!showOffline && offline) {
          // offline nezobrazuj
          if (markersRef.current[id]) {
            markersRef.current[id].remove();
            delete markersRef.current[id];
          }
          return;
        }

        // vytvoř nebo updatuj
        const existing = markersRef.current[id];
        const el = existing
          ? existing.getElement()
          : (() => {
              const d = document.createElement("div");
              // pokud má fotku, použij ji jako background
              if (u.photoURL) {
                Object.assign(d.style, {
                  width: "44px",
                  height: "44px",
                  borderRadius: "50%",
                  backgroundImage: `url("${u.photoURL}")`,
                  backgroundSize: "cover",
                  backgroundPosition: "center",
                  border: "3px solid #fff",
                  boxShadow: "0 0 0 3px rgba(0,0,0,.15)",
                });
              } else {
                // šedý bublík
                Object.assign(d.style, {
                  width: "32px",
                  height: "32px",
                  borderRadius: "50%",
                  background: offline ? "#bdbdbd" : "#3498db",
                  border: "3px solid #fff",
                  boxShadow: "0 0 0 3px rgba(0,0,0,.15)",
                });
              }
              return d;
            })();

        if (!existing) {
          const m = new mapboxgl.Marker({ element: el })
            .setLngLat([u.lng, u.lat])
            .setPopup(
              new mapboxgl.Popup({ offset: 20 }).setHTML(
                `<div style="font-size:14px">
                   <b>${u.name || "Uživatel"}</b><br/>
                   ${offline ? "offline" : "online"} • ${timeAgo(
                  u.lastActive
                )}
                 </div>`
              )
            )
            .addTo(mapRef.current);
          markersRef.current[id] = m;
        } else {
          existing.setLngLat([u.lng, u.lat]);
          // jednoduchá indikace offline barvou okraje (pokud není fotka)
          const el2 = existing.getElement();
          if (!u.photoURL) {
            el2.style.background = offline ? "#bdbdbd" : "#3498db";
          }
        }
      });

      // odstraň ty, co v DB nejsou
      Object.keys(markersRef.current).forEach((id) => {
        if (!data[id]) {
          markersRef.current[id].remove();
          delete markersRef.current[id];
        }
      });
    });

    return () => unsub();
  }, [uid, showOffline]);

  // ====== PING / MESSAGE HOOKY (zatím jen zvuková reakce) ======
  useEffect(() => {
    if (!uid) return;
    const pingRef = ref(db, `pings/${uid}`);
    const unsub = onValue(pingRef, (snap) => {
      if (!snap.exists()) return;
      // “příchozí ping” => zvuk
      if (soundOn) {
        ding.current.currentTime = 0;
        ding.current
          .play()
          .catch(() => {/* některé prohlížeče vyžadují interakci */});
      }
    });
    return () => unsub();
  }, [uid, soundOn]);

  // ====== ULOŽENÍ JMÉNA ======
  const saveName = async () => {
    if (!uid) return;
    localStorage.setItem("name", name);
    await update(ref(db, `users/${uid}`), {
      name: name || "Anonym",
      lastActive: Date.now(),
    });
    alert("Jméno uloženo.");
  };

  // ====== UPLOAD PROFILOVKY ======
  const fileInputRef = useRef(null);
  const uploadPhoto = async () => {
    try {
      if (!uid) return;
      const file = fileInputRef.current?.files?.[0];
      if (!file) {
        alert("Nejdřív vyber fotku.");
        return;
      }
      setUploading(true);

      // zabalení do JPEG + rozumný název
      const path = `profiles/${uid}.jpg`;
      const r = sref(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      await update(ref(db, `users/${uid}`), {
        photoURL: url,
        lastActive: Date.now(),
      });
      alert("Profilová fotka nahrána.");
      setUploading(false);
    } catch (e) {
      console.error(e);
      setUploading(false);
      alert("Nahrání se nepodařilo.");
    }
  };

  // ====== PŘEPÍNAČE ======
  const toggleSound = () => {
    const v = !soundOn;
    setSoundOn(v);
    localStorage.setItem("soundOn", String(v));
    if (v) {
      // malé pípnutí jako potvrzení
      ding.current.currentTime = 0;
      ding.current.play().catch(() => {});
    }
  };
  const toggleOffline = () => {
    const v = !showOffline;
    setShowOffline(v);
    localStorage.setItem("showOffline", String(v));
  };

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div id="map" style={{ width: "100%", height: "100%" }} />

      {/* FAB – nastavení */}
      <div
        onClick={() => setSettingsOpen(true)}
        title="Nastavení"
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "#222",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 8px 20px rgba(0,0,0,.25)",
          cursor: "pointer",
          zIndex: 10,
        }}
      >
        <span
          style={{
            display: "block",
            width: 30,
            height: 30,
            background:
              "url('https://icons.getbootstrap.com/assets/icons/gear-fill.svg') center/contain no-repeat",
            filter: "invert(100%)",
          }}
        />
      </div>

      {/* Bottom sheet – nastavení */}
      {settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          style={{
            position: "absolute",
            inset: 0,
            background: "rgba(0,0,0,.25)",
            zIndex: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              left: 16,
              right: 16,
              bottom: 16,
              background: "#fff",
              borderRadius: 16,
              padding: 16,
              boxShadow: "0 10px 30px rgba(0,0,0,.2)",
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>Nastavení</h3>

            <label style={{ display: "block", fontSize: 13, opacity: 0.7 }}>
              Jméno
            </label>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tvoje přezdívka"
                style={{
                  flex: 1,
                  padding: "10px 12px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                }}
              />
              <button
                onClick={saveName}
                style={{
                  borderRadius: 10,
                  padding: "10px 14px",
                  background: "#111827",
                  color: "#fff",
                  border: "none",
                }}
              >
                Uložit
              </button>
            </div>

            <label style={{ display: "block", fontSize: 13, opacity: 0.7 }}>
              Profilová fotka
            </label>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                style={{ flex: 1 }}
              />
              <button
                onClick={uploadPhoto}
                disabled={uploading}
                style={{
                  borderRadius: 10,
                  padding: "10px 14px",
                  background: uploading ? "#9ca3af" : "#111827",
                  color: "#fff",
                  border: "none",
                }}
              >
                {uploading ? "Nahrávám…" : "Nahrát"}
              </button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <button
                onClick={toggleSound}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  padding: "10px 14px",
                  background: soundOn ? "#10b981" : "#111827",
                  color: "#fff",
                  border: "none",
                }}
              >
                {soundOn ? "🔊 Zvuk povolen" : "🔇 Povolit zvuk"}
              </button>
            </div>

            <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                checked={showOffline}
                onChange={toggleOffline}
              />
              Zobrazit offline uživatele (šedě)
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
