// App.jsx — mobilní verze s galerií a půl-screen popupem
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getAuth, signInAnonymously, onAuthStateChanged
} from "firebase/auth";
import {
  getDatabase, ref, set, update, onValue, onDisconnect,
  query, orderByChild, equalTo, get, push, remove
} from "firebase/database";
import {
  getStorage, ref as sref, uploadBytes, getDownloadURL
} from "firebase/storage";

/* ===== MAPBOX (tvůj token) ===== */
mapboxgl.accessToken = "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ===== FIREBASE (tvůj config) ===== */
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

/* ===== Pomocné ===== */
const now = () => Date.now();
const isOnline = (u) => u && u.lastActive && (now() - u.lastActive) < 60000; // 60 s
const timeAgo = (ts) => {
  if (!ts) return "neznámo";
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "před " + s + " s";
  const m = Math.floor(s / 60);
  if (m < 60) return "před " + m + " min";
  const h = Math.floor(m / 60);
  if (h < 24) return "před " + h + " h";
  return "před " + Math.floor(h / 24) + " dny";
};
// trvalé ID zařízení pro úklid „duchů“
const deviceId = (() => {
  let id = localStorage.getItem("deviceId");
  if (!id) {
    id = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
    localStorage.setItem("deviceId", id);
  }
  return id;
})();
// zmenšení fotky v prohlížeči (max 800 px) → Blob JPEG
async function downscaleImage(file, maxDim = 800, quality = 0.85) {
  const img = document.createElement("img");
  const reader = new FileReader();
  const load = new Promise((res, rej) => {
    reader.onload = () => { img.src = reader.result; };
    reader.onerror = rej;
    img.onload = res;
    img.onerror = rej;
  });
  reader.readAsDataURL(file);
  await load;

  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);

  const canvas = document.createElement("canvas");
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, cw, ch);

  return await new Promise((res) => {
    canvas.toBlob((b) => res(b), "image/jpeg", quality);
  });
}

// unikátní ID dvojice pro chat/connection
const pairId = (a, b) => [a, b].sort().join("_");

/* ===== Hlavní komponenta ===== */
export default function App() {
  const mapRef = useRef(null);
  const meMarker = useRef(null);
  const markers = useRef({});
  const [uid, setUid] = useState(null);
  const [name, setName] = useState(localStorage.getItem("name") || "Anonym");
  const [photoURL, setPhotoURL] = useState(localStorage.getItem("photoURL") || "");
  const [photos, setPhotos] = useState([]); // galerie (URL), max 8
  const [soundOn, setSoundOn] = useState(localStorage.getItem("soundOn") === "true");
  const [showOffline, setShowOffline] = useState(true);
  const [showSettings, setShowSettings] = useState(false);

  const [popupState, setPopupState] = useState(null); // {id, data, index} pro půl-screen popup
  const tone = useRef(null);

  /* === init audio === */
  useEffect(() => {
    const a = document.createElement("audio");
    a.src = "https://assets.mixkit.co/active_storage/sfx/2560/2560-preview.mp3";
    a.preload = "auto";
    a.setAttribute("playsinline", "true");
    tone.current = a;
  }, []);

  /* === Auth === */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) setUid(u.uid);
      else signInAnonymously(auth);
    });
    return () => unsub();
  }, []);

  /* === Mapa === */
  useEffect(() => {
    if (mapRef.current) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const map = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v12",
          center: [longitude, latitude],
          zoom: 15,
          attributionControl: false
        });
        mapRef.current = map;

        const el = document.createElement("div");
        el.style.width = "40px";
        el.style.height = "40px";
        el.style.borderRadius = "999px";
        el.style.border = "3px solid #e74c3c";
        el.style.background = "#ddd";
        el.style.boxShadow = "0 2px 8px rgba(0,0,0,.25)";
        meMarker.current = new mapboxgl.Marker(el).setLngLat([longitude, latitude]).addTo(map);
      },
      () => {
        const map = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v12",
          center: [14.42076, 50.08804],
          zoom: 13
        });
        mapRef.current = map;
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  /* === Zápis sebe + úklid starých === */
  useEffect(() => {
    if (!uid || !mapRef.current) return;

    const writeMe = async () => {
      const c = mapRef.current.getCenter();
      const meRef = ref(db, `users/${uid}`);
      await set(meRef, {
        name, lat: c.lat, lng: c.lng, lastActive: now(),
        photoURL: photoURL || "", photos: photos || [], deviceId
      });
      onDisconnect(meRef).remove();

      // smaž staré záznamy téhož zařízení (jiné uid)
      const q = query(ref(db, "users"), orderByChild("deviceId"), equalTo(deviceId));
      const snap = await get(q);
      snap.forEach((ch) => { if (ch.key !== uid) remove(ref(db, `users/${ch.key}`)); });
    };

    writeMe();
    const int = setInterval(() => {
      const c = mapRef.current.getCenter();
      update(ref(db, `users/${uid}`), {
        name, lat: c.lat, lng: c.lng, lastActive: now(),
        photoURL: photoURL || "", photos: photos || [], deviceId
      });
      if (meMarker.current) meMarker.current.setLngLat([c.lng, c.lat]);
    }, 15000);

    return () => clearInterval(int);
  }, [uid, name, photoURL, photos]);

  /* === Poslech uživatelů → markery === */
  useEffect(() => {
    if (!mapRef.current || !uid) return;
    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};

      // smaž zmizelé
      Object.keys(markers.current).forEach((id) => {
        if (!data[id]) { markers.current[id].remove(); delete markers.current[id]; }
      });

      Object.entries(data).forEach(([id, u]) => {
        // skryj moje staré (stejný deviceId, jiné uid)
        if (u.deviceId === deviceId && id !== uid) return;

        const offline = !isOnline(u);
        if (offline && !showOffline) {
          if (markers.current[id]) { markers.current[id].remove(); delete markers.current[id]; }
          return;
        }

        // marker je fotka v kruhu
        const el = document.createElement("div");
        el.style.width = "44px";
        el.style.height = "44px";
        el.style.borderRadius = "999px";
        el.style.overflow = "hidden";
        el.style.border = id === uid ? "3px solid #e74c3c" : "3px solid #fff";
        el.style.boxShadow = "0 2px 8px rgba(0,0,0,.25)";
        el.style.background = offline ? "#9aa0a6" : "#ffffff";

        if (u.photoURL) {
          const img = document.createElement("img");
          img.src = u.photoURL;
          img.style.width = "100%";
          img.style.height = "100%";
          img.style.objectFit = "cover";
          img.style.filter = offline ? "grayscale(1) brightness(.85)" : "none";
          el.appendChild(img);
        }

        const mk = markers.current[id] || new mapboxgl.Marker(el).addTo(mapRef.current);
        mk.setLngLat([u.lng, u.lat]);
        mk.getElement().onclick = () => openProfilePopup(id, u);
        markers.current[id] = mk;
      });
    });
    return () => unsub();
  }, [uid, showOffline]);

  /* === Popup profil (půl obrazovky) === */
  function openProfilePopup(targetId, userObj) {
    if (targetId === uid) return; // na sebe ne
    setPopupState({
      id: targetId,
      data: userObj,
      index: 0 // aktivní fotka (0 = hlavní)
    });
  }

  // ping → vytvoří pending spojení; když druhá strana oplatí ping, bude chat
  async function sendPing(targetId) {
    await set(ref(db, `pings/${targetId}`), { from: uid, name, time: now() });
    const pid = pairId(uid, targetId);
    // zaznač „já už jsem poslal“
    await update(ref(db, `connections/${pid}`), { [uid]: true });
    alert("📩 Ping odeslán");
  }

  // chat otevře prompt (zatím jednoduché), píše do /messages/<pairId>
  async function sendChatMessage(targetId) {
    const txt = prompt("Zpráva:");
    if (!txt) return;
    const pid = pairId(uid, targetId);
    await push(ref(db, `messages/${pid}`), { from: uid, name, text: txt, time: now() });
  }

  // příjem pingů a zpráv (zvuk jen na příchozí)
  useEffect(() => {
    if (!uid) return;

    const pRef = ref(db, `pings/${uid}`);
    const unsubPing = onValue(pRef, (s) => {
      if (!s.exists()) return;
      const p = s.val();
      remove(pRef);
      // označ spojení i na mé straně → od teď „Chat“
      const pid = pairId(uid, p.from);
      update(ref(db, `connections/${pid}`), { [uid]: true });
      if (soundOn && tone.current) tone.current.play().catch(()=>{});
      alert("📩 Ping od " + (p.name || "uživatele"));
    });

    const mRef = ref(db, "messages");
    const unsubMsg = onValue(mRef, (s) => {
      const all = s.val() || {};
      const my = Object.entries(all).filter(([cid]) => cid.includes(uid));
      if (!my.length) return;
      // najdi poslední zprávu
      let last = null;
      my.forEach(([, msgs]) => Object.values(msgs).forEach((m) => { if (!last || m.time > last.time) last = m; }));
      if (last && last.from !== uid) {
        if (soundOn && tone.current) tone.current.play().catch(()=>{});
        // malý toast
        console.log("💬 Nová zpráva:", last.text);
      }
    });

    return () => { unsubPing(); unsubMsg(); };
  }, [uid, soundOn]);

  /* === Nastavení === */
  const saveName = async () => {
    localStorage.setItem("name", name);
    if (uid) await update(ref(db, `users/${uid}`), { name });
  };
  const toggleSound = () => {
    const v = !soundOn;
    setSoundOn(v);
    localStorage.setItem("soundOn", String(v));
  };
  async function uploadMainPhoto(file) {
    if (!file || !uid) return;
    const blob = (await downscaleImage(file, 800, 0.85)) || file;
    const path = `avatars/${uid}.jpg`;
    await uploadBytes(sref(storage, path), blob, { contentType: "image/jpeg" });
    const url = await getDownloadURL(sref(storage, path));
    setPhotoURL(url);
    localStorage.setItem("photoURL", url);
    await update(ref(db, `users/${uid}`), { photoURL: url });
    // také první v galerii (pokud prázdná)
    if (!photos || photos.length === 0) {
      const next = [url];
      setPhotos(next);
      await update(ref(db, `users/${uid}`), { photos: next });
    }
    alert("📸 Profilová fotka nahrána");
  }
  async function uploadGalleryPhoto(file) {
    if (!file || !uid) return;
    const nextCount = (photos?.length || 0);
    if (nextCount >= 8) { alert("Max 8 fotek v galerii."); return; }
    const blob = (await downscaleImage(file, 800, 0.85)) || file;
    const fn = `${uid}-${now()}.jpg`;
    const path = `gallery/${uid}/${fn}`;
    await uploadBytes(sref(storage, path), blob, { contentType: "image/jpeg" });
    const url = await getDownloadURL(sref(storage, path));
    const next = [...(photos || []), url].slice(0,8);
    setPhotos(next);
    await update(ref(db, `users/${uid}`), { photos: next });
    alert("🖼️ Fotka přidána do galerie");
  }

  // načti vlastní fotky při mountu/změně uid
  useEffect(() => {
    if (!uid) return;
    const myRef = ref(db, `users/${uid}`);
    const unsub = onValue(myRef, (s) => {
      const u = s.val();
      if (!u) return;
      if (u.photoURL) setPhotoURL(u.photoURL);
      if (Array.isArray(u.photos)) setPhotos(u.photos);
    });
    return () => unsub();
  }, [uid]);

  // popup – zda je s uživatelem už „připojení“ (oboustranný ping)
  const [connections, setConnections] = useState({});
  useEffect(() => {
    if (!uid) return;
    const cRef = ref(db, "connections");
    const unsub = onValue(cRef, (s) => {
      setConnections(s.val() || {});
    });
    return () => unsub();
  }, [uid]);
  function isConnectedWith(otherId) {
    const pid = pairId(uid, otherId);
    const c = connections[pid];
    return c && c[uid] && c[otherId];
  }

  /* === UI === */
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      <div id="map" style={{ width: "100%", height: "100%" }} />

      {/* FAB nastavení */}
      <button
        aria-label="Nastavení"
        onClick={() => setShowSettings(true)}
        style={{
          position: "fixed", right: 14, bottom: 20, width: 64, height: 64,
          borderRadius: 999, border: "none", background: "#111827", color: "#fff",
          fontSize: 26, boxShadow: "0 10px 20px rgba(0,0,0,.25)", zIndex: 10
        }}
      >⚙️</button>

      {/* Nastavení modal */}
      {showSettings && (
        <div
          onClick={() => setShowSettings(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.45)",
            display: "flex", alignItems: "center", justifyContent: "center", padding: 14, zIndex: 20
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 500, background: "#fff", borderRadius: 16,
              padding: 16, boxShadow: "0 10px 30px rgba(0,0,0,.3)"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Nastavení</h3>
              <button onClick={() => setShowSettings(false)}
                style={{ border: "none", background: "#111827", color: "#fff", padding: "8px 12px", borderRadius: 10 }}
              >Zavřít</button>
            </div>

            <div style={{ marginTop: 12 }}>
              <label style={{ fontWeight: 600, display: "block" }}>Jméno</label>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb" }}
                  placeholder="Tvoje jméno"
                />
                <button
                  onClick={async () => { localStorage.setItem("name", name); if (uid) await update(ref(db, `users/${uid}`), { name }); }}
                  style={{ border: "none", background: "#0ea5e9", color: "#fff", padding: "10px 12px", borderRadius: 10 }}
                >Uložit</button>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ fontWeight: 600, display: "block" }}>Zvuk oznámení</label>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <button
                  onClick={() => { setSoundOn(!soundOn); localStorage.setItem("soundOn", String(!soundOn)); }}
                  style={{ flex: 1, border: "none", background: soundOn ? "#10b981" : "#6b7280",
                           color: "#fff", padding: "10px 12px", borderRadius: 10 }}
                >{soundOn ? "🔊 Povolen" : "🔇 Zakázán"}</button>
                <button
                  onClick={() => tone.current?.play().catch(()=>alert("Klepni ještě jednou, prohlížeč to nepustil."))}
                  style={{ border: "none", background: "#374151", color: "#fff", padding: "10px 12px", borderRadius: 10 }}
                >Test</button>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ fontWeight: 600, display: "block" }}>Profilová fotka</label>
              <input
                type="file" accept="image/*"
                onChange={async (e) => { if (e.target.files?.[0]) await uploadMainPhoto(e.target.files[0]); e.target.value=""; }}
                style={{ marginTop: 6 }}
              />
              {photoURL ? (
                <img src={photoURL} alt="profil" style={{ width: 72, height: 72, borderRadius: "999px", objectFit: "cover", marginTop: 8 }} />
              ) : null}
            </div>

            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <label style={{ fontWeight: 600 }}>Galerie (max 8)</label>
                <label style={{ fontSize: 12, color: "#6b7280" }}>{photos?.length || 0} / 8</label>
              </div>
              <input
                type="file" accept="image/*"
                onChange={async (e) => { if (e.target.files?.[0]) await uploadGalleryPhoto(e.target.files[0]); e.target.value=""; }}
                style={{ marginTop: 6 }}
              />
              {photos?.length ? (
                <div style={{ display: "flex", gap: 8, marginTop: 8, overflowX: "auto" }}>
                  {photos.map((u, i) => (
                    <img key={i} src={u} alt={"g"+i} style={{ width: 56, height: 56, borderRadius: 12, objectFit: "cover" }} />
                  ))}
                </div>
              ) : null}
            </div>

            <div style={{ marginTop: 14 }}>
              <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={showOffline} onChange={(e) => setShowOffline(e.target.checked)} />
                Zobrazit offline uživatele (šedě)
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Půl-screen POPUP profilu (kruh + galerie + Ping/Chat) */}
      {popupState && (
        <div
          style={{
            position: "fixed", left: 0, right: 0, bottom: 0,
            height: "50vh", background: "#fff", borderTopLeftRadius: 16, borderTopRightRadius: 16,
            boxShadow: "0 -8px 20px rgba(0,0,0,.25)", zIndex: 30, padding: 14
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontWeight: 700 }}>{popupState.data?.name || "Uživatel"}</div>
            <button
              onClick={() => setPopupState(null)}
              style={{ border: "none", background: "#111827", color: "#fff", padding: "8px 12px", borderRadius: 10 }}
            >Zavřít</button>
          </div>

          <div style={{ color: "#6b7280", fontSize: 12, marginTop: 4 }}>
            {isOnline(popupState.data) ? "online" : "offline • " + timeAgo(popupState.data.lastActive)}
          </div>

          {/* kruhové hlavní foto */}
          <div style={{ display: "flex", justifyContent: "center", marginTop: 10 }}>
            <div style={{ width: 140, height: 140, borderRadius: "999px", overflow: "hidden", border: "4px solid #e5e7eb" }}>
              <img
                src={(popupState.data.photos && popupState.data.photos[popupState.index]) || popupState.data.photoURL || ""}
                alt="profile"
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            </div>
          </div>

          {/* náhledy galerie */}
          {popupState.data.photos && popupState.data.photos.length > 1 && (
            <div style={{ display: "flex", gap: 8, marginTop: 10, overflowX: "auto", padding: "0 2px" }}>
              {popupState.data.photos.map((u, i) => (
                <img
                  key={i}
                  src={u}
                  alt={"thumb"+i}
                  onClick={() => setPopupState({ ...popupState, index: i })}
                  style={{
                    width: 56, height: 56, borderRadius: 12, objectFit: "cover",
                    border: popupState.index === i ? "3px solid #111827" : "3px solid transparent"
                  }}
                />
              ))}
            </div>
          )}

          {/* akce */}
          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            {isConnectedWith(popupState.id) ? (
              <button
                onClick={() => sendChatMessage(popupState.id)}
                style={{ flex: 1, border: "none", background: "#2d3436", color: "#fff", padding: "12px 14px", borderRadius: 12 }}
              >💬 Chat</button>
            ) : (
              <button
                onClick={() => sendPing(popupState.id)}
                style={{ flex: 1, border: "none", background: "#ff4757", color: "#fff", padding: "12px 14px", borderRadius: 12 }}
              >📩 Ping</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
