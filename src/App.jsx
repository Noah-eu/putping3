import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref as dbRef,
  set,
  update,
  onValue,
  push,
  remove,
} from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";
import "./index.css";

/* ========= Mapbox ========= */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ========= Firebase (tvé údaje) ========= */
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL:
    "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com", // DŮLEŽITÉ
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const storage = getStorage(app);

/* ========= Helpers ========= */
const TTL_MS = 5 * 60_000; // online okno 5 minut

const escapeHtml = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "před pár sekundami";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `před ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `před ${h} h`;
  const d = Math.floor(h / 24);
  return `před ${d} dny`;
}

const chatIdFor = (a, b) => [a, b].sort().join("_");

export default function App() {
  /* ===== State ===== */
  const [map, setMap] = useState(null);
  const [meId, setMeId] = useState(localStorage.getItem("userId") || "");
  const [myName, setMyName] = useState(
    localStorage.getItem("userName") || "Anonymní uživatel"
  );
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("soundEnabled") === "1"
  );
  const [photoUrl, setPhotoUrl] = useState(
    localStorage.getItem("photoURL") || ""
  );

  const [settingsOpen, setSettingsOpen] = useState(
    !localStorage.getItem("setupDone")
  );
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPeer, setChatPeer] = useState(null); // {id, name, photoUrl}
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState("");

  const markers = useRef({}); // uid -> {marker, popup}
  const soundRef = useRef(
    new Audio(
      "https://cdn.pixabay.com/download/audio/2022/03/15/audio_3f61f7cdd2.mp3"
    )
  );
  const myMarkerRef = useRef(null);

  /* ===== Auth (anonymous) ===== */
  useEffect(() => {
    if (meId) return;
    signInAnonymously(auth)
      .then((cred) => {
        const uid = cred.user.uid;
        localStorage.setItem("userId", uid);
        setMeId(uid);
      })
      .catch(console.error);
  }, [meId]);

  /* ===== Map init + moje poloha (fallback Praha) ===== */
  useEffect(() => {
    if (map || !meId) return;

    const boot = (lng, lat) => {
      const m = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/streets-v11",
        center: [lng, lat],
        zoom: 14,
      });
      setMap(m);

      myMarkerRef.current = new mapboxgl.Marker({ color: "red" })
        .setLngLat([lng, lat])
        .setPopup(
          new mapboxgl.Popup({ offset: 25 }).setHTML(
            `<b>${escapeHtml(myName)}</b>`
          )
        )
        .addTo(m);

      const meR = dbRef(db, `users/${meId}`);
      set(meR, {
        name: myName,
        lat,
        lng,
        lastActive: Date.now(),
        photoUrl: photoUrl || "",
      });

      // průběžné updaty polohy (když je online)
      if ("geolocation" in navigator) {
        const watch = navigator.geolocation.watchPosition(
          (p) => {
            const { longitude: lo, latitude: la } = p.coords;
            myMarkerRef.current?.setLngLat([lo, la]);
            update(meR, {
              lat: la,
              lng: lo,
              lastActive: Date.now(),
              name: myName,
              photoUrl: photoUrl || "",
            });
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 0, timeout: 10_000 }
        );
        return () => navigator.geolocation.clearWatch(watch);
      }
    };

    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => boot(pos.coords.longitude, pos.coords.latitude),
        () => boot(14.42076, 50.08804),
        { enableHighAccuracy: true, timeout: 10_000 }
      );
    } else {
      boot(14.42076, 50.08804);
    }
  }, [map, meId, myName, photoUrl]);

  /* ===== Users → markery + popup (Ping / Odpovědět / Chat) ===== */
  useEffect(() => {
    if (!map || !meId) return;
    const usersR = dbRef(db, "users");
    return onValue(usersR, (snap) => {
      const data = snap.val() || {};
      const now = Date.now();

      // vytvoř / uprav markery
      Object.entries(data).forEach(([uid, u]) => {
        if (!u || typeof u.lng !== "number" || typeof u.lat !== "number") return;
        if (uid === meId) return;

        const online = u.lastActive && now - u.lastActive <= TTL_MS;

        // barva markeru: nepřečtené (oranžová) / online (modrá) / offline (šedá)
        const color = online ? "#2563eb" : "#9ca3af";
        const popupHtml = `
          <div class="pp-popup">
            ${
              u.photoUrl
                ? `<img class="pp-avatar" src="${u.photoUrl}" alt="" />`
                : `<div class="pp-avatar pp-avatar--empty"></div>`
            }
            <div class="pp-popup-title">${escapeHtml(u.name || "Uživatel")}</div>
            <div class="pp-popup-sub">${online ? "🟢 online" : `⚪ offline – ${timeAgo(u.lastActive)}`}</div>
            <div class="pp-popup-actions">
              <button data-act="ping" data-uid="${uid}" class="btn">📩 Ping</button>
              <button data-act="chat" data-uid="${uid}" class="btn btn-outline">💬 Chat</button>
            </div>
          </div>
        `;

        if (!markers.current[uid]) {
          const popup = new mapboxgl.Popup({ offset: 18 }).setHTML(popupHtml);
          const marker = new mapboxgl.Marker({ color })
            .setLngLat([online ? u.lng : u.lng, online ? u.lat : u.lat]) // offline se už nehýbou
            .setPopup(popup)
            .addTo(map);
          markers.current[uid] = { marker, popup, color };

          // připojit kliky až po otevření popupu
          popup.on("open", () => {
            const root = popup.getElement();
            root
              .querySelector(`[data-act="ping"][data-uid="${uid}"]`)
              ?.addEventListener("click", () => sendPing(uid));
            root
              .querySelector(`[data-act="chat"][data-uid="${uid}"]`)
              ?.addEventListener("click", () => openChat(uid));
          });
        } else {
          // změna barvy (marker nemá setter — upravíme fill na SVG)
          const el = markers.current[uid].marker.getElement();
          const circle = el.querySelector("svg circle");
          if (circle) circle.setAttribute("fill", color);
          markers.current[uid].popup.setHTML(popupHtml);
          if (online) {
            // online se posouvá; offline drží poslední známou pozici
            markers.current[uid].marker.setLngLat([u.lng, u.lat]);
          }
        }
      });

      // cleanup markerů smazaných uživatelů
      Object.keys(markers.current).forEach((uid) => {
        if (!data[uid]) {
          markers.current[uid].marker.remove();
          delete markers.current[uid];
        }
      });
    });
  }, [map, meId]);

  /* ===== Ping → odeslat ===== */
  function sendPing(targetId) {
    const r = dbRef(db, `pings/${targetId}`);
    const k = push(r).key;
    if (k) {
      set(dbRef(db, `pings/${targetId}/${k}`), {
        from: meId,
        fromName: myName,
        ts: Date.now(),
      });
    }
  }

  /* ===== Ping → příjem (zvuk + nabídka odpovědět) ===== */
  useEffect(() => {
    if (!meId) return;
    const r = dbRef(db, `pings/${meId}`);
    return onValue(r, (snap) => {
      const data = snap.val() || {};
      const keys = Object.keys(data);
      if (!keys.length) return;
      const last = data[keys[keys.length - 1]];
      if (last && last.from && last.from !== meId) {
        if (soundEnabled) {
          try {
            soundRef.current.currentTime = 0;
            soundRef.current.play();
          } catch {}
        }
        const ok = confirm(`📩 Ping od ${last.fromName || "uživatele"} — odpovědět?`);
        if (ok) {
          // po odpovědi pošli ping zpět a otevři chat oběma
          sendPing(last.from);
          openChat(last.from);
        }
        // smaž záznam
        remove(dbRef(db, `pings/${meId}/${keys[keys.length - 1]}`));
      }
    });
  }, [meId, soundEnabled]);

  /* ===== Chat otevřít + realtime zprávy ===== */
  function openChat(peerId) {
    // načti info o peerovi (jméno/fotka)
    onValue(
      dbRef(db, `users/${peerId}`),
      (s) => {
        const u = s.val() || {};
        setChatPeer({ id: peerId, name: u.name || "Uživatel", photoUrl: u.photoUrl || "" });
        setChatOpen(true);
      },
      { onlyOnce: true }
    );

    const cid = chatIdFor(meId, peerId);
    onValue(dbRef(db, `chats/${cid}`), (snap) => {
      const arr = Object.values(snap.val() || {}).sort((a, b) => (a.ts || 0) - (b.ts || 0));
      setChatMessages(arr);

      // pípni jen na cizí příchozí
      const last = arr[arr.length - 1];
      if (last && last.from !== meId && soundEnabled) {
        try {
          soundRef.current.currentTime = 0;
          soundRef.current.play();
        } catch {}
      }
    });
  }

  /* ===== Chat: odeslat text ===== */
  function sendMessage() {
    const text = (chatText || "").trim();
    if (!text || !chatPeer) return;
    const cid = chatIdFor(meId, chatPeer.id);
    const msgRef = push(dbRef(db, `chats/${cid}`));
    set(msgRef, {
      from: meId,
      fromName: myName,
      text,
      ts: Date.now(),
      type: "text",
    });
    setChatText("");
  }

  /* ===== Chat: poslat fotku (do vlákna) ===== */
  async function sendPhotoToChat(file) {
    if (!file || !chatPeer) return;
    try {
      const path = `chatPhotos/${chatIdFor(meId, chatPeer.id)}/${Date.now()}_${file.name}`;
      const upRef = storageRef(storage, path);
      const task = uploadBytesResumable(upRef, file, { contentType: file.type });
      await new Promise((res, rej) => {
        task.on("state_changed", () => {}, rej, res);
      });
      const url = await getDownloadURL(task.snapshot.ref);
      const msgRef = push(dbRef(db, `chats/${chatIdFor(meId, chatPeer.id)}`));
      set(msgRef, { from: meId, fromName: myName, img: url, ts: Date.now(), type: "image" });
    } catch (e) {
      alert("Nahrání fotky do chatu selhalo.");
    }
  }

  /* ===== Nastavení: uložit jméno, povolit zvuk, nahrát profilovku ===== */
  function saveSettings() {
    localStorage.setItem("userName", myName);
    localStorage.setItem("setupDone", "1");
    setSettingsOpen(false);
    if (meId) {
      update(dbRef(db, `users/${meId}`), {
        name: myName,
        lastActive: Date.now(),
      });
    }
  }
  function toggleSound() {
    const nv = !soundEnabled;
    setSoundEnabled(nv);
    localStorage.setItem("soundEnabled", nv ? "1" : "0");
    if (nv) {
      try {
        soundRef.current.currentTime = 0;
        soundRef.current.play();
      } catch {}
    }
  }
  async function uploadProfilePhoto(file) {
    if (!file || !meId) return;
    try {
      const refObj = storageRef(storage, `profilePics/${meId}.jpg`);
      const task = uploadBytesResumable(refObj, file, { contentType: file.type });
      await new Promise((res, rej) => {
        task.on("state_changed", () => {}, rej, res);
      });
      const url = await getDownloadURL(task.snapshot.ref);
      setPhotoUrl(url);
      localStorage.setItem("photoURL", url);
      await update(dbRef(db, `users/${meId}`), { photoUrl: url, lastActive: Date.now() });
      alert("Profilová fotka nahrána ✅");
    } catch (e) {
      alert("Nahrání fotky selhalo.");
    }
  }

  return (
    <div>
      {/* Nastavení (ozubené kolo) */}
      <button className="gear" onClick={() => setSettingsOpen(true)} title="Nastavení">
        ⚙️
      </button>

      {settingsOpen && (
        <div className="settings">
          <div className="settings__card">
            <div className="settings__header">
              <div className="settings__title">Nastavení</div>
              <button className="icon-btn" onClick={() => setSettingsOpen(false)}>✕</button>
            </div>

            <label className="field">
              <div className="field__label">Jméno</div>
              <input
                className="input"
                value={myName}
                onChange={(e) => setMyName(e.target.value)}
                placeholder="Tvoje jméno"
              />
            </label>

            <label className="field">
              <div className="field__label">Zvuk oznámení</div>
              <button
                className={`btn ${soundEnabled ? "" : "btn-outline"}`}
                onClick={toggleSound}
              >
                {soundEnabled ? "🔊 Zapnuto" : "🔇 Zapnout"}
              </button>
            </label>

            <label className="field">
              <div className="field__label">Profilová fotka</div>
              <div className="upload">
                {photoUrl ? <img src={photoUrl} alt="" className="avatar-preview" /> : <div className="avatar-preview empty" />}
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => uploadProfilePhoto(e.target.files?.[0])}
                />
              </div>
            </label>

            <div className="settings__footer">
              <button className="btn" onClick={saveSettings}>Uložit</button>
            </div>
          </div>
        </div>
      )}

      {/* Chat panel */}
      {chatOpen && chatPeer && (
        <div className="chat">
          <div className="chat__header">
            <div className="chat__peer">
              {chatPeer.photoUrl ? (
                <img src={chatPeer.photoUrl} alt="" className="chat__avatar" />
              ) : (
                <div className="chat__avatar empty" />
              )}
              <div className="chat__name">{chatPeer.name}</div>
            </div>
            <button className="icon-btn" onClick={() => setChatOpen(false)}>✕</button>
          </div>

          <div className="chat__messages">
            {chatMessages.map((m, i) => {
              const mine = m.from === meId;
              return (
                <div key={i} className={`msg ${mine ? "msg--me" : "msg--peer"}`}>
                  <div className="msg__time">{new Date(m.ts).toLocaleTimeString()}</div>
                  {m.type === "image" ? (
                    <img src={m.img} alt="" className="msg__image" />
                  ) : (
                    <div className="msg__bubble">{m.text}</div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="chat__composer">
            <input
              className="input"
              placeholder="Napiš zprávu…"
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
            />
            <label className="btn btn-outline">
              📷
              <input
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => sendPhotoToChat(e.target.files?.[0])}
              />
            </label>
            <button className="btn" onClick={sendMessage}>Odeslat</button>
          </div>
        </div>
      )}

      {/* Mapa */}
      <div id="map" className="map" />
    </div>
  );
}
