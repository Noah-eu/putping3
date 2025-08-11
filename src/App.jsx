import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { getDatabase, ref, update, onValue, onDisconnect, set, push } from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";

/* ===== Mapbox + Firebase ===== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

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
/* ============================ */

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

/* helpers */
const timeAgo = (ts) => {
  if (!ts) return "neznámo";
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `před ${diff} s`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `před ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `před ${h} h`;
  return `před ${Math.floor(h / 24)} dny`;
};

/** Jednodušší, stabilní zmenšení přes <img> + canvas (max 1024 px) */
function shrinkImage(file, maxSide = 1024) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error("Čtení souboru selhalo"));
    fr.onload = () => {
      const img = new Image();
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
      img.onerror = () => reject(new Error("Načtení obrázku selhalo"));
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

export default function App() {
  const [deviceId] = useState(() => {
    const ex = localStorage.getItem("deviceId");
    if (ex) return ex;
    const id = "dev_" + Math.random().toString(36).slice(2);
    localStorage.setItem("deviceId", id);
    return id;
  });

  const [uid, setUid] = useState(localStorage.getItem("uid") || "");
  const [name, setName] = useState(localStorage.getItem("name") || "Anonym");
  const [photoURL, setPhotoURL] = useState(localStorage.getItem("photoURL") || "");
  const [soundOn, setSoundOn] = useState(localStorage.getItem("soundOn") === "true");
  const [showOffline, setShowOffline] = useState(localStorage.getItem("showOffline") !== "false");

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [toast, setToast] = useState("");

  const mapRef = useRef(null);
  const myMarkerRef = useRef(null);
  const myPopupRef = useRef(null);
  const others = useRef({});
  const fileRef = useRef(null);
  const myPosRef = useRef(null);

  const beep = () => {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.2);
  };

  const showToast = (t) => {
    setToast(t);
    clearTimeout((showToast)._t);
    (showToast)._t = setTimeout(() => setToast(""), 1800);
  };

  /* AUTH */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      if (u) {
        setUid(u.uid);
        localStorage.setItem("uid", u.uid);
        update(ref(db, `users/${u.uid}`), { deviceId, lastActive: Date.now() }).catch(() => {});
        if (others.current[u.uid]) {
          others.current[u.uid].remove();
          delete others.current[u.uid];
        }
      }
    });
    if (!auth.currentUser) signInAnonymously(auth).catch(() => {});
    return () => unsub();
  }, [deviceId]);

  /* MAP INIT */
  useEffect(() => {
    if (mapRef.current) return;
    const map = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [14.42076, 50.08804],
      zoom: 6,
    });
    map.addControl(new mapboxgl.NavigationControl(), "bottom-right");
    map.on("click", () => {
      setSettingsOpen(false);
      setChatsOpen(false);
    });
    const onKey = (e) => e.key === "Escape" && (setSettingsOpen(false), setChatsOpen(false));
    window.addEventListener("keydown", onKey);
    mapRef.current = map;
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* SLEDOVÁNÍ VLASTNÍHO ZÁZNAMU (kvůli změně foto) */
  useEffect(() => {
    if (!uid) return;
    const unsub = onValue(ref(db, `users/${uid}`), (s) => {
      const me = s.val() || {};
      if (me.photoURL && me.photoURL !== photoURL) {
        setPhotoURL(me.photoURL);
        localStorage.setItem("photoURL", me.photoURL);
        if (myMarkerRef.current) {
          const el = myMarkerRef.current.getElement();
          el.style.backgroundImage = `url("${me.photoURL}")`;
          el.style.backgroundSize = "cover";
          el.style.backgroundPosition = "center";
        }
      }
    });
    return () => unsub();
  }, [uid, photoURL]);

  /* MOJE POLOHA + MARKER */
  useEffect(() => {
    if (!uid || !mapRef.current) return;

    const ensureMyMarker = () => {
      if (myMarkerRef.current) return;
      const el = document.createElement("div");
      Object.assign(el.style, {
        width: "28px",
        height: "28px",
        borderRadius: "50%",
        background: "#fff",
        border: "4px solid #e11d48",
        boxShadow: "0 0 0 3px rgba(225,17,72,.25)",
        backgroundSize: "cover",
        backgroundPosition: "center",
      });
      if (photoURL) el.style.backgroundImage = `url("${photoURL}")`;
      const marker = new mapboxgl.Marker({ element: el });
      const popup = new mapboxgl.Popup({ offset: 18 }).setHTML(`<b>${name}</b>`);
      myMarkerRef.current = marker.setPopup(popup);
      myPopupRef.current = popup;
    };

    const onPos = async (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      myPosRef.current = { lat, lng };
      ensureMyMarker();
      myMarkerRef.current.setLngLat([lng, lat]).addTo(mapRef.current);
      myPopupRef.current?.setHTML(`<b>${name || "Anonym"}</b>`);
      await update(ref(db, `users/${uid}`), {
        name: name || "Anonym",
        lat,
        lng,
        lastActive: Date.now(),
        deviceId,
        photoURL: photoURL || null,
      }).catch(() => {});
    };

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords;
          myPosRef.current = { lat, lng };
          mapRef.current.jumpTo({ center: [lng, lat], zoom: 14 });
          onPos(pos);
        },
        () => {},
        { enableHighAccuracy: true, timeout: 10000 }
      );
      const id = navigator.geolocation.watchPosition(onPos, () => {}, {
        enableHighAccuracy: true,
        maximumAge: 5000,
        timeout: 20000,
      });
      const alive = setInterval(() => {
        update(ref(db, `users/${uid}`), {
          lastActive: Date.now(),
          name: name || "Anonym",
          photoURL: photoURL || null,
          deviceId,
        }).catch(() => {});
      }, 20000);
      onDisconnect(ref(db, `users/${uid}`)).remove();
      return () => {
        navigator.geolocation.clearWatch(id);
        clearInterval(alive);
      };
    }
  }, [uid, name, photoURL, deviceId]);

  /* OSTATNÍ UŽIVATELÉ */
  useEffect(() => {
    if (!mapRef.current) return;
    const TTL = 5 * 60 * 1000; // 5 min

    const unsub = onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      const now = Date.now();
      const present = new Set(Object.keys(data));

      Object.entries(data).forEach(([id, u]) => {
        if (!u || !u.lat || !u.lng) return;
        if (u.deviceId && u.deviceId === deviceId) {
          if (others.current[id]) {
            others.current[id].remove();
            delete others.current[id];
          }
          return;
        }
        if (id === uid) {
          if (others.current[id]) {
            others.current[id].remove();
            delete others.current[id];
          }
          return;
        }

        const offline = now - (u.lastActive || 0) > TTL;
        if (!showOffline && offline) {
          if (others.current[id]) {
            others.current[id].remove();
            delete others.current[id];
          }
          return;
        }

        const buildEl = () => {
          const el = document.createElement("div");
          if (u.photoURL) {
            Object.assign(el.style, {
              width: "44px",
              height: "44px",
              borderRadius: "50%",
              backgroundImage: `url("${u.photoURL}")`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              border: "3px solid #fff",
              boxShadow: "0 0 0 3px rgba(0,0,0,.15)",
              filter: offline ? "grayscale(100%)" : "none",
              opacity: offline ? "0.85" : "1",
            });
          } else {
            Object.assign(el.style, {
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              background: offline ? "#bdbdbd" : "#3498db",
              border: "3px solid #fff",
              boxShadow: "0 0 0 3px rgba(0,0,0,.15)",
            });
          }
          return el;
        };

        const popupContent = `
          <div style="text-align:center">
            ${u.photoURL ? `<img src="${u.photoURL}" style="width:50px;height:50px;border-radius:50%;object-fit:cover" />` : ""}
            <p style="margin:6px 0 10px"><b>${u.name || "Uživatel"}</b><br/>${offline ? "offline" : "online"} • ${timeAgo(u.lastActive)}</p>
            <button onclick="window.__sendPing && window.__sendPing('${id}')" style="margin-right:6px">📩 Ping</button>
            <button onclick="window.__openQuickChat && window.__openQuickChat('${id}','${(u.name || "")
              .replace(/["'<>]/g, "")}')">💬 Chat</button>
          </div>
        `;

        if (!others.current[id]) {
          const marker = new mapboxgl.Marker({ element: buildEl() })
            .setLngLat([u.lng, u.lat])
            .setPopup(new mapboxgl.Popup({ offset: 20 }).setHTML(popupContent))
            .addTo(mapRef.current);
          marker.getElement().addEventListener("click", () => marker.togglePopup());
          others.current[id] = marker;
        } else {
          others.current[id].setLngLat([u.lng, u.lat]);
          others.current[id].getPopup()?.setHTML(popupContent);
        }
      });

      Object.keys(others.current).forEach((id) => {
        if (!present.has(id) || id === uid) {
          others.current[id].remove();
          delete others.current[id];
        }
      });
    });

    return () => unsub();
  }, [uid, showOffline, deviceId]);

  /* Globální pro popup */
  useEffect(() => {
    window.__sendPing = (targetId) => {
      set(ref(db, `pings/${targetId}`), { fromId: uid, from: name || "Anonym", time: Date.now() });
      showToast("Ping odeslán");
    };
    window.__openQuickChat = (targetId, targetName) => {
      const txt = prompt(`Zpráva pro ${targetName || targetId}:`);
      if (txt) {
        const msgRef = ref(db, `messages/${targetId}/${uid}`);
        push(msgRef, { fromId: uid, from: name || "Anonym", text: txt, time: Date.now() });
        showToast("Zpráva odeslána");
      }
    };
    return () => {
      delete window.__sendPing;
      delete window.__openQuickChat;
    };
  }, [uid, name]);

  /* Příchozí pingy/zprávy */
  useEffect(() => {
    if (!uid) return;
    const pUnsub = onValue(ref(db, `pings/${uid}`), (snap) => {
      if (!snap.exists()) return;
      const p = snap.val();
      if (soundOn) beep();
      showToast(`📩 Ping od ${p.from || "uživatele"}`);
    });
    const mUnsub = onValue(ref(db, `messages/${uid}`), (snap) => {
      if (!snap.exists()) return;
      let last = null;
      Object.values(snap.val()).forEach((bySender) => {
        Object.values(bySender).forEach((m) => {
          if (!last || m.time > last.time) last = m;
        });
      });
      if (last) {
        if (soundOn) beep();
        showToast(`💬 ${last.from}: ${last.text}`);
      }
    });
    return () => {
      pUnsub();
      mUnsub();
    };
  }, [uid, soundOn]);

  /* Akce */
  const saveName = async () => {
    localStorage.setItem("name", name);
    if (uid)
      await update(ref(db, `users/${uid}`), { name: name || "Anonym", lastActive: Date.now(), deviceId });
    showToast("Jméno uloženo");
  };

  /** ROBUSTNÍ UPLOAD S PROGRESEM + TIMEOUTEM */
  const uploadPhoto = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return showToast("Vyber fotku");

    setUploading(true);
    setUploadPct(0);

    // pokud je < 1.5 MB, pošleme originál; jinak zmenšíme
    let toUpload = file;
    try {
      if (file.size > 1_500_000) {
        toUpload = await shrinkImage(file, 1024);
      }
    } catch (e) {
      // když zmenšení selže, zkusíme originál
      toUpload = file;
    }

    const r = sref(storage, `profiles/${uid}.jpg`);
    const task = uploadBytesResumable(r, toUpload, { contentType: "image/jpeg" });

    const timeout = setTimeout(() => {
      try { task.cancel(); } catch {}
    }, 60_000); // 60 s hard timeout

    return new Promise((resolve) => {
      task.on(
        "state_changed",
        (snap) => {
          const p = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
          setUploadPct(p);
        },
        (err) => {
          clearTimeout(timeout);
          alert("Nahrání fotky selhalo: " + (err?.message || err));
          setUploading(false);
          setUploadPct(0);
          resolve(false);
        },
        async () => {
          clearTimeout(timeout);
          try {
            const url = await getDownloadURL(r);
            setPhotoURL(url);
            localStorage.setItem("photoURL", url);
            await update(ref(db, `users/${uid}`), {
              photoURL: url,
              lastActive: Date.now(),
              deviceId,
            });
            if (myMarkerRef.current) {
              const el = myMarkerRef.current.getElement();
              el.style.backgroundImage = `url("${url}")`;
              el.style.backgroundSize = "cover";
              el.style.backgroundPosition = "center";
            }
            showToast("Fotka nahrána");
          } catch (e) {
            alert("Chyba po nahrání: " + (e?.message || e));
          } finally {
            setUploading(false);
            setUploadPct(0);
            if (fileRef.current) fileRef.current.value = "";
            resolve(true);
          }
        }
      );
    });
  };

  return (
    <div style={{ width: "100vw", height: "100dvh", position: "relative" }}>
      <div id="map" style={{ width: "100%", height: "100%" }} />

      {toast && (
        <div
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: "calc(90px + env(safe-area-inset-bottom))",
            background: "#111827",
            color: "#fff",
            padding: "10px 14px",
            borderRadius: 999,
            fontSize: 14,
            zIndex: 70,
          }}
        >
          {toast}
        </div>
      )}

      {/* FAB Chaty */}
      <div
        onClick={() => setChatsOpen(true)}
        title="Chaty"
        style={{
          position: "fixed",
          right: "calc(16px + env(safe-area-inset-right))",
          bottom: "calc(96px + env(safe-area-inset-bottom))",
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "#e11d48",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 10px 24px rgba(0,0,0,.25)",
          cursor: "pointer",
          zIndex: 50,
        }}
      >
        <span
          style={{
            display: "block",
            width: 28,
            height: 28,
            background:
              "url('https://icons.getbootstrap.com/assets/icons/chat-dots-fill.svg') center/contain no-repeat",
            filter: "invert(100%)",
          }}
        />
      </div>

      {/* FAB Nastavení */}
      <div
        onClick={() => setSettingsOpen(true)}
        title="Nastavení"
        style={{
          position: "fixed",
          right: "calc(16px + env(safe-area-inset-right))",
          bottom: "calc(16px + env(safe-area-inset-bottom))",
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "#111827",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 10px 24px rgba(0,0,0,.25)",
          cursor: "pointer",
          zIndex: 50,
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

      {/* SETTINGS */}
      {settingsOpen && (
        <div
          onClick={() => setSettingsOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.25)", zIndex: 60 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: "calc(12px + env(safe-area-inset-left))",
              right: "calc(12px + env(safe-area-inset-right))",
              bottom: "calc(12px + env(safe-area-inset-bottom))",
              top: "calc(12px + env(safe-area-inset-top))",
              background: "#fff",
              borderRadius: 16,
              display: "flex",
              flexDirection: "column",
              maxHeight: "calc(100dvh - 24px)",
              boxShadow: "0 16px 36px rgba(0,0,0,.3)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: 16,
                display: "flex",
                alignItems: "center",
                borderBottom: "1px solid #eee",
              }}
            >
              <h3 style={{ margin: 0, flex: 1 }}>Nastavení</h3>
              <button
                onClick={() => setSettingsOpen(false)}
                style={{
                  border: "none",
                  background: "#111827",
                  color: "#fff",
                  borderRadius: 10,
                  padding: "8px 12px",
                }}
              >
                Zavřít
              </button>
            </div>

            <div style={{ padding: "16px", overflow: "auto" }}>
              <label style={{ fontSize: 13, opacity: 0.7 }}>Jméno</label>
              <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid #e5e7eb" }}
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

              <label style={{ fontSize: 13, opacity: 0.7 }}>Profilová fotka</label>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
                <input ref={fileRef} type="file" accept="image/*" style={{ flex: 1 }} />
                {photoURL ? (
                  <img
                    src={photoURL}
                    alt="náhled"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      objectFit: "cover",
                      border: "1px solid #eee",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: "50%",
                      background: "#eee",
                      border: "1px solid #ddd",
                    }}
                  />
                )}
              </div>

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  margin: "10px 0 80px 0",
                }}
              >
                <input
                  type="checkbox"
                  checked={showOffline}
                  onChange={() => {
                    const v = !showOffline;
                    setShowOffline(v);
                    localStorage.setItem("showOffline", String(v));
                    if (uid && others.current[uid]) {
                      others.current[uid].remove();
                      delete others.current[uid];
                    }
                  }}
                />
                Zobrazit offline uživatele (šedě)
              </label>
            </div>

            <div style={{ padding: 12, borderTop: "1px solid #eee", display: "flex", gap: 8, background: "#fff" }}>
              <button
                onClick={uploadPhoto}
                disabled={uploading}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  padding: "12px 14px",
                  background: uploading ? "#9ca3af" : "#0f172a",
                  color: "#fff",
                  border: "none",
                }}
              >
                {uploading ? `Nahrávám… ${uploadPct}%` : "Nahrát fotku"}
              </button>

              <button
                onClick={() => {
                  setSoundOn(true);
                  localStorage.setItem("soundOn", "true");
                  beep();
                  showToast("Zvuk povolen");
                }}
                style={{
                  flex: 1,
                  borderRadius: 10,
                  padding: "12px 14px",
                  background: soundOn ? "#10b981" : "#374151",
                  color: "#fff",
                  border: "none",
                }}
              >
                {soundOn ? "🔊 Zvuk povolen" : "🔇 Povolit zvuk"}
              </button>

              <button
                onClick={() => {
                  beep();
                  showToast("Píp!");
                }}
                style={{
                  borderRadius: 10,
                  padding: "12px 14px",
                  background: "#6b7280",
                  color: "#fff",
                  border: "none",
                  whiteSpace: "nowrap",
                }}
              >
                Test
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CHATS placeholder */}
      {chatsOpen && (
        <div onClick={() => setChatsOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.25)", zIndex: 60 }}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: "calc(12px + env(safe-area-inset-left))",
              right: "calc(12px + env(safe-area-inset-right))",
              bottom: "calc(12px + env(safe-area-inset-bottom))",
              top: "calc(12px + env(safe-area-inset-top))",
              background: "#fff",
              borderRadius: 16,
              padding: 16,
              overflow: "auto",
              boxShadow: "0 16px 36px rgba(0,0,0,.3)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
              <h3 style={{ margin: 0, flex: 1 }}>Chaty</h3>
              <button
                onClick={() => setChatsOpen(false)}
                style={{ border: "none", background: "#111827", color: "#fff", borderRadius: 10, padding: "8px 12px" }}
              >
                Zavřít
              </button>
            </div>
            <div style={{ color: "#6b7280" }}>
              Seznam konverzací doděláme, až potvrdíš, že běží fotky + markery. 😉
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
