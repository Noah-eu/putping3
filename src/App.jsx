import React, { useState, useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  onValue,
  update,
  onDisconnect,
  push,
  remove
} from "firebase/database";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "firebase/storage";

/* ===== Mapbox token (tvůj) ===== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ===== Firebase config (opravený storageBucket) ===== */
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com", // <— Tohle bylo špatně, musí být *.appspot.com
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);

/* Pomocná funkce – zmenší obrázek na max 512 px (delší strana) */
async function downscaleImage(file) {
  const maxSide = 512;

  // Fallback přes <img> + FileReader (funguje všude)
  const viaImg = () =>
    new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error("Čtení souboru selhalo"));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("Načtení obrázku selhalo"));
        img.onload = () => {
          const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Konverze do JPEG selhala"))),
            "image/jpeg",
            0.8
          );
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });

  // Zkus createImageBitmap (rychlejší), když padne/timeout, spadne na viaImg
  try {
    const timeout = new Promise((_, rej) =>
      setTimeout(() => rej(new Error("createImageBitmap timeout")), 3000)
    );
    const bitmap = await Promise.race([createImageBitmap(file), timeout]);
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("Konverze do JPEG selhala"))), "image/jpeg", 0.8)
    );
  } catch {
    return await viaImg();
  }
}

export default function App() {
  const [map, setMap] = useState(null);
  const [userName, setUserName] = useState(localStorage.getItem("userName") || "");
  const [userId] = useState(
    localStorage.getItem("userId") || Math.random().toString(36).substr(2, 9)
  );
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("soundEnabled") === "true"
  );
  const [photoURL, setPhotoURL] = useState(localStorage.getItem("photoURL") || "");
  const [showSettings, setShowSettings] = useState(false);
  const [initialSetupDone, setInitialSetupDone] = useState(
    localStorage.getItem("setupDone") === "true"
  );

  const markersById = useRef({});
  const pingSound = useRef(
    new Audio("https://cdn.jsdelivr.net/gh/napars/tones@main/click.mp3")
  );

  // per-device ID (kvůli „šedému já“ z dřívějška)
  const [deviceId] = useState(() => {
    const ex = localStorage.getItem("deviceId");
    if (ex) return ex;
    const id = "dev_" + Math.random().toString(36).slice(2);
    localStorage.setItem("deviceId", id);
    return id;
  });

  useEffect(() => {
    localStorage.setItem("userId", userId);

    navigator.geolocation.getCurrentPosition((position) => {
      const { latitude, longitude } = position.coords;
      const m = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/streets-v11",
        center: [longitude, latitude],
        zoom: 14
      });
      setMap(m);

      const meRef = ref(db, `users/${userId}`);
      set(meRef, {
        name: userName || "Anonym",
        lat: latitude,
        lng: longitude,
        lastActive: Date.now(),
        photoURL: photoURL || null,
        deviceId
      });
      onDisconnect(meRef).remove();

      // keep-alive (pro jednoduchost stejné souřadnice jako first fix)
      const t = setInterval(() => {
        update(meRef, {
          lastActive: Date.now(),
          name: userName || "Anonym",
          photoURL: photoURL || null,
          deviceId
        });
      }, 20000);
      return () => clearInterval(t);
    });
  }, [userId, userName, photoURL, deviceId]);

  useEffect(() => {
    if (!map) return;

    const usersRef = ref(db, "users");
    onValue(usersRef, (snapshot) => {
      const data = snapshot.val() || {};

      // Sada ID, která aktuálně existují v DB (pro čistku markerů)
      const present = new Set(Object.keys(data));

      Object.entries(data).forEach(([id, user]) => {
        // 1) nikdy nezobrazuj záznamy z tohoto zařízení (zabije „šedý já“)
        if (user?.deviceId && user.deviceId === deviceId) return;
        // 2) přeskoč můj aktuální účet
        if (id === userId) return;
        if (!user?.lng || !user?.lat) return;

        const popupContent = `
          <div style="text-align:center">
            ${user.photoURL ? `<img src="${user.photoURL}" style="width:50px;height:50px;border-radius:50%" />` : ""}
            <p style="margin:6px 0 10px">${user.name || "Anonym"}</p>
            <button onclick="window.sendPing('${id}')" style="margin-right:6px">📩 Ping</button>
            <button onclick="window.openChat('${id}')">💬 Chat</button>
          </div>
        `;

        if (!markersById.current[id]) {
          markersById.current[id] = new mapboxgl.Marker({ color: "blue" })
            .setLngLat([user.lng, user.lat])
            .setPopup(new mapboxgl.Popup().setHTML(popupContent))
            .addTo(map);
        } else {
          // update pozice + popup (když se změní jméno/fotka)
          markersById.current[id].setLngLat([user.lng, user.lat]);
          const pop = markersById.current[id].getPopup();
          if (pop && pop.isOpen()) pop.setHTML(popupContent);
          else markersById.current[id].setPopup(new mapboxgl.Popup().setHTML(popupContent));
        }
      });

      // Smazat markery uživatelů, kteří z DB zmizeli
      Object.keys(markersById.current).forEach((id) => {
        if (!present.has(id)) {
          markersById.current[id].remove();
          delete markersById.current[id];
        }
      });
    });
  }, [map, userId, deviceId]);

  // Globální funkce pro kliknutí z popupu
  window.sendPing = (targetId) => {
    const pingsRef = ref(db, `pings/${targetId}`);
    set(pingsRef, { from: userName || "Anonym", time: Date.now(), fromId: userId });
  };

  window.openChat = (targetId) => {
    const msg = prompt(`Zpráva pro ${targetId}:`);
    if (msg) {
      const msgRef = ref(db, `messages/${targetId}/${userId}`);
      push(msgRef, { from: userName || "Anonym", text: msg, time: Date.now(), fromId: userId });
    }
  };

  // Poslech pingů a zpráv
  useEffect(() => {
    const pingsRef = ref(db, `pings/${userId}`);
    onValue(pingsRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const ping = snapshot.val();
      if (soundEnabled) {
        pingSound.current.currentTime = 0;
        pingSound.current.play().catch(() => {});
      }
      alert(`📩 Ping od ${ping.from}`);
      remove(pingsRef);
    });

    const inboxRef = ref(db, `messages/${userId}`);
    onValue(inboxRef, (snapshot) => {
      if (!snapshot.exists()) return;
      const all = snapshot.val(); // { senderId: { pushId: msg, ... }, ... }
      // vyber poslední zprávu napříč odesilateli
      let last = null;
      Object.values(all).forEach((bySender) => {
        Object.values(bySender).forEach((m) => {
          if (!last || m.time > last.time) last = m;
        });
      });
      if (last) {
        if (soundEnabled) {
          pingSound.current.currentTime = 0;
          pingSound.current.play().catch(() => {});
        }
        alert(`💬 Nová zpráva od ${last.from}: ${last.text}`);
      }
      // POZOR: dřív se tu volalo remove(inboxRef) a tím se mazala celá schránka;
      // necháme zprávy v DB, ať zůstane historie. Pokud chceš čistit, přidej si vlastní UI.
      // remove(inboxRef);
    });
  }, [soundEnabled, userId]);

  // Upload fotky (se zmenšením a spolehlivým URL)
  const handlePhotoUpload = async (e) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      const smallBlob = await downscaleImage(file);
      const r = storageRef(storage, `photos/${userId}.jpg`);
      // bezpečnost: 20s timeout i na upload
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("Upload timeout")), 20000));
      await Promise.race([uploadBytes(r, smallBlob, { contentType: "image/jpeg" }), timeout]);
      const url = await getDownloadURL(r);
      setPhotoURL(url);
      localStorage.setItem("photoURL", url);
      await update(ref(db, `users/${userId}`), { photoURL: url });
      alert("✅ Fotka nahrána");
    } catch (err) {
      console.error(err);
      alert("❌ Nahrání fotky selhalo: " + (err?.message || err));
    } finally {
      // vyčistit input, ať jde nahrát znovu stejný soubor
      e.target.value = "";
    }
  };

  const saveSettings = () => {
    localStorage.setItem("userName", userName);
    localStorage.setItem("soundEnabled", soundEnabled);
    localStorage.setItem("setupDone", "true");
    setInitialSetupDone(true);
    setShowSettings(false);
  };

  return (
    <div>
      {!initialSetupDone && (
        <div style={{ position: "absolute", zIndex: 1, background: "white", padding: 5 }}>
          <input
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Zadej jméno"
          />
          <button
            onClick={() => {
              setSoundEnabled(true);
              localStorage.setItem("soundEnabled", "true");
              pingSound.current.currentTime = 0;
              pingSound.current.play().catch(() => {});
            }}
          >
            🔊 Povolit zvuk
          </button>
          <button onClick={saveSettings}>Uložit</button>
        </div>
      )}

      {initialSetupDone && (
        <button
          style={{ position: "absolute", top: 10, right: 10, zIndex: 2 }}
          onClick={() => setShowSettings(true)}
          title="Nastavení"
        >
          ⚙️
        </button>
      )}

      {showSettings && (
        <div
          style={{
            position: "absolute",
            zIndex: 3,
            background: "white",
            padding: 10,
            right: 10,
            top: 50,
            boxShadow: "0 10px 24px rgba(0,0,0,.15)",
            borderRadius: 12
          }}
        >
          <h3 style={{ marginTop: 0 }}>Nastavení</h3>
          <input
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            placeholder="Změnit jméno"
          />
          <br />
          <label style={{ display: "block", margin: "8px 0" }}>
            <input
              type="checkbox"
              checked={soundEnabled}
              onChange={(e) => {
                setSoundEnabled(e.target.checked);
                localStorage.setItem("soundEnabled", String(e.target.checked));
              }}
            />{" "}
            Povolit zvuk
          </label>
          <input type="file" accept="image/*" onChange={handlePhotoUpload} />
          <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
            (Fotka se zmenší na max ~512 px kvůli rychlosti)
          </div>
          <br />
          <button onClick={saveSettings}>Uložit nastavení</button>
        </div>
      )}

      <div id="map" style={{ width: "100vw", height: "100vh" }}></div>
    </div>
  );
}
