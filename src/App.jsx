import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  push,
  remove,
  onDisconnect,
} from "firebase/database";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

/* ------------------ MAPBOX TOKEN ------------------ */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ------------------ FIREBASE CONFIG ------------------ */
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

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);

/* ------------------ HELPERY ------------------ */
const TTL_OFFLINE = 5 * 60 * 1000; // 5 minut
const now = () => Date.now();

function formatLastOnline(ts) {
  if (!ts) return "neznámo";
  const diff = Math.floor((now() - ts) / 1000);
  if (diff < 60) return před pár sekundami;
  const m = Math.floor(diff / 60);
  if (m < 60) return před ${m} min;
  const h = Math.floor(m / 60);
  if (h < 24) return před ${h} h;
  const d = Math.floor(h / 24);
  return před ${d} dny;
}

function pairId(a, b) {
  return a < b ? ${a}_${b} : ${b}_${a};
}

/* ------------------ UI KOMPONENTA ------------------ */
export default function App() {
  const [map, setMap] = useState(null);
  const [me, setMe] = useState(() => ({
    id: localStorage.getItem("userId") || crypto.randomUUID(),
    name: localStorage.getItem("userName") || "Anonymní uživatel",
    photoURL: localStorage.getItem("photoURL") || "",
  }));
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("soundEnabled") === "1"
  );

  const [users, setUsers] = useState({});
  const [contacts, setContacts] = useState({}); // {otherUid: 'accepted'|'pinged'}
  const [openChatWith, setOpenChatWith] = useState(null); // uid partnera
  const [messages, setMessages] = useState([]); // aktuální vlákno
  const [draft, setDraft] = useState("");
  const [uiReady, setUiReady] = useState(
    !!localStorage.getItem("userNameSaved")
  );

  const markersRef = useRef({}); // {uid: marker}
  const myMarkerRef = useRef(null);
  const watchIdRef = useRef(null);
  const audioRef = useRef(new Audio("/ping.mp3")); // nahraj si libovolný ping zvuk do public/

  // persist basic info
  useEffect(() => {
    localStorage.setItem("userId", me.id);
    localStorage.setItem("userName", me.name);
    if (me.photoURL) localStorage.setItem("photoURL", me.photoURL);
  }, [me]);

  /* ----------- Inicializace mapy a vlastní polohy ----------- */
  useEffect(() => {
    if (map) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const m = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v11",
          center: [longitude, latitude],
          zoom: 14,
        });
        setMap(m);

        // Ulož se do DB + onDisconnect cleanup (nezmizí poslední poloha, jen záznam o tom, že jsi online)
        const meRef = ref(db, users/${me.id});
        set(meRef, {
          name: me.name,
          photoURL: me.photoURL || "",
          lat: latitude,
          lng: longitude,
          lastActive: now(),
        });
        onDisconnect(meRef).update({ lastActive: now() });

        // vlastní marker (červený)
        const el = document.createElement("div");
        el.style.cssText =
          "width:14px;height:14px;border-radius:50%;background:#e53935;border:2px solid white;box-shadow:0 0 0 2px #e53935;";
        myMarkerRef.current = new mapboxgl.Marker(el)
          .setLngLat([longitude, latitude])
          .setPopup(
            new mapboxgl.Popup({ offset: 25 }).setHTML(
              <b>${me.name}</b><br>${new Date().toLocaleTimeString()}
            )
          )
          .addTo(m);

        // live watching position (jen posíláme do DB a aktualizujeme marker)
        watchIdRef.current = navigator.geolocation.watchPosition(
          (p) => {
            const { latitude: la, longitude: lo } = p.coords;
            myMarkerRef.current?.setLngLat([lo, la]);
            update(meRef, { lat: la, lng: lo, lastActive: now(), name: me.name });
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
        );

        setUiReady(!!localStorage.getItem("userNameSaved"));
      },
      () => alert("Nepodařilo se zjistit polohu."),
      { enableHighAccuracy: true }
    );

    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  /* ----------- Odběr uživatelů ----------- */
  useEffect(() => {
    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      setUsers(data);
      if (!map) return;

      const t = now();
      // přidej/aktualizuj markery
      Object.entries(data).forEach(([uid, u]) => {
        if (uid === me.id) return;
        const offline = !u.lastActive || t - u.lastActive > TTL_OFFLINE;

        const color = offline ? "#9e9e9e" : "#1e88e5";
        const shadow = offline ? "#9e9e9e" : "#1e88e5";

        // marker
        if (!markersRef.current[uid] && u.lng != null && u.lat != null) {
          const el = document.createElement("div");
          el.style.cssText = width:12px;height:12px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 0 0 2px ${shadow};;
          const marker = new mapboxgl.Marker(el)
            .setLngLat([u.lng, u.lat])
            .setPopup(
              new mapboxgl.Popup({ offset: 25 }).setHTML(
                popupHtml(uid, u, offline, contacts[uid])
              )
            )
            .addTo(map);

          // otevřu když kliknu → refresh obsahu popupu
          marker.getElement().addEventListener("click", () => {
            marker.setPopup(
              new mapboxgl.Popup({ offset: 25 }).setHTML(
                popupHtml(uid, users[uid] || u, offline, contacts[uid])
              )
            );
          });

          markersRef.current[uid] = marker;
        } else if (markersRef.current[uid]) {
          // online se hýbe, offline necháváme poslední známou pozici
          if (!offline && u.lng != null && u.lat != null) {
            markersRef.current[uid].setLngLat([u.lng, u.lat]);
          }
          // barva podle online/offline
          const el = markersRef.current[uid].getElement();
          el.style.background = color;
          el.style.boxShadow = 0 0 0 2px ${shadow};
          // refresh popupu
          markersRef.current[uid].setPopup(
            new mapboxgl.Popup({ offset: 25 }).setHTML(
              popupHtml(uid, u, offline, contacts[uid])
            )
          );
        }
      });

      // smaž markery, co už v DB nejsou
      Object.keys(markersRef.current).forEach((uid) => {
        if (!data[uid]) {
          markersRef.current[uid].remove();
          delete markersRef.current[uid];
        }
      });
    });

    return () => unsub();
  }, [map, me.id, contacts, users]);

  /* ----------- Odběr kontaktů (ping/accepted) ----------- */
  useEffect(() => {
    const cRef = ref(db, contacts/${me.id});
    const unsub = onValue(cRef, (snap) => {
      setContacts(snap.val() || {});
    });
    return () => unsub();
  }, [me.id]);

  /* ----------- Odběr zpráv pro otevřený chat ----------- */
  useEffect(() => {
    if (!openChatWith) return () => {};
    const pid = pairId(me.id, openChatWith);
    const chatRef = ref(db, chats/${pid});
    const unsub = onValue(chatRef, (snap) => {
      const data = snap.val() || {};
      const list = Object.entries(data)
        .map(([id, v]) => ({ id, ...v }))
        .sort((a, b) => a.time - b.time);
      setMessages(list);
    });
    return () => unsub();
  }, [openChatWith, me.id]);

  /* ----------- Popup HTML ----------- */
  function popupHtml(uid, u, offline, relation) {
    const photo = u?.photoURL
      ? <img src="${u.photoURL}" style="width:46px;height:46px;border-radius:50%;object-fit:cover;margin-right:8px;border:1px solid #ddd" />
      : <div style="width:46px;height:46px;border-radius:50%;background:#ccc;display:inline-flex;align-items:center;justify-content:center;margin-right:8px;border:1px solid #ddd">👤</div>;

    const last = offline
      ? `<div style="color:#616161;font-size:12px">Naposledy online: ${formatLastOnline(
          u?.lastActive
        )}</div>`
      : <div style="color:#2e7d32;font-size:12px">Právě online</div>;

    // tlačítka: buď PING, nebo CHAT (pokud accepted)
    const canChat = relation === "accepted";
    const pingBtn = canChat
      ? ""
      : <button id="ping_${uid}" style="padding:6px 10px;border:0;background:#1565c0;color:white;border-radius:6px;cursor:pointer">📩 Poslat ping</button>;
    const chatBtn = canChat
      ? <button id="chat_${uid}" style="padding:6px 10px;border:0;background:#2e7d32;color:white;border-radius:6px;cursor:pointer">💬 Chatovat</button>
      : "";

    // malý chat náhled (když je už otevřen, řeší komponenta)
    const wrap = `
      <div style="display:flex;align-items:center;margin-bottom:6px">
        ${photo}
        <div>
          <div style="font-weight:600">${u?.name || "Anonym"}</div>
          ${last}
        </div>
      </div>
      <div style="display:flex;gap:8px">${pingBtn}${chatBtn}</div>
      `;

    // Po vykreslení popupu navážeme kliky (jinak nejsou DOM prvky dostupné)
    setTimeout(() => {
      const pingEl = document.getElementById(ping_${uid});
      if (pingEl) pingEl.onclick = () => sendPing(uid);
      const chatEl = document.getElementById(chat_${uid});
      if (chatEl) chatEl.onclick = () => setOpenChatWith(uid);
    }, 0);

    return wrap;
  }

  /* ----------- PING / KONTAKTY ----------- */
  async function sendPing(toUid) {
    // pokud už je accepted, rovnou chat
    if (contacts[toUid] === "accepted") {
      setOpenChatWith(toUid);
      return;
    }
    // zapiš oběma
    await update(ref(db, contacts/${me.id}/${toUid}), { status: "pinged", time: now() });
    await update(ref(db, contacts/${toUid}/${me.id}), {
      status: "pinged-by",
      time: now(),
      fromName: me.name,
    });
    alert("Ping odeslán. Až druhý uživatel potvrdí, můžete si psát.");
  }

  async function acceptPing(fromUid) {
    await set(ref(db, contacts/${me.id}/${fromUid}), { status: "accepted", time: now() });
    await set(ref(db, contacts/${fromUid}/${me.id}), { status: "accepted", time: now() });
    setOpenChatWith(fromUid);
  }

  /* ----------- POSÍLÁNÍ ZPRÁV ----------- */
  async function sendMessage() {
    if (!openChatWith || !draft.trim()) return;
    const pid = pairId(me.id, openChatWith);
    const msgRef = ref(db, chats/${pid});
    const msg = {
      from: me.id,
      to: openChatWith,
      text: draft.trim(),
      time: now(),
    };
    await push(msgRef, msg);
    setDraft("");
  }

  /* ----------- ZVUK / NOTIFIKACE PŘI PŘÍCHODU ZPRÁVY ----------- */
  useEffect(() => {
    if (!openChatWith) {
      // obecný poslech všech vláken, abychom přehráli zvuk při libovolné příchozí zprávě
      const unsubList = [];
      Object.keys(contacts || {}).forEach((other) => {
        const pid = pairId(me.id, other);
        const r = ref(db, chats/${pid});
        const unsub = onValue(r, (snap) => {
          const data = snap.val() || {};
          const arr = Object.values(data);
          if (!arr.length) return;
          const last = arr[arr.length - 1];
          if (last.to === me.id && soundEnabled) {
            // přehraj zvuk jen u příchozí zprávy
            audioRef.current
              .play()
              .catch(() => {
                /* ignoruj prohlížeče bez gesta */
              });
          }
        });
        unsubList.push(unsub);
      });
      return () => unsubList.forEach((u) => u());
    }
    return () => {};
  }, [contacts, me.id, soundEnabled, openChatWith]);

  /* ----------- NASTAVENÍ ----------- */
  function saveName() {
    localStorage.setItem("userNameSaved", "1");
    setUiReady(true);
    update(ref(db, users/${me.id}), { name: me.name, lastActive: now() });
  }

  async function handlePhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    // zmenšení necháme na prohlížeči/uživateli; Storage v pohodě unese i větší (ale může to chvíli trvat)
    const sref = storageRef(storage, avatars/${me.id}/${file.name});
    await uploadBytes(sref, file, { contentType: file.type });
    const url = await getDownloadURL(sref);
    setMe((m) => ({ ...m, photoURL: url }));
    await update(ref(db, users/${me.id}), { photoURL: url, lastActive: now() });
    alert("Fotka nahrána.");
  }

  function toggleSound() {
    const val = !soundEnabled;
    setSoundEnabled(val);
    localStorage.setItem("soundEnabled", val ? "1" : "0");
    if (val) {
      // odemknout audio (vyžaduje gesture)
      audioRef.current
        .play()
        .then(() => audioRef.current.pause())
        .catch(() => {});
    }
  }

  /* ----------- UI ----------- */
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      {/* Nastavení (kolečko) – vpravo nahoře */}
      <div
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          zIndex: 5,
          display: "flex",
          gap: 8,
        }}
      >
        <details style={{ background: "white", borderRadius: 8, padding: 8 }}>
          <summary style={{ cursor: "pointer" }}>⚙️ Nastavení</summary>
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            <label style={{ fontSize: 12 }}>Jméno</label>
            <input
              value={me.name}
              onChange={(e) => setMe((m) => ({ ...m, name: e.target.value }))}
              style={{ padding: 6, borderRadius: 6, border: "1px solid #ddd" }}
            />
            <button
              onClick={saveName}
              style={{
                padding: "6px 10px",
                border: 0,
                background: "#1565c0",
                color: "white",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Uložit jméno
            </button>

            <div style={{ height: 1, background: "#eee", margin: "4px 0" }} />

            <label
              htmlFor="photo"
              style={{
                display: "inline-block",
                padding: "6px 10px",
                background: "#8e24aa",
                color: "white",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              📷 Nahrát fotku
            </label>
            <input id="photo" type="file" accept="image/*" onChange={handlePhoto} hidden />

            <button
              onClick={toggleSound}
              style={{
                padding: "6px 10px",
                border: 0,
                background: soundEnabled ? "#2e7d32" : "#757575",
                color: "white",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {soundEnabled ? "🔊 Zvuk povolen" : "🔇 Povolit zvuk"}
            </button>
          </div>
        </details>
      </div>

      {/* Horní lišta – jen dokud uživatel neuloží jméno poprvé */}
      {!uiReady && (
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            right: 90,
            zIndex: 5,
            background: "white",
            borderRadius: 8,
            padding: 8,
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            value={me.name}
            onChange={(e) => setMe((m) => ({ ...m, name: e.target.value }))}
            style={{ flex: 1, padding: 6, borderRadius: 6, border: "1px solid #ddd" }}
            placeholder="Zadej jméno"
          />
          <button
            onClick={saveName}
            style={{
              padding: "6px 10px",
              border: 0,
              background: "#1565c0",
              color: "white",
              borderRadius: 6,
              cursor: "pointer",
            }}
          >
            Uložit
          </button>
        </div>
      )}

      {/* Chat panel (pravý spodní roh) */}
      {openChatWith && (
        <div
          style={{
            position: "absolute",
            right: 10,
            bottom: 10,
            width: 320,
            height: 380,
            background: "white",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,.15)",
            zIndex: 6,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: 10,
              background: "#1565c0",
              color: "white",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ fontWeight: 600 }}>
              Chat s {users[openChatWith]?.name || "uživatelem"}
            </div>
            <button
              onClick={() => setOpenChatWith(null)}
              style={{
                padding: "4px 8px",
                borderRadius: 6,
                border: 0,
                background: "rgba(255,255,255,.2)",
                color: "white",
                cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>

          <div style={{ flex: 1, padding: 10, overflowY: "auto" }}>
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  display: "flex",
                  justifyContent: m.from === me.id ? "flex-end" : "flex-start",
                  marginBottom: 6,
                }}
              >
                <div
                  style={{
                    maxWidth: 220,
                    padding: "6px 8px",
                    borderRadius: 8,
                    background: m.from === me.id ? "#e3f2fd" : "#f1f8e9",
                    border: "1px solid #eee",
                    fontSize: 14,
                  }}
                >
                  {m.text}
                  <div style={{ fontSize: 10, color: "#777", marginTop: 2 }}>
                    {new Date(m.time).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ padding: 8, borderTop: "1px solid #eee", display: "flex", gap: 6 }}>
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Napiš zprávu…"
              style={{
                flex: 1,
                padding: 8,
                borderRadius: 8,
                border: "1px solid #ddd",
              }}
            />
            <button
              onClick={sendMessage}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                border: 0,
                background: "#2e7d32",
                color: "white",
                cursor: "pointer",
              }}
            >
              Odeslat
            </button>
          </div>

          {/* Pokud si ještě nejste „accepted“, nabídneme potvrzení */}
          {contacts[openChatWith] !== "accepted" && (
            <div style={{ padding: 8, borderTop: "1px solid #eee", textAlign: "center" }}>
              <div style={{ marginBottom: 6 }}>
                Tento kontakt zatím není potvrzen. Odeslat ping a potvrdit?
              </div>
              <button
                onClick={() => acceptPing(openChatWith)}
                style={{
                  padding: "6px 10px",
                  background: "#1565c0",
                  color: "white",
                  border: 0,
                  borderRadius: 6,
                  cursor: "pointer",
                }}
              >
                ✅ Potvrdit kontakt
              </button>
            </div>
          )}
        </div>
      )}

      <div id="map" style={{ width: "100%", height: "100%" }}></div>
    </div>
  );
}
