// App.jsx
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase, ref, set, update, onValue, onDisconnect, push, remove
} from "firebase/database";
import {
  getStorage, ref as sref,
  uploadBytes, uploadBytesResumable, getDownloadURL
} from "firebase/storage";

// ==== MAPBOX TOKEN (tvůj) ====
mapboxgl.accessToken = "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

// ==== FIREBASE CONFIG (oprav. bucket) ====
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",    // <<< DŮLEŽITÉ
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);

// util: mini-komprese obrázku (max 1024px) -> Blob JPEG ~0.8
async function downscaleImage(file, maxSize = 1024) {
  if (!/^image\//.test(file.type)) return file;
  const img = document.createElement("img");
  const reader = new FileReader();
  const loaded = new Promise((res, rej) => {
    reader.onload = () => { img.src = String(reader.result); };
    img.onload = () => res();
    img.onerror = rej;
  });
  reader.readAsDataURL(file);
  await loaded;

  const w = img.width, h = img.height;
  const scale = Math.min(1, maxSize / Math.max(w, h));
  if (scale === 1) return file;

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.8));
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
}

export default function App() {
  const [map, setMap] = useState(null);
  const [name, setName] = useState(localStorage.getItem("userName") || "David");
  const [photoURL, setPhotoURL] = useState(localStorage.getItem("photoURL") || "");
  const [soundOn, setSoundOn] = useState(localStorage.getItem("soundEnabled") === "true");
  const [showSettings, setShowSettings] = useState(false);
  const [showChats, setShowChats] = useState(false);
  const [showOffline, setShowOffline] = useState(localStorage.getItem("showOffline") !== "false");

  const uidRef = useRef(localStorage.getItem("userId") || Math.random().toString(36).slice(2));
  const myMarkerRef = useRef(null);
  const markers = useRef({}); // id -> marker
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const pingSound = useRef(new Audio("https://cdn.pixabay.com/audio/2022/03/15/audio_1b2a1f7a45.mp3"));

  // persist basics
  useEffect(() => { localStorage.setItem("userId", uidRef.current); }, []);
  useEffect(() => { localStorage.setItem("userName", name); }, [name]);
  useEffect(() => { localStorage.setItem("soundEnabled", String(soundOn)); }, [soundOn]);
  useEffect(() => { localStorage.setItem("photoURL", photoURL); }, [photoURL]);
  useEffect(() => { localStorage.setItem("showOffline", String(showOffline)); }, [showOffline]);

  // init map + position + publish me
  useEffect(() => {
    let watchId = null;
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        const m = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v11",
          center: [longitude, latitude],
          zoom: 15
        });
        setMap(m);

        // můj marker (kruh, později fotka)
        const el = document.createElement("div");
        el.style.width = "36px";
        el.style.height = "36px";
        el.style.borderRadius = "50%";
        el.style.border = "4px solid #e64444";
        el.style.background = photoURL ? `url("${photoURL}") center/cover` : "#bbb";
        myMarkerRef.current = new mapboxgl.Marker(el).setLngLat([longitude, latitude]).addTo(m);

        const meRef = ref(db, `users/${uidRef.current}`);
        set(meRef, {
          name, lat: latitude, lng: longitude, lastActive: Date.now(), photoURL, online: true
        });
        onDisconnect(meRef).update({ online: false, lastActive: Date.now() });

        // živá poloha
        watchId = navigator.geolocation.watchPosition(
          p => {
            const { latitude: la, longitude: lo } = p.coords;
            myMarkerRef.current?.setLngLat([lo, la]);
            update(meRef, { lat: la, lng: lo, lastActive: Date.now(), name, photoURL, online: true });
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
        );
      },
      err => alert("Nepodařilo se získat polohu: " + err.message),
      { enableHighAccuracy: true, timeout: 15000 }
    );
    return () => { if (watchId != null) navigator.geolocation.clearWatch(watchId); };
  }, []); // init once

  // render ostatních uživatelů
  useEffect(() => {
    if (!map) return;
    const usersRef = ref(db, "users");
    return onValue(usersRef, snap => {
      const data = snap.val() || {};
      Object.entries(data).forEach(([id, u]) => {
        if (id === uidRef.current) return;

        // filtr offline
        if (!showOffline && !u.online) {
          if (markers.current[id]) { markers.current[id].remove(); delete markers.current[id]; }
          return;
        }

        const was = markers.current[id];
        const el = was?.getElement?.() || document.createElement("div");
        el.style.width = "36px";
        el.style.height = "36px";
        el.style.borderRadius = "50%";
        el.style.border = u.online ? "4px solid #e64444" : "4px solid #aaa";
        el.style.background = u.photoURL ? `url("${u.photoURL}") center/cover` : (u.online ? "#bbb" : "#888");

        const popup = new mapboxgl.Popup({ offset: 12 }).setHTML(`
          <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif">
            <div style="font-weight:600;margin-bottom:6px">${u.name || "Anonym"}</div>
            <div style="display:flex;gap:8px">
              <button id="pp-ping-${id}" style="padding:6px 10px;border-radius:10px;border:0;background:#111;color:#fff">📩 Ping</button>
              <button id="pp-chat-${id}" style="padding:6px 10px;border-radius:10px;border:1px solid #111;background:#fff">💬 Chat</button>
            </div>
          </div>
        `);

        if (!was) {
          markers.current[id] = new mapboxgl.Marker(el).setLngLat([u.lng, u.lat]).setPopup(popup).addTo(map);
        } else {
          was.setLngLat([u.lng, u.lat]).setPopup(popup);
        }

        // přivázat kliky až po otevření popupu
        markers.current[id].getElement().onclick = () => {
          setTimeout(() => {
            const pingBtn = document.getElementById(`pp-ping-${id}`);
            const chatBtn = document.getElementById(`pp-chat-${id}`);
            if (pingBtn) pingBtn.onclick = () => sendPing(id);
            if (chatBtn) chatBtn.onclick = () => quickMsg(id);
          }, 0);
        };
      });

      // odstranit markery, které už v DB nejsou
      Object.keys(markers.current).forEach(id => {
        if (!data[id]) { markers.current[id].remove(); delete markers.current[id]; }
      });
    });
  }, [map, showOffline]);

  // příjem pingů & zpráv
  useEffect(() => {
    const pRef = ref(db, `pings/${uidRef.current}`);
    const unsubP = onValue(pRef, s => {
      const v = s.val();
      if (!v) return;
      if (soundOn) { try { pingSound.current.currentTime = 0; pingSound.current.play(); } catch {} }
      alert(`📩 Ping od ${v.from}`);
      remove(pRef);
    });

    const mRef = ref(db, `messages/${uidRef.current}`);
    const unsubM = onValue(mRef, s => {
      const v = s.val();
      if (!v) return;
      const last = Object.values(v).flat().slice(-1)[0];
      if (last) {
        if (soundOn) { try { pingSound.current.currentTime = 0; pingSound.current.play(); } catch {} }
        alert(`💬 ${last.from}: ${last.text}`);
      }
      remove(mRef);
    });

    return () => { unsubP(); unsubM(); };
  }, [soundOn]);

  // ping & rychlá zpráva
  function sendPing(targetId) {
    set(ref(db, `pings/${targetId}`), { from: name || "Anonym", time: Date.now() });
  }
  function quickMsg(targetId) {
    const txt = prompt("Zpráva:");
    if (!txt) return;
    push(ref(db, `messages/${targetId}/${uidRef.current}`), { from: name || "Anonym", text: txt, time: Date.now() });
  }

  // === UPLOAD FOTKY (opraveno) ===
  async function uploadPhoto() {
    try {
      const file = fileRef.current?.files?.[0];
      if (!file) return;
      setUploading(true);
      setUploadPct(0);

      // zmenšit pro mobilní data
      const toUpload = await downscaleImage(file, 1024);
      const r = sref(storage, `profiles/${uidRef.current}.jpg`);

      const getUrlSmall = async () => {
        await uploadBytes(r, toUpload, { contentType: "image/jpeg" });
        return await getDownloadURL(r);
      };

      const getUrlResumable = () =>
        new Promise(async (resolve, reject) => {
          const task = uploadBytesResumable(r, toUpload, { contentType: "image/jpeg" });
          const timer = setTimeout(() => { try { task.cancel(); } catch {} ; reject(new Error("Timeout")); }, 120000);

          task.on("state_changed",
            snap => setUploadPct(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
            err => { clearTimeout(timer); reject(err); },
            async () => { clearTimeout(timer); resolve(await getDownloadURL(r)); }
          );
        });

      const url = toUpload.size <= 1_000_000 ? await getUrlSmall() : await getUrlResumable();

      setPhotoURL(url);
      if (myMarkerRef.current) {
        const el = myMarkerRef.current.getElement();
        el.style.background = `url("${url}") center/cover`;
      }
      await update(ref(db, `users/${uidRef.current}`), { photoURL: url, lastActive: Date.now(), online: true });
      alert("Fotka nahrána 👍");
    } catch (e) {
      alert("Nahrání fotky selhalo: " + (e?.message || e));
    } finally {
      setUploading(false);
      setUploadPct(0);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <div id="map" style={{ width: "100%", height: "100%" }} />

      {/* FAB */}
      <div style={{ position: "fixed", right: 16, bottom: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <button
          onClick={() => setShowChats(true)}
          style={{ width: 72, height: 72, borderRadius: 36, border: 0, background: "#e64444", color: "#fff", fontSize: 28, boxShadow: "0 6px 20px rgba(0,0,0,.3)" }}
          aria-label="Chaty"
        >💬</button>
        <button
          onClick={() => setShowSettings(true)}
          style={{ width: 72, height: 72, borderRadius: 36, border: 0, background: "#111b2e", color: "#fff", fontSize: 28, boxShadow: "0 6px 20px rgba(0,0,0,.3)" }}
          aria-label="Nastavení"
        >⚙️</button>
      </div>

      {/* Nastavení (mobil-friendly sheet) */}
      {showSettings && (
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, background: "#fff",
          borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16,
          boxShadow: "0 -10px 30px rgba(0,0,0,.25)", maxHeight: "90vh", overflow: "auto"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Nastavení</h2>
            <button onClick={() => setShowSettings(false)} style={{ padding: "8px 14px", borderRadius: 12, border: 0, background: "#111b2e", color: "#fff" }}>Zavřít</button>
          </div>

          <label style={{ display: "block", fontWeight: 600, marginTop: 8 }}>Jméno</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input value={name} onChange={e => setName(e.target.value)}
              style={{ flex: 1, padding: "10px 12px", borderRadius: 12, border: "1px solid #ddd" }}
              placeholder="Tvoje jméno" />
            <button
              onClick={() => update(ref(db, `users/${uidRef.current}`), { name })}
              style={{ padding: "10px 16px", borderRadius: 12, border: 0, background: "#111b2e", color: "#fff" }}
            >Uložit</button>
          </div>

          <label style={{ display: "block", fontWeight: 600, marginTop: 16 }}>Profilová fotka</label>
          <input ref={fileRef} type="file" accept="image/*" />
          <div style={{ display: "flex", gap: 12, marginTop: 10 }}>
            <button
              disabled={uploading || !fileRef.current}
              onClick={uploadPhoto}
              style={{
                flex: 1, padding: "12px 16px", borderRadius: 12, border: 0,
                background: uploading ? "#888" : "#0b0f1d", color: "#fff"
              }}
            >
              {uploading ? `Nahrávám… ${uploadPct}%` : "Nahrát fotku"}
            </button>
            <button
              onClick={() => { setSoundOn(s => !s); }}
              style={{ flex: 1, padding: "12px 16px", borderRadius: 12, border: 0, background: soundOn ? "#21a366" : "#111b2e", color: "#fff" }}
            >
              {soundOn ? "🔊 Zvuk povolen" : "🔇 Zvuk vypnut"}
            </button>
            <button
              onClick={() => { try { pingSound.current.currentTime = 0; pingSound.current.play(); } catch {} }}
              style={{ padding: "12px 16px", borderRadius: 12, border: "1px solid #111", background: "#fff" }}
            >
              Test
            </button>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
            <input type="checkbox" checked={showOffline} onChange={e => setShowOffline(e.target.checked)} />
            Zobrazit offline uživatele (šedě)
          </label>
        </div>
      )}

      {/* Chat list placeholder (zatím info) */}
      {showChats && (
        <div
          onClick={() => setShowChats(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.25)", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <div onClick={e => e.stopPropagation()} style={{ width: "90vw", maxWidth: 520, background: "#fff", borderRadius: 16, padding: 16 }}>
            <h2 style={{ marginTop: 0 }}>Chaty</h2>
            <p>Zatím žádné konverzace.</p>
            <div style={{ textAlign: "right" }}>
              <button onClick={() => setShowChats(false)} style={{ padding: "10px 16px", borderRadius: 12, border: 0, background: "#111b2e", color: "#fff" }}>Zavřít</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
