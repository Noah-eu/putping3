import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";

import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getDatabase,
  ref as dbRef,
  set,
  update,
  onValue,
  remove,
  push,
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

/* ===== Mapbox token ===== */
mapboxgl.accessToken = "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ===== Firebase config (tvůj) ===== */
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

/* ===== Helpers ===== */
const TTL_MS = 5 * 60 * 1000; // online okno 5 min

function timeAgo(ts) {
  if (!ts) return "";
  const d = Date.now() - ts;
  if (d < 60_000) return "před pár sekundami";
  const m = Math.floor(d / 60_000);
  if (m < 60) return `před ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `před ${h} h`;
  const dd = Math.floor(h / 24);
  return `před ${dd} dny`;
}

const chatIdFor = (a, b) => [a, b].sort().join("_");

// komprese fotky (max 800px, JPEG)
async function compressImage(file, maxDim = 800, quality = 0.8) {
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });
  const ratio = Math.min(maxDim / Math.max(img.width, img.height), 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * ratio);
  canvas.height = Math.round(img.height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) =>
    canvas.toBlob((b) => res(b), "image/jpeg", quality)
  );
  return blob;
}

/* ===== App ===== */
export default function App() {
  // stabilní publicId (zůstane stejné i když se změní anonymní UID)
  const [publicId] = useState(
    () => localStorage.getItem("publicId") || (() => {
      const id = Math.random().toString(36).slice(2, 10);
      localStorage.setItem("publicId", id);
      return id;
    })()
  );

  const [authUid, setAuthUid] = useState(null); // jen pro auth, nepoužíváme ho jako klíč v DB
  const [myName, setMyName] = useState(localStorage.getItem("userName") || "Anonym");
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem("soundEnabled") === "1");
  const [photoURL, setPhotoURL] = useState(localStorage.getItem("photoURL") || "");

  const [map, setMap] = useState(null);
  const [users, setUsers] = useState({}); // { publicId: {name,lat,lng,lastActive,photoURL} }
  const markers = useRef({}); // publicId -> marker

  // chat
  const [chatPeer, setChatPeer] = useState(null); // { id, name, photoURL }
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");

  const pingSound = useRef(new Audio("https://cdn.pixabay.com/download/audio/2022/03/15/audio_3f61f7cdd2.mp3"));

  /* ---- Auth ---- */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        const cred = await signInAnonymously(auth);
        setAuthUid(cred.user.uid);
      } else {
        setAuthUid(u.uid);
      }
    });
    return () => unsub();
  }, []);

  /* ---- Init mapy ---- */
  useEffect(() => {
    if (map || !authUid) return;
    const m = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v11",
      center: [14.42076, 50.08804],
      zoom: 13,
    });
    setMap(m);
    return () => m.remove();
  }, [authUid]);

  /* ---- Moje poloha + můj záznam v /users/<publicId> ---- */
  useEffect(() => {
    if (!map || !authUid) return;
    const meRef = dbRef(db, `users/${publicId}`);

    const writePresence = (lat, lng) =>
      update(meRef, {
        name: myName || "Anonym",
        lat,
        lng,
        lastActive: Date.now(),
        photoURL: photoURL || "",
      });

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          writePresence(pos.coords.latitude, pos.coords.longitude);
          const watch = navigator.geolocation.watchPosition(
            (p) => {
              // online – aktualizuj polohu
              writePresence(p.coords.latitude, p.coords.longitude);
            },
            () => {},
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
          );
          return () => navigator.geolocation.clearWatch(watch);
        },
        // fallback: jen zapiš „offline“ lastActive bez přesného místa
        () => writePresence(null, null),
        { enableHighAccuracy: true, timeout: 10_000 }
      );
    } else {
      // bez geolokace: jen lastActive
      writePresence(null, null);
    }
  }, [map, authUid, myName, photoURL, publicId]);

  /* ---- Poslech všech /users (pro markery) ---- */
  useEffect(() => {
    if (!map) return;
    const unsub = onValue(dbRef(db, "users"), (snap) => {
      const data = snap.val() || {};
      setUsers(data);

      // vykresli/aktualizuj markery
      Object.entries(data).forEach(([pid, u]) => {
        if (!u) return;
        const online = u.lastActive && Date.now() - u.lastActive < TTL_MS;
        const isMe = pid === publicId;
        const color = isMe ? "red" : online ? "#2563eb" : "#9ca3af";

        // Pozice: online = u lat/lng; offline = poslední známá (neposouváme)
        const lnglat =
          typeof u.lng === "number" && typeof u.lat === "number"
            ? [u.lng, u.lat]
            : null;

        if (!markers.current[pid]) {
          const marker = new mapboxgl.Marker({ color });
          if (lnglat) marker.setLngLat(lnglat);
          const popup = new mapboxgl.Popup({ offset: 18 }).setHTML(getPopupHTML(pid, u, online, isMe));
          marker.setPopup(popup).addTo(map);
          markers.current[pid] = marker;

          popup.on("open", () => wirePopupButtons(pid, u));
        } else {
          // barva
          const el = markers.current[pid].getElement();
          const path = el.querySelector("svg path");
          if (path) path.setAttribute("fill", color);

          // pozice – jen když online; offline necháváme „zamrzlé“
          if (lnglat && online) {
            markers.current[pid].setLngLat(lnglat);
          }

          // přegeneruj popup obsah (kontakty/online čas/fotka)
          markers.current[pid].getPopup().setHTML(getPopupHTML(pid, u, online, isMe));
        }
      });

      // odmazat markery, které už neexistují
      Object.keys(markers.current).forEach((pid) => {
        if (!data[pid]) {
          markers.current[pid].remove();
          delete markers.current[pid];
        }
      });
    });
    return () => unsub();
  }, [map, publicId]);

  function getPopupHTML(pid, u, online, isMe) {
    const inContacts = !!u?.contacts?.[publicId] || !!users?.[publicId]?.contacts?.[pid];
    const avatar = u?.photoURL
      ? `<img src="${u.photoURL}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;margin-right:8px" />`
      : `<div style="width:36px;height:36px;border-radius:50%;background:#eee;margin-right:8px"></div>`;
    const last = u?.lastActive ? timeAgo(u.lastActive) : "neznámo";

    return `
      <div style="font:13px/1.35 system-ui;-webkit-font-smoothing:antialiased;min-width:220px">
        <div style="display:flex;align-items:center;margin-bottom:8px">
          ${avatar}
          <div>
            <div><b>${u?.name || "Uživatel"}</b> ${isMe ? "(ty)" : ""}</div>
            <div style="color:#666">${online ? "🟢 online" : `⚪ offline – ${last}`}</div>
          </div>
        </div>
        ${
          isMe
            ? `<div style="color:#666">Tohle jsi ty.</div>`
            : inContacts
            ? `
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="pp-btn" data-act="chat" data-uid="${pid}">💬 Otevřít chat</button>
              </div>
            `
            : `
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <button class="pp-btn" data-act="ping" data-uid="${pid}">📩 Poslat ping</button>
              </div>
              <div style="color:#6b7280;margin-top:6px">Nejdřív si pošlete pingy – jakmile druhý odpoví, odemkne se chat.</div>
            `
        }
      </div>
    `;
  }

  function wirePopupButtons(pid, u) {
    const root = document.querySelector(".mapboxgl-popup-content");
    if (!root) return;
    const pingBtn = root.querySelector(`[data-act="ping"][data-uid="${pid}"]`);
    const chatBtn = root.querySelector(`[data-act="chat"][data-uid="${pid}"]`);

    if (pingBtn) pingBtn.onclick = () => sendPing(pid, u?.name || "Uživatel");
    if (chatBtn) chatBtn.onclick = () => openChatWith(pid);
  }

  /* ---- Ping (první kontakt) ---- */
  function sendPing(targetPid, targetName) {
    if (!authUid) return;
    const r = dbRef(db, `pings/${targetPid}`);
    const key = push(r).key;
    set(dbRef(db, `pings/${targetPid}/${key}`), {
      from: publicId,
      fromName: myName || "Anonym",
      ts: Date.now(),
    });
    if (soundEnabled) {
      pingSound.current.currentTime = 0;
      pingSound.current.play().catch(() => {});
    }
  }

  // příjem pingů – když už jsme si „odpověděli“, přidáme se navzájem do contacts a rovnou otevřeme chat
  useEffect(() => {
    if (!publicId) return;
    const inbox = dbRef(db, `pings/${publicId}`);
    return onValue(inbox, (snap) => {
      const data = snap.val() || {};
      const keys = Object.keys(data);
      if (!keys.length) return;

      // vezmeme poslední ping
      const lastKey = keys[keys.length - 1];
      const last = data[lastKey];

      if (soundEnabled) {
        try {
          pingSound.current.currentTime = 0;
          pingSound.current.play();
        } catch {}
      }

      // nabídka odpovědět – když odpovíš, jste kontakty
      const ok = confirm(`📩 Ping od ${last.fromName}. Odpovědět a otevřít chat?`);
      if (ok) {
        // 1) zapíšeme kontakty oběma směry
        update(dbRef(db, `users/${publicId}/contacts`), { [last.from]: true });
        update(dbRef(db, `users/${last.from}/contacts`), { [publicId]: true });
        // 2) smažeme ping
        remove(dbRef(db, `pings/${publicId}/${lastKey}`));
        // 3) otevřeme chat
        openChatWith(last.from);
      } else {
        // jen smažeme notifikaci
        remove(dbRef(db, `pings/${publicId}/${lastKey}`));
      }
    });
  }, [publicId, soundEnabled]);

  /* ---- Chat (jen pro kontakty) ---- */
  function openChatWith(peerPid) {
    // pokud ještě nejsme kontakty, nic (UI už nepustí, ale pro jistotu)
    const meContacts = users?.[publicId]?.contacts || {};
    const peerContacts = users?.[peerPid]?.contacts || {};
    if (!meContacts[peerPid] && !peerContacts[publicId]) {
      alert("Nejprve si pošlete pingy a potvrďte se navzájem.");
      return;
    }

    const peer = users[peerPid] || {};
    setChatPeer({ id: peerPid, name: peer.name || "Uživatel", photoURL: peer.photoURL || "" });

    const cid = chatIdFor(publicId, peerPid);
    onValue(dbRef(db, `messages/${cid}`), (s) => {
      const arr = Object.values(s.val() || {}).sort((a, b) => (a.ts || 0) - (b.ts || 0));
      setChatMessages(arr);

      const last = arr[arr.length - 1];
      if (last && last.from !== publicId && soundEnabled) {
        try {
          pingSound.current.currentTime = 0;
          pingSound.current.play();
        } catch {}
      }
    });
  }

  function sendMessage() {
    if (!chatPeer || !chatText.trim()) return;
    const cid = chatIdFor(publicId, chatPeer.id);
    const key = push(dbRef(db, `messages/${cid}`)).key;
    set(dbRef(db, `messages/${cid}/${key}`), {
      from: publicId,
      text: chatText.trim(),
      ts: Date.now(),
    });
    setChatText("");
  }

  /* ---- Nastavení: jméno, zvuk, profilová fotka ---- */
  function toggleSound() {
    const nx = !soundEnabled;
    setSoundEnabled(nx);
    localStorage.setItem("soundEnabled", nx ? "1" : "0");
    if (nx) {
      try {
        pingSound.current.currentTime = 0;
        pingSound.current.play();
      } catch {}
    }
  }

  async function saveName() {
    localStorage.setItem("userName", myName || "Anonym");
    await update(dbRef(db, `users/${publicId}`), {
      name: myName || "Anonym",
      lastActive: Date.now(),
    });
    alert("Uloženo.");
  }

  async function onPickAvatar(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const small = await compressImage(f, 800, 0.8);
      const dest = sref(storage, `avatars/${publicId}.jpg`);
      await uploadBytes(dest, small, { contentType: "image/jpeg" });
      const url = await getDownloadURL(dest);
      setPhotoURL(url);
      localStorage.setItem("photoURL", url);
      await update(dbRef(db, `users/${publicId}`), {
        photoURL: url,
        lastActive: Date.now(),
      });
      alert("🖼️ Fotka nahrána.");
    } catch (e2) {
      console.error(e2);
      alert("Nahrání fotky selhalo – zkus menší obrázek.");
    } finally {
      e.target.value = "";
    }
  }

  /* ---- UI ---- */
  return (
    <div>
      {/* ozubené kolo */}
      <button
        onClick={() => (document.getElementById("settings")!.style.display = "block")}
        style={{ position: "absolute", top: 10, right: 10, zIndex: 10, padding: 8, borderRadius: 10, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}
        title="Nastavení"
      >
        ⚙️
      </button>

      {/* mapa */}
      <div id="map" style={{ width: "100vw", height: "100vh" }} />

      {/* chat panel */}
      {chatPeer && (
        <div style={{ position: "absolute", right: 12, bottom: 12, width: 340, maxHeight: "70vh", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, display: "flex", flexDirection: "column", overflow: "hidden", zIndex: 12 }}>
          <div style={{ padding: 10, borderBottom: "1px solid #eee", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {chatPeer.photoURL ? (
                <img src={chatPeer.photoURL} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} />
              ) : (
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#eee" }} />
              )}
              <b>{chatPeer.name}</b>
            </div>
            <button onClick={() => setChatPeer(null)} style={{ border: "none", background: "transparent", cursor: "pointer" }}>✕</button>
          </div>

          <div style={{ padding: 10, flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
            {chatMessages.map((m, i) => {
              const mine = m.from === publicId;
              return (
                <div key={i} style={{ alignSelf: mine ? "flex-end" : "flex-start", background: mine ? "#e6f0ff" : "#f3f4f6", borderRadius: 10, padding: "6px 8px", maxWidth: "78%" }}>
                  <div style={{ fontSize: 11, color: "#6b7280" }}>{new Date(m.ts || Date.now()).toLocaleTimeString()}</div>
                  <div>{m.text}</div>
                </div>
              );
            })}
          </div>

          <div style={{ padding: 10, display: "flex", gap: 8, borderTop: "1px solid #eee" }}>
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Napiš zprávu…"
              style={{ flex: 1, border: "1px solid #ddd", borderRadius: 8, padding: "8px 10px" }}
            />
            <button onClick={sendMessage} style={{ border: "1px solid #ddd", background: "#fff", borderRadius: 8, padding: "8px 10px", cursor: "pointer" }}>
              Odeslat
            </button>
          </div>
        </div>
      )}

      {/* Nastavení modal */}
      <div id="settings" onClick={(e) => { if (e.target.id === "settings") e.currentTarget.style.display = "none"; }} style={{ display: "none", position: "absolute", inset: 0, background: "rgba(0,0,0,.25)", zIndex: 20, placeItems: "center" }}>
        <div style={{ margin: "10vh auto", width: 360, background: "#fff", borderRadius: 14, padding: 16, boxShadow: "0 10px 30px rgba(0,0,0,.15)" }}>
          <div style={{ fontWeight: 700, marginBottom: 12 }}>Nastavení</div>

          <label style={{ display: "block", marginBottom: 10, fontSize: 13 }}>
            Jméno
            <input
              value={myName}
              onChange={(e) => setMyName(e.target.value)}
              style={{ display: "block", width: "100%", border: "1px solid #ddd", borderRadius: 8, padding: "8px 10px", marginTop: 6 }}
            />
          </label>

          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => { const nx = !soundEnabled; setSoundEnabled(nx); localStorage.setItem("soundEnabled", nx ? "1" : "0"); if (nx) { try { pingSound.current.currentTime = 0; pingSound.current.play(); } catch {} } }} style={{ border: "1px solid #ddd", borderRadius: 8, padding: "8px 10px", background: soundEnabled ? "#e8fff1" : "#fff" }}>
              {soundEnabled ? "🔊 Zvuk povolen" : "🔈 Povolit zvuk"}
            </button>
          </div>

          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input type="file" accept="image/*" onChange={onPickAvatar} style={{ display: "none" }} id="fileAvatar" />
              <button onClick={() => document.getElementById("fileAvatar").click()} style={{ border: "1px solid #ddd", borderRadius: 8, padding: "8px 10px", background: "#fff" }}>
                📷 Přidat / změnit fotku
              </button>
              {photoURL ? <img src={photoURL} alt="" style={{ width: 28, height: 28, borderRadius: "50%", objectFit: "cover" }} /> : <span style={{ color: "#6b7280", fontSize: 12 }}>žádná fotka</span>}
            </label>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={() => (document.getElementById("settings").style.display = "none")} style={{ border: "1px solid #ddd", borderRadius: 8, padding: "8px 10px", background: "#fff" }}>Zavřít</button>
            <button onClick={saveName} style={{ border: "1px solid #147af3", borderRadius: 8, padding: "8px 12px", background: "#147af3", color: "#fff" }}>Uložit</button>
          </div>
        </div>
      </div>
    </div>
  );
}
