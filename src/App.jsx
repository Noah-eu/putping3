import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref as dbRef,
  set,
  update,
  onValue,
  onDisconnect,
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "firebase/auth";

/* ===== Nastavení ===== */
mapboxgl.accessToken = "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com"     // <- správný GS bucket
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app, "gs://putping-dc57e.appspot.com"); // explicitně
const auth = getAuth(app);

/* ===== Pomocné ===== */
function nowTs() { return Date.now(); }
function isOnline(u) {
  if (!u || !u.lastActive) return false;
  return (nowTs() - u.lastActive) < 60000;
}
function circle(color, size) {
  const d = document.createElement("div");
  d.style.width = size + "px";
  d.style.height = size + "px";
  d.style.borderRadius = "50%";
  d.style.border = "4px solid " + (color === "me" ? "#ff4d4f" : "#999");
  d.style.background = color === "me" ? "#ffffff" : "#9aa0a6";
  d.style.boxShadow = "0 2px 8px rgba(0,0,0,.25)";
  return d;
}

/* ===== Komponenta ===== */
export default function App() {
  const [map, setMap] = useState(null);
  const [authReady, setAuthReady] = useState(false);

  const [userId] = useState(
    localStorage.getItem("userId") || Math.random().toString(36).slice(2)
  );
  const [name, setName] = useState(localStorage.getItem("userName") || "Anonym");
  const [photoURL, setPhotoURL] = useState(localStorage.getItem("photoURL") || "");
  const [showSettings, setShowSettings] = useState(false);
  const [showChats, setShowChats] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem("soundEnabled") === "true");
  const [showOffline, setShowOffline] = useState(localStorage.getItem("showOffline") !== "false");
  const [uploadPct, setUploadPct] = useState(null);

  const meRef = useRef(null);
  const markers = useRef({});
  const myPos = useRef({ lng: 14.42076, lat: 50.08804 });
  const tone = useRef(new Audio("https://cdn.pixabay.com/download/audio/2022/03/10/audio_2b6f3ee9a3.mp3?filename=notification-109698.mp3"));

  /* --- Auth: anonymní login --- */
  useEffect(() => {
    localStorage.setItem("userId", userId);
    // přihlas anonymně hned
    signInAnonymously(auth).catch(function(){});
    const unsub = onAuthStateChanged(auth, function(u){
      setAuthReady(!!u);
    });
    return function(){ unsub(); };
  }, [userId]);

  /* --- Mapa --- */
  useEffect(() => {
    let cancelled = false;
    function make(center) {
      if (cancelled) return;
      const m = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/streets-v12",
        center: center,
        zoom: 14,
        attributionControl: false
      });
      setMap(m);
    }
    navigator.geolocation.getCurrentPosition(
      function (p) {
        myPos.current = { lng: p.coords.longitude, lat: p.coords.latitude };
        make([myPos.current.lng, myPos.current.lat]);
      },
      function () { make([myPos.current.lng, myPos.current.lat]); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
    return function(){ cancelled = true; };
  }, []);

  /* --- Registrace v DB + keep alive --- */
  useEffect(() => {
    if (!map || !authReady) return;

    const r = dbRef(db, "users/" + userId);
    meRef.current = r;

    function write(p) {
      update(r, {
        name: name,
        lat: p.lat,
        lng: p.lng,
        photoURL: photoURL || "",
        lastActive: nowTs()
      });
    }

    write(myPos.current);
    const t = setInterval(function(){ write(myPos.current); }, 20000);
    onDisconnect(r).update({ lastActive: nowTs() });

    const watchId = navigator.geolocation.watchPosition(function (p) {
      myPos.current = { lng: p.coords.longitude, lat: p.coords.latitude };
      write(myPos.current);
    });

    return function(){
      clearInterval(t);
      if (watchId) navigator.geolocation.clearWatch(watchId);
    };
  }, [map, authReady, name, photoURL, userId]);

  /* --- Uživatelé / markery --- */
  useEffect(() => {
    if (!map) return;

    function clearAll() {
      Object.keys(markers.current).forEach(function (k) {
        try { markers.current[k].marker.remove(); } catch(e){}
      });
      markers.current = {};
    }

    const r = dbRef(db, "users");
    const unsub = onValue(r, function(snap){
      const data = snap.val() || {};
      clearAll();

      Object.keys(data).forEach(function(uid){
        const u = data[uid];
        if (!u || typeof u.lng !== "number" || typeof u.lat !== "number") return;

        const online = isOnline(u);
        // neschovávej šedě sám sebe
        if (!online && (!showOffline || uid === userId)) return;

        const isMe = uid === userId;
        const el = circle(isMe ? "me" : (online ? "me" : "off"), 28);
        const mk = new mapboxgl.Marker(el).setLngLat([u.lng, u.lat]).addTo(map);

        const popDiv = document.createElement("div");
        popDiv.style.minWidth = "120px";
        popDiv.style.fontSize = "14px";
        popDiv.style.textAlign = "center";

        const title = document.createElement("div");
        title.style.fontWeight = "600";
        title.style.marginBottom = "6px";
        title.innerText = u.name || "Anonym";
        popDiv.appendChild(title);

        if (u.photoURL) {
          const img = document.createElement("img");
          img.src = u.photoURL;
          img.alt = "profil";
          img.style.width = "64px";
          img.style.height = "64px";
          img.style.objectFit = "cover";
          img.style.borderRadius = "50%";
          img.style.display = "block";
          img.style.margin = "0 auto 6px";
          popDiv.appendChild(img);
        }

        const row = document.createElement("div");
        row.style.display = "flex";
        row.style.gap = "8px";
        row.style.justifyContent = "center";

        const pingBtn = document.createElement("button");
        pingBtn.innerText = "📩 Ping";
        pingBtn.style.padding = "6px 10px";
        pingBtn.style.borderRadius = "8px";
        pingBtn.style.border = "none";
        pingBtn.style.background = "#1677ff";
        pingBtn.style.color = "#fff";
        pingBtn.onclick = function(){
          const pr = dbRef(db, "pings/" + uid + "/" + userId);
          set(pr, { from: name, ts: nowTs() });
        };
        row.appendChild(pingBtn);

        const chatBtn = document.createElement("button");
        chatBtn.innerText = "💬 Chat";
        chatBtn.style.padding = "6px 10px";
        chatBtn.style.borderRadius = "8px";
        chatBtn.style.border = "none";
        chatBtn.style.background = "#10b981";
        chatBtn.style.color = "#fff";
        chatBtn.onclick = function(){
          alert("Chat UI doděláme – teď funguje ping.");
        };
        row.appendChild(chatBtn);

        popDiv.appendChild(row);
        const popup = new mapboxgl.Popup({ offset: 18 }).setDOMContent(popDiv);
        mk.setPopup(popup);

        markers.current[uid] = { marker: mk };
      });
    });

    return function(){ unsub(); };
  }, [map, showOffline, name, userId]);

  /* --- Příjem pingů + zvuk --- */
  useEffect(() => {
    const r = dbRef(db, "pings/" + userId);
    const unsub = onValue(r, function(snap){
      const data = snap.val();
      if (!data) return;
      const keys = Object.keys(data);
      keys.sort();
      const last = data[keys[keys.length - 1]];
      if (last) {
        if (soundEnabled) { tone.current.play().catch(function(){}); }
        alert("Ping od: " + (last.from || "uživatele"));
      }
      set(r, null);
    });
    return function(){ unsub(); };
  }, [userId, soundEnabled]);

  /* --- Handlery --- */
  function saveName() {
    localStorage.setItem("userName", name);
    if (meRef.current) update(meRef.current, { name: name });
  }

  function uploadPhoto(file) {
    if (!file) return;
    if (!authReady) { alert("Chvilku… přihlašuji. Zkus to za vteřinu."); return; }

    const ref = sref(storage, "avatars/" + userId + ".jpg");
    const task = uploadBytesResumable(ref, file, { contentType: file.type });

    setUploadPct(0);
    task.on("state_changed",
      function (snap) {
        if (!snap.totalBytes) return;
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        setUploadPct(pct);
      },
      function (err) {
        setUploadPct(null);
        alert("Nahrání fotky selhalo: " + err.code);
      },
      async function () {
        const url = await getDownloadURL(task.snapshot.ref);
        setPhotoURL(url);
        localStorage.setItem("photoURL", url);
        if (meRef.current) update(meRef.current, { photoURL: url });
        setUploadPct(null);
      }
    );
  }

  function unlockAudio() {
    tone.current.play().then(function(){
      tone.current.pause();
      tone.current.currentTime = 0;
      setSoundEnabled(true);
      localStorage.setItem("soundEnabled", "true");
    }).catch(function(){
      alert("Prohlížeč odmítl přehrát zvuk – klepni znovu.");
    });
  }

  /* --- UI --- */
  return (
    <div>
      <div id="map" style={{ width: "100vw", height: "100vh" }} />

      {/* FAB */}
      <div style={{
        position: "fixed", right: 16, bottom: 16,
        display: "flex", flexDirection: "column", gap: 12, zIndex: 10
      }}>
        <button
          onClick={function(){ setShowChats(true); }}
          style={{ width: 64, height: 64, borderRadius: 32, background: "#ef4444",
                   color: "#fff", border: "none", boxShadow: "0 8px 20px rgba(0,0,0,.25)", fontSize: 24 }}
          aria-label="Chaty"
        >💬</button>
        <button
          onClick={function(){ setShowSettings(true); }}
          style={{ width: 64, height: 64, borderRadius: 32, background: "#0f172a",
                   color: "#fff", border: "none", boxShadow: "0 8px 20px rgba(0,0,0,.25)", fontSize: 26 }}
          aria-label="Nastavení"
        >⚙️</button>
      </div>

      {/* Nastavení */}
      {showSettings && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.35)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20
        }}>
          <div style={{
            width: "92vw", maxWidth: 520, maxHeight: "86vh", overflow: "auto",
            background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 10px 30px rgba(0,0,0,.35)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>Nastavení</h2>
              <button
                onClick={function(){ setShowSettings(false); }}
                style={{ background: "#0f172a", color: "#fff", border: "none", padding: "10px 14px", borderRadius: 12 }}
              >Zavřít</button>
            </div>

            <div style={{ marginTop: 16 }}>
              <label>Jméno</label>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <input
                  value={name}
                  onChange={function(e){ setName(e.target.value); }}
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #ddd" }}
                  placeholder="Tvoje jméno"
                />
                <button
                  onClick={saveName}
                  style={{ background: "#111827", color: "#fff", border: "none", padding: "10px 14px", borderRadius: 10 }}
                >Uložit</button>
              </div>
            </div>

            <div style={{ marginTop: 16 }}>
              <label>Profilová fotka</label>
              <input
                type="file"
                accept="image/*"
                onChange={function(e){ uploadPhoto(e.target.files && e.target.files[0]); }}
                style={{ display: "block", marginTop: 6 }}
                disabled={!authReady}
              />
              {!authReady && <div style={{ marginTop: 8, fontSize: 14, color: "#6b7280" }}>Přihlašuji…</div>}
              {uploadPct !== null && <div style={{ marginTop: 8, fontSize: 14 }}>Nahrávám… {uploadPct}%</div>}
              {photoURL ? (
                <img src={photoURL} alt="profil" style={{ width: 72, height: 72, borderRadius: "50%", marginTop: 10, objectFit: "cover" }} />
              ) : null}
            </div>

            <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
              <button
                onClick={unlockAudio}
                style={{ background: "#10b981", color: "#fff", border: "none", padding: "10px 14px", borderRadius: 10 }}
              >{soundEnabled ? "🔊 Zvuk povolen" : "🔇 Povolit zvuk"}</button>
              <button
                onClick={function(){ tone.current.play().catch(function(){}); }}
                style={{ background: "#374151", color: "#fff", border: "none", padding: "10px 14px", borderRadius: 10 }}
              >Test</button>
            </div>

            <div style={{ marginTop: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  type="checkbox"
                  checked={showOffline}
                  onChange={function(e){
                    const v = e.target.checked;
                    setShowOffline(v);
                    localStorage.setItem("showOffline", String(v));
                  }}
                />
                Zobrazit offline uživatele (šedě)
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Chaty – placeholder */}
      {showChats && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,.35)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 20
        }}>
          <div style={{
            width: "92vw", maxWidth: 520, height: "70vh",
            background: "#fff", borderRadius: 16, padding: 20, boxShadow: "0 10px 30px rgba(0,0,0,.35)"
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>Chaty</h2>
              <button
                onClick={function(){ setShowChats(false); }}
                style={{ background: "#0f172a", color: "#fff", border: "none", padding: "10px 14px", borderRadius: 12 }}
              >Zavřít</button>
            </div>
            <div style={{ marginTop: 12, color: "#6b7280" }}>Zatím žádné konverzace.</div>
          </div>
        </div>
      )}
    </div>
  );
}
