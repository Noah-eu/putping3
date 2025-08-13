// App.jsx (mobile-first)
// - Jedno FAB menu (profilovka, galerie, zvuk)
// - Tlačítko Chaty (seznam konverzací, otevření chatu, přerušení kontaktu)
// - Markery = avatar; klik => půlobrazovková kruhová galerie + Ping/Chat
// - Ping se zvukem (příjem i odeslání)
// - Nahrávání fotek: komprese + uploadBytes (jako v tvé funkční verzi)
// - Bez „starých“ markerů (jen aktivní poslední ~2 min)

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
  ref,
  set,
  update,
  onValue,
  remove,
  push,
  serverTimestamp,
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytes,
  getDownloadURL,
} from "firebase/storage";

/* ───────── Firebase ───────── */
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.firebasestorage.app",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
  measurementId: "G-RLMGM46M6X",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

/* ───────── Mapbox ───────── */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ───────── Helpers ───────── */
const now = () => Date.now();
const ONLINE_TTL = 2 * 60_000; // 2 min = považujeme jako aktivní

function pairIdOf(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

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

// Komprese obrázku na JPEG (delší strana max 900 px)
async function compressImage(file, maxDim = 900, quality = 0.82) {
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = reject;
    i.src = URL.createObjectURL(file);
  });
  const { width, height } = img;
  const ratio = Math.min(maxDim / Math.max(width, height), 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  return blob;
}

/* ───────── Component ───────── */
export default function App() {
  // Me & auth
  const [me, setMe] = useState(null); // {uid, name}
  const [nameDraft, setNameDraft] = useState(localStorage.getItem("userName") || "Anonym");

  // Sound
  const [soundEnabled, setSoundEnabled] = useState(localStorage.getItem("soundEnabled") === "1");
  const pingSound = useRef(new Audio("https://cdn.pixabay.com/download/audio/2022/03/15/audio_8b831a2f36.mp3?filename=notification-113724.mp3"));

  // Map & users
  const [map, setMap] = useState(null);
  const [users, setUsers] = useState({});
  const markers = useRef({}); // uid -> marker

  // FAB & menus
  const [fabOpen, setFabOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(null); // {uid, photos, index, name}
  const galleryStartX = useRef(0);

  // Chats
  const [chatsOpen, setChatsOpen] = useState(false);
  const [chatList, setChatList] = useState([]); // [{otherUid, lastText, lastTime, name, photoURL}]
  const [chatWith, setChatWith] = useState(null); // uid
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatText, setChatText] = useState("");

  // Local copies (my) photos
  const [myPhotoURL, setMyPhotoURL] = useState("");
  const [myPhotos, setMyPhotos] = useState([]); // gallery (max 8)

  /* ── Auth init ── */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      let u = user;
      if (!u) {
        const cred = await signInAnonymously(auth);
        u = cred.user;
      }
      const uid = u.uid;
      const name = localStorage.getItem("userName") || "Anonym";
      setMe({ uid, name });

      const meRef = ref(db, `users/${uid}`);
      update(meRef, {
        name,
        lastActive: now(),
        online: true,
      });

      // geolocation watch
      if ("geolocation" in navigator) {
        navigator.geolocation.watchPosition(
          (pos) => {
            const { latitude, longitude } = pos.coords;
            update(meRef, {
              lat: latitude,
              lng: longitude,
              lastActive: now(),
              online: true,
            });
          },
          () => {},
          { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
        );
      }
    });
    return () => unsub();
  }, []);

  /* ── Map init ── */
  useEffect(() => {
    if (map || !me) return;
    const m = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.42076, 50.08804],
      zoom: 5,
    });
    setMap(m);
    return () => m.remove();
  }, [me]);

  /* ── Users + markers ── */
  useEffect(() => {
    if (!map || !me) return;

    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      setUsers(data);

      // moje lokální cache (pro marker avataru)
      const mine = data[me.uid];
      setMyPhotoURL(mine?.photoURL || "");
      setMyPhotos(mine?.photos || []);

      // přidej/aktualizuj markery
      Object.entries(data).forEach(([uid, u]) => {
        if (!u?.lat || !u?.lng) return;
        const online = u.lastActive && now() - u.lastActive < ONLINE_TTL;

        if (!online) {
          if (markers.current[uid]) {
            markers.current[uid].remove();
            delete markers.current[uid];
          }
          return;
        }

        // vyrob element markeru (avatar nebo tečka)
        const el = document.createElement("div");
        el.style.width = uid === me.uid ? "34px" : "30px";
        el.style.height = uid === me.uid ? "34px" : "30px";
        el.style.borderRadius = "50%";
        el.style.boxShadow = uid === me.uid ? "0 0 0 3px #ef4444 inset" : "0 0 0 3px #147af3 inset";
        el.style.background = "#ddd";
        el.style.overflow = "hidden";
        el.style.border = "1px solid rgba(0,0,0,.1)";

        if (u.photoURL) {
          const img = document.createElement("img");
          img.src = u.photoURL;
          img.style.width = "100%";
          img.style.height = "100%";
          img.style.objectFit = "cover";
          el.appendChild(img);
        }

        const clickHandler = () => openGallery(uid);

        if (!markers.current[uid]) {
          const mk = new mapboxgl.Marker(el).setLngLat([u.lng, u.lat]).addTo(map);
          el.addEventListener("click", clickHandler);
          markers.current[uid] = mk;
        } else {
          markers.current[uid].setLngLat([u.lng, u.lat]);
          const oldEl = markers.current[uid].getElement();
          // přepíšeme obsah starého elementu
          oldEl.replaceWith(el);
          el.addEventListener("click", clickHandler);
          // navázat marker na nový element
          markers.current[uid]._element = el; // malé „hacknutí“ – Mapbox si element drží uvnitř, ale funguje
        }
      });

      // odstraň markery pro uživatele, kteří už nejsou online
      Object.keys(markers.current).forEach((uid) => {
        if (!data[uid] || now() - (data[uid]?.lastActive || 0) >= ONLINE_TTL) {
          markers.current[uid].remove();
          delete markers.current[uid];
        }
      });
    });

    return () => unsub();
  }, [map, me]);

  /* ── Ping (příjem) ── */
  useEffect(() => {
    if (!me) return;
    const inboxRef = ref(db, `pings/${me.uid}`);
    const unsub = onValue(inboxRef, (snap) => {
      const data = snap.val();
      if (!data) return;
      Object.entries(data).forEach(([fromUid, obj]) => {
        if (soundEnabled) {
          pingSound.current.currentTime = 0;
          pingSound.current.play().catch(() => {});
        }
        // vytvoříme záznam do userChats pro oba + smažeme ping
        const pid = pairIdOf(me.uid, fromUid);
        update(ref(db, `userChats/${me.uid}/${fromUid}`), { last: serverTimestamp() });
        update(ref(db, `userChats/${fromUid}/${me.uid}`), { last: serverTimestamp() });
        remove(ref(db, `pings/${me.uid}/${fromUid}`));
      });
    });
    return () => unsub();
  }, [me, soundEnabled]);

  /* ── Ping (odeslání) ── */
  async function sendPing(toUid) {
    if (!me) return;
    await set(ref(db, `pings/${toUid}/${me.uid}`), { time: serverTimestamp() });
    if (soundEnabled) {
      pingSound.current.currentTime = 0;
      pingSound.current.play().catch(() => {});
    }
    // založí „spojení“ v userChats jen u odesílatele (příjemce se založí při příjmu)
    update(ref(db, `userChats/${me.uid}/${toUid}`), { last: serverTimestamp() });
  }

  /* ── Chat seznam ── */
  useEffect(() => {
    if (!me) return;
    const ucRef = ref(db, `userChats/${me.uid}`);
    return onValue(ucRef, (snap) => {
      const uc = snap.val() || {};
      // složíme list s detaily druhé strany (jméno, foto)
      const list = Object.keys(uc).map((otherUid) => {
        const u = users[otherUid] || {};
        return {
          otherUid,
          name: u.name || "Anonym",
          photoURL: u.photoURL || "",
          lastTime: uc[otherUid]?.last || 0,
        };
      });
      // seřadit podle lastTime
      list.sort((a, b) => (b.lastTime || 0) - (a.lastTime || 0));
      setChatList(list);
    });
  }, [me, users]);

  function openChat(otherUid) {
    if (!me) return;
    setChatsOpen(false);
    setChatWith(otherUid);
    const pid = pairIdOf(me.uid, otherUid);
    const msgsRef = ref(db, `messages/${pid}`);
    return onValue(msgsRef, (snap) => {
      const data = snap.val() || {};
      const arr = Object.entries(data)
        .map(([id, m]) => ({ id, ...m }))
        .sort((a, b) => (a.time || 0) - (b.time || 0));
      setChatMsgs(arr);
    });
  }

  async function sendMessage() {
    if (!me || !chatWith || !chatText.trim()) return;
    const pid = pairIdOf(me.uid, chatWith);
    await push(ref(db, `messages/${pid}`), {
      from: me.uid,
      to: chatWith,
      text: chatText.trim(),
      time: Date.now(),
    });
    // posuň konverzaci nahoru
    update(ref(db, `userChats/${me.uid}/${chatWith}`), { last: serverTimestamp() });
    update(ref(db, `userChats/${chatWith}/${me.uid}`), { last: serverTimestamp() });
    setChatText("");
  }

  async function breakContact() {
    if (!me || !chatWith) return;
    const pid = pairIdOf(me.uid, chatWith);
    await remove(ref(db, `messages/${pid}`));
    await remove(ref(db, `userChats/${me.uid}/${chatWith}`));
    await remove(ref(db, `userChats/${chatWith}/${me.uid}`));
    setChatWith(null);
    setChatMsgs([]);
  }

  /* ── Galerie / marker klik ── */
  function openGallery(uid) {
    if (!users[uid]) return;
    const u = users[uid];
    const photos = (u.photos && Array.isArray(u.photos) ? u.photos : []).slice(0, 8);
    const arr = photos.length ? photos : (u.photoURL ? [u.photoURL] : []);
    setGalleryOpen({
      uid,
      name: u.name || "Anonym",
      photos: arr,
      index: 0,
      lastActive: u.lastActive || 0,
    });
  }

  function gallerySwipeStart(e) {
    galleryStartX.current = e.touches?.[0]?.clientX || 0;
  }
  function gallerySwipeMove(e) {
    // NIC: pouze registrujeme posun
  }
  function gallerySwipeEnd(e) {
    const endX = e.changedTouches?.[0]?.clientX || 0;
    const dx = endX - galleryStartX.current;
    if (!galleryOpen) return;
    const minSwipe = 40;
    if (dx > minSwipe) {
      setGalleryOpen((g) => ({ ...g, index: Math.max(0, g.index - 1) }));
    } else if (dx < -minSwipe) {
      setGalleryOpen((g) => ({ ...g, index: Math.min(g.photos.length - 1, g.index + 1) }));
    }
  }

  /* ── Nahrání fotek (profil + galerie) ── */
  async function uploadAvatar(file) {
    if (!me || !file) return;
    try {
      const small = await compressImage(file, 900, 0.82);
      const dest = sref(storage, `avatars/${me.uid}.jpg`);
      await uploadBytes(dest, small, { contentType: "image/jpeg" });
      const url = await getDownloadURL(dest);
      await update(ref(db, `users/${me.uid}`), {
        photoURL: url,
        lastActive: now(),
      });
      alert("📷 Profilová fotka nahrána.");
    } catch (e) {
      alert("Nahrání fotky se nezdařilo – zkus menší obrázek.");
    }
  }

  async function uploadGallery(file) {
    if (!me || !file) return;
    const u = users[me.uid] || {};
    const current = Array.isArray(u.photos) ? u.photos : [];
    if (current.length >= 8) {
      alert("Maximálně 8 fotek v galerii.");
      return;
    }
    try {
      const small = await compressImage(file, 900, 0.82);
      const filename = `${me.uid}-${Date.now()}.jpg`;
      const dest = sref(storage, `gallery/${me.uid}/${filename}`);
      await uploadBytes(dest, small, { contentType: "image/jpeg" });
      const url = await getDownloadURL(dest);
      const next = [...current, url].slice(0, 8);
      await update(ref(db, `users/${me.uid}`), {
        photos: next,
        lastActive: now(),
      });
      alert("🖼️ Fotka přidána do galerie.");
    } catch (e) {
      alert("Nahrání fotky se nezdařilo – zkus menší obrázek.");
    }
  }

  /* ── Uložení jména ── */
  async function saveName() {
    if (!me) return;
    const nm = (nameDraft || "Anonym").trim() || "Anonym";
    await update(ref(db, `users/${me.uid}`), { name: nm, lastActive: now() });
    localStorage.setItem("userName", nm);
    alert("✔️ Jméno uloženo");
  }

  /* ── UI ── */
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      {/* MAPA */}
      <div id="map" style={{ width: "100%", height: "100%" }} />

      {/* TLAČÍTKO Chaty (nad FAB) */}
      <button
        onClick={() => setChatsOpen(true)}
        style={{
          position: "fixed", right: 16, bottom: 96,
          width: 64, height: 64, borderRadius: "50%",
          border: "none", background: "#147af3", color: "#fff",
          fontSize: 24, boxShadow: "0 10px 24px rgba(0,0,0,.25)", zIndex: 10
        }}
        aria-label="Chaty"
      >
        💬
      </button>

      {/* FAB – hlavní */}
      <button
        onClick={() => setFabOpen((v) => !v)}
        style={{
          position: "fixed", right: 16, bottom: 20,
          width: 64, height: 64, borderRadius: "50%",
          border: "none", background: "#111827", color: "#fff",
          fontSize: 26, boxShadow: "0 10px 24px rgba(0,0,0,.25)", zIndex: 10
        }}
        aria-label="Menu"
      >
        ⚙️
      </button>

      {/* FAB menu (po kliknutí) */}
      {fabOpen && (
        <div
          style={{
            position: "fixed", right: 16, bottom: 92,
            display: "flex", flexDirection: "column", gap: 10, zIndex: 11
          }}
        >
          {/* Profilovka */}
          <label
            style={{
              display: "block",
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: "10px 12px",
              fontWeight: 700,
              boxShadow: "0 8px 20px rgba(0,0,0,.12)"
            }}
          >
            📷 Nahrát profilovku
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAvatar(f);
                setFabOpen(false);
                e.target.value = "";
              }}
            />
          </label>

          {/* Galerie */}
          <label
            style={{
              display: "block",
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: "10px 12px",
              fontWeight: 700,
              boxShadow: "0 8px 20px rgba(0,0,0,.12)"
            }}
          >
            🖼 Přidat fotku do galerie
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadGallery(f);
                setFabOpen(false);
                e.target.value = "";
              }}
            />
          </label>

          {/* Zvuk */}
          <button
            onClick={() => {
              if (!soundEnabled) {
                // odemknutí zvuku klikem
                pingSound.current.play().catch(()=>{});
                pingSound.current.pause();
              }
              const next = !soundEnabled;
              setSoundEnabled(next);
              localStorage.setItem("soundEnabled", next ? "1" : "0");
            }}
            style={{
              background: soundEnabled ? "#10b981" : "#111827",
              color: "#fff",
              border: "none",
              borderRadius: 12,
              padding: "10px 12px",
              fontWeight: 700,
              boxShadow: "0 8px 20px rgba(0,0,0,.12)"
            }}
          >
            {soundEnabled ? "🔊 Zvuk povolen" : "🔈 Povolit zvuk"}
          </button>

          {/* Jméno */}
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 10,
              boxShadow: "0 8px 20px rgba(0,0,0,.12)",
              width: 240
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 6 }}>Jméno</div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                style={{
                  flex: 1, height: 36, borderRadius: 10,
                  border: "1px solid #e5e7eb", padding: "0 10px"
                }}
              />
              <button
                onClick={() => { saveName(); setFabOpen(false); }}
                style={{
                  padding: "0 12px", borderRadius: 10,
                  border: "1px solid #147af3", background: "#147af3", color: "#fff"
                }}
              >
                Uložit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Seznam chatů */}
      {chatsOpen && (
        <div
          onClick={() => setChatsOpen(false)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 20,
            display: "flex", alignItems: "flex-end", justifyContent: "center"
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 480, background: "#fff",
              borderTopLeftRadius: 16, borderTopRightRadius: 16,
              maxHeight: "80vh", overflowY: "auto", padding: 12
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>Chaty</div>
              <button onClick={() => setChatsOpen(false)} style={{ border: "none", background: "transparent", fontSize: 20 }}>✖</button>
            </div>

            {chatList.length === 0 ? (
              <div style={{ color: "#6b7280", padding: "12px 6px" }}>Zatím žádné chaty.</div>
            ) : (
              chatList.map((c) => (
                <div
                  key={c.otherUid}
                  onClick={() => openChat(c.otherUid)}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "10px 8px", borderBottom: "1px solid #f1f5f9"
                  }}
                >
                  <div style={{ width: 42, height: 42, borderRadius: "50%", overflow: "hidden", background: "#e5e7eb" }}>
                    {c.photoURL ? (
                      <img src={c.photoURL} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : null}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700 }}>{c.name}</div>
                    <div style={{ color: "#6b7280", fontSize: 12 }}>
                      {c.lastTime ? timeAgo(c.lastTime) : "—"}
                    </div>
                  </div>
                  <div style={{ color: "#94a3b8" }}>›</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Chat okno */}
      {chatWith && (
        <div
          onClick={() => setChatWith(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 25,
            display: "flex", alignItems: "flex-end", justifyContent: "center"
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 480, background: "#fff",
              borderTopLeftRadius: 16, borderTopRightRadius: 16,
              maxHeight: "85vh", display: "flex", flexDirection: "column"
            }}
          >
            <div style={{ padding: 12, borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 800 }}>Chat</div>
              <div style={{ display: "flex", gap: 10 }}>
                <button onClick={breakContact} style={{ border: "1px solid #ef4444", background: "#fff", color: "#ef4444", borderRadius: 10, padding: "6px 10px" }}>Přerušit kontakt</button>
                <button onClick={() => setChatWith(null)} style={{ border: "none", background: "transparent", fontSize: 20 }}>✖</button>
              </div>
            </div>

            <div style={{ padding: 10, gap: 6, display: "flex", flexDirection: "column", overflowY: "auto" }}>
              {chatMsgs.map((m) => {
                const mine = m.from === me?.uid;
                return (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: mine ? "flex-end" : "flex-start",
                      background: mine ? "#e6f0ff" : "#f2f2f2",
                      borderRadius: 14,
                      padding: "8px 10px",
                      maxWidth: "82%"
                    }}
                  >
                    <div style={{ fontSize: 11, color: "#666" }}>
                      {new Date(m.time || Date.now()).toLocaleTimeString()}
                    </div>
                    <div>{m.text}</div>
                  </div>
                );
              })}
            </div>

            <div style={{ padding: 10, borderTop: "1px solid #f1f5f9", display: "flex", gap: 8 }}>
              <input
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                placeholder="Napiš zprávu…"
                style={{
                  flex: 1, border: "1px solid #e5e7eb", borderRadius: 12, padding: "10px 12px"
                }}
              />
              <button
                onClick={sendMessage}
                style={{
                  padding: "10px 14px", borderRadius: 12,
                  border: "1px solid #147af3", background: "#147af3", color: "#fff"
                }}
              >
                ➤
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Galerie (půl obrazovky, kruhová) */}
      {galleryOpen && (
        <div
          onClick={() => setGalleryOpen(null)}
          style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 30,
            display: "flex", alignItems: "flex-end", justifyContent: "center"
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%", maxWidth: 520, background: "#fff",
              borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: 16
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontWeight: 800 }}>{galleryOpen.name}</div>
              <button onClick={() => setGalleryOpen(null)} style={{ border: "none", background: "transparent", fontSize: 20 }}>✖</button>
            </div>

            <div
              onTouchStart={gallerySwipeStart}
              onTouchMove={gallerySwipeMove}
              onTouchEnd={gallerySwipeEnd}
              style={{ display: "flex", justifyContent: "center", marginTop: 16 }}
            >
              <div
                style={{
                  width: "70vw", maxWidth: 360, aspectRatio: "1/1",
                  borderRadius: "50%", overflow: "hidden",
                  border: "6px solid #f1f5f9", background: "#e5e7eb",
                  display: "flex", alignItems: "center", justifyContent: "center"
                }}
              >
                {galleryOpen.photos.length ? (
                  <img
                    src={galleryOpen.photos[galleryOpen.index]}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{ color: "#6b7280" }}>Žádné fotky</div>
                )}
              </div>
            </div>

            <div style={{ textAlign: "center", marginTop: 10, color: "#6b7280" }}>
              {galleryOpen.photos.length ? `${galleryOpen.index + 1}/${galleryOpen.photos.length}` : ""}
            </div>

            {/* Akce pod galerií */}
            {galleryOpen.uid !== me?.uid && (
              <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
                <button
                  onClick={() => { sendPing(galleryOpen.uid); alert("📩 Ping odeslán"); }}
                  style={{
                    flex: 1, padding: "10px 12px", borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff", fontWeight: 700
                  }}
                >
                  📩 Ping
                </button>
                <button
                  onClick={() => { setGalleryOpen(null); openChat(galleryOpen.uid); }}
                  style={{
                    flex: 1, padding: "10px 12px", borderRadius: 12, border: "1px solid #147af3", background: "#147af3", color: "#fff", fontWeight: 700
                  }}
                >
                  💬 Chat
                </button>
              </div>
            )}

            {/* Info o aktivitě */}
            <div style={{ textAlign: "center", marginTop: 10, color: "#6b7280", fontSize: 12 }}>
              Naposledy online: {galleryOpen.lastActive ? timeAgo(galleryOpen.lastActive) : "—"}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
