// App.jsx
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";

import { initializeApp } from "firebase/app";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
} from "firebase/auth";
import {
  getDatabase,
  ref as dbref,
  set,
  update,
  onValue,
  onDisconnect,
  get,
  query,
  orderByChild,
  equalTo,
  remove,
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";

/* ===== Mapbox token (tvůj) ===== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ===== Firebase config (tvůj) ===== */
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL:
    "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e93b0ff17a816549635b",
  measurementId: "G-RL6MGM46M6X",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

const now = () => Date.now();

/** Downscale obrázku (JPEG) pro rychlejší upload */
async function downscaleImage(file, maxWidth = 800, quality = 0.85) {
  try {
    const img = document.createElement("img");
    const reader = new FileReader();
    const data = await new Promise((res, rej) => {
      reader.onload = () => res(reader.result);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    });
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = data;
    });
    const scale = Math.min(1, maxWidth / img.width);
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((res) =>
      c.toBlob(res, "image/jpeg", quality)
    );
    return blob;
  } catch {
    return null;
  }
}

/** Promise wrapper pro uploadBytesResumable + průběh */
function waitUpload(task, onProgress) {
  return new Promise((resolve, reject) => {
    task.on(
      "state_changed",
      (snap) => {
        const pct = Math.round(
          (snap.bytesTransferred / snap.totalBytes) * 100
        );
        onProgress?.(pct);
      },
      (err) => reject(err),
      () => resolve(task.snapshot)
    );
  });
}

export default function App() {
  // ===== STATE
  const [uid, setUid] = useState(localStorage.getItem("uid") || null);
  const [name, setName] = useState(localStorage.getItem("name") || "Anonym");
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("soundEnabled") === "true"
  );
  const [showOffline, setShowOffline] = useState(
    localStorage.getItem("showOffline") !== "false"
  );

  const [photoURL, setPhotoURL] = useState(
    localStorage.getItem("photoURL") || ""
  );
  const [photos, setPhotos] = useState(
    JSON.parse(localStorage.getItem("photos") || "[]")
  ); // galerie (max 8)

  const [map, setMap] = useState(null);
  const meMarker = useRef(null);
  const others = useRef({}); // id -> marker
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Upload fronta a stav
  const [pendingMain, setPendingMain] = useState(null);
  const [pendingGallery, setPendingGallery] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadLabel, setUploadLabel] = useState(""); // "profil" | "galerie"

  // ===== AUTH
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUid(user.uid);
        localStorage.setItem("uid", user.uid);
      } else {
        signInAnonymously(auth).catch(() => {});
      }
    });
    if (!auth.currentUser) signInAnonymously(auth).catch(() => {});
    return () => unsub();
  }, []);

  // ===== MAPA
  useEffect(() => {
    if (map) return;
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const m = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v11",
          center: [coords.longitude, coords.latitude],
          zoom: 14,
        });
        setMap(m);
      },
      () => {
        const m = new mapboxgl.Map({
          container: "map",
          style: "mapbox://styles/mapbox/streets-v11",
          center: [14.42076, 50.08804],
          zoom: 5,
        });
        setMap(m);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [map]);

  // ===== Moje pozice + marker + heartbeat
  useEffect(() => {
    if (!uid || !map) return;

    const meRef = dbref(db, `users/${uid}`);

    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        set(meRef, {
          name,
          lat: coords.latitude,
          lng: coords.longitude,
          lastActive: now(),
          photoURL,
          photos,
          online: true,
        });
        onDisconnect(meRef).update({ online: false, lastActive: now() });

        const el = document.createElement("div");
        el.style.width = "28px";
        el.style.height = "28px";
        el.style.borderRadius = "50%";
        el.style.boxShadow = "0 0 0 3px #ef4444 inset";
        el.style.background = "#9ca3af";
        meMarker.current = new mapboxgl.Marker(el)
          .setLngLat([coords.longitude, coords.latitude])
          .addTo(map);
      },
      () => {},
      { enableHighAccuracy: true }
    );

    const id = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        ({ coords }) => {
          update(meRef, {
            name,
            lat: coords.latitude,
            lng: coords.longitude,
            lastActive: now(),
            photoURL,
            photos,
            online: true,
          });
          meMarker.current?.setLngLat([coords.longitude, coords.latitude]);
        },
        () => {},
        { enableHighAccuracy: true }
      );
    }, 20_000);

    return () => clearInterval(id);
  }, [uid, map, name, photoURL, JSON.stringify(photos)]);

  // ===== Ostatní uživatelé
  useEffect(() => {
    if (!map) return;
    const usersRef = dbref(db, "users");
    return onValue(usersRef, (snap) => {
      const data = snap.val() || {};

      Object.entries(data).forEach(([id, u]) => {
        if (!u || !u.lat || !u.lng) return;
        if (id === uid) return;

        const isOnline = !!u.online && now() - (u.lastActive || 0) < 90_000;

        if (!isOnline && !showOffline) {
          if (others.current[id]) {
            others.current[id].remove();
            delete others.current[id];
          }
          return;
        }

        let mk = others.current[id];
        const boxShadowOnline = "0 0 0 3px #3b82f6 inset";
        const boxShadowOffline = "0 0 0 3px #9ca3af inset";

        if (!mk) {
          const el = document.createElement("div");
          el.style.width = "24px";
          el.style.height = "24px";
          el.style.borderRadius = "50%";
          el.style.background = "#9ca3af";
          el.style.boxShadow = isOnline ? boxShadowOnline : boxShadowOffline;
          mk = others.current[id] = new mapboxgl.Marker(el)
            .setLngLat([u.lng, u.lat])
            .addTo(map);
        } else {
          mk.setLngLat([u.lng, u.lat]);
          mk.getElement().style.boxShadow = isOnline
            ? boxShadowOnline
            : boxShadowOffline;
        }
      });

      Object.keys(others.current).forEach((id) => {
        if (!data[id]) {
          others.current[id].remove();
          delete others.current[id];
        }
      });
    });
  }, [map, uid, showOffline]);

  // ===== Perzistence nastavení
  useEffect(() => {
    localStorage.setItem("name", name);
  }, [name]);
  useEffect(() => {
    localStorage.setItem("soundEnabled", String(soundEnabled));
  }, [soundEnabled]);
  useEffect(() => {
    localStorage.setItem("showOffline", String(showOffline));
  }, [showOffline]);
  useEffect(() => {
    localStorage.setItem("photoURL", photoURL || "");
  }, [photoURL]);
  useEffect(() => {
    localStorage.setItem("photos", JSON.stringify(photos || []));
  }, [photos]);

  // ===== Uploady
  async function uploadMainPhoto(file) {
    if (!file) return;
    if (!uid) {
      setPendingMain(file);
      alert("Chvilku… přihlašuju a pak fotku nahraju.");
      return;
    }
    try {
      setUploading(true);
      setUploadLabel("profil");
      setUploadPct(0);

      const blob = (await downscaleImage(file, 800, 0.85)) || file;
      const path = `avatars/${uid}.jpg`;
      const task = uploadBytesResumable(sref(storage, path), blob, {
        contentType: "image/jpeg",
      });

      await waitUpload(task, setUploadPct);
      const url = await getDownloadURL(sref(storage, path));
      setPhotoURL(url);
      await update(dbref(db, `users/${uid}`), { photoURL: url });

      if (!photos || photos.length === 0) {
        const next = [url];
        setPhotos(next);
        await update(dbref(db, `users/${uid}`), { photos: next });
      }
      alert("📸 Profilová fotka nahrána");
    } catch (e) {
      console.error(e);
      alert(`Nahrávání selhalo: ${e.code || e.message}`);
    } finally {
      setUploading(false);
      setUploadLabel("");
      setUploadPct(0);
    }
  }

  async function uploadGalleryPhoto(file) {
    if (!file) return;
    if (!uid) {
      setPendingGallery(file);
      alert("Chvilku… přihlašuju a pak fotku nahraju.");
      return;
    }
    if ((photos?.length || 0) >= 8) {
      alert("Maximálně 8 fotek v galerii.");
      return;
    }
    try {
      setUploading(true);
      setUploadLabel("galerie");
      setUploadPct(0);

      const blob = (await downscaleImage(file, 800, 0.85)) || file;
      const filename = `${uid}-${now()}.jpg`;
      const path = `gallery/${uid}/${filename}`;
      const task = uploadBytesResumable(sref(storage, path), blob, {
        contentType: "image/jpeg",
      });

      await waitUpload(task, setUploadPct);
      const url = await getDownloadURL(sref(storage, path));
      const next = [...(photos || []), url].slice(0, 8);
      setPhotos(next);
      await update(dbref(db, `users/${uid}`), { photos: next });
      alert("🖼️ Fotka přidána do galerie");
    } catch (e) {
      console.error(e);
      alert(`Nahrávání selhalo: ${e.code || e.message}`);
    } finally {
      setUploading(false);
      setUploadLabel("");
      setUploadPct(0);
    }
  }

  // Dožene čekající uploady po přihlášení
  useEffect(() => {
    if (!uid) return;
    (async () => {
      if (pendingMain) {
        const f = pendingMain;
        setPendingMain(null);
        await uploadMainPhoto(f);
      }
      if (pendingGallery) {
        const f = pendingGallery;
        setPendingGallery(null);
        await uploadGalleryPhoto(f);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  // ===== Utilities – „duchové“ / staré markery
  async function clearMyOldGhosts() {
    try {
      if (!name) {
        alert("Nejdřív zadej své jméno.");
        return;
      }
      const q = query(dbref(db, "users"), orderByChild("name"), equalTo(name));
      const snap = await get(q);
      if (!snap.exists()) {
        alert("Nenašel jsem žádné staré záznamy.");
        return;
      }
      const tasks = [];
      snap.forEach((child) => {
        const u = child.val();
        const isMe = child.key === uid;
        const offline =
          !u?.online || now() - (u?.lastActive || 0) > 24 * 60 * 60 * 1000;
        if (!isMe && offline) {
          tasks.push(remove(dbref(db, `users/${child.key}`)));
        }
      });
      await Promise.all(tasks);
      alert("Staré záznamy smazány.");
    } catch (e) {
      console.error(e);
      alert(`Mazání selhalo: ${e.code || e.message}`);
    }
  }

  // ===== UI
  const SettingRow = ({ children }) => (
    <div style={{ marginBottom: 14 }}>{children}</div>
  );

  const proto =
    (window.location.protocol || "").replace(":", "") || "unknown";
  const audioUnlocked = soundEnabled ? "odemýklé" : "zamčené";

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      {/* MAPA */}
      <div id="map" style={{ width: "100%", height: "100%" }} />

      {/* FAB – Chat (placeholder) */}
      <button
        onClick={() => alert("Chaty – zatím žádné konverzace.")}
        style={{
          position: "fixed",
          right: 18,
          bottom: 110,
          width: 68,
          height: 68,
          borderRadius: "50%",
          border: "none",
          background: "#ef4444",
          color: "white",
          fontSize: 26,
          boxShadow: "0 10px 24px rgba(0,0,0,.25)",
        }}
        aria-label="Chat"
      >
        💬
      </button>

      {/* FAB – Nastavení */}
      <button
        onClick={() => setSettingsOpen(true)}
        style={{
          position: "fixed",
          right: 18,
          bottom: 28,
          width: 68,
          height: 68,
          borderRadius: "50%",
          border: "none",
          background: "#111827",
          color: "white",
          fontSize: 26,
          boxShadow: "0 10px 24px rgba(0,0,0,.25)",
        }}
        aria-label="Nastavení"
      >
        ⚙️
      </button>

      {/* Nastavení – mobilní sheet */}
      {settingsOpen && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            background: "white",
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
            boxShadow: "0 -12px 32px rgba(0,0,0,.3)",
            padding: 18,
            zIndex: 50,
            maxHeight: "85vh",
            overflowY: "auto",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h2 style={{ margin: 0, fontSize: 22 }}>Nastavení</h2>
            <button
              onClick={() => setSettingsOpen(false)}
              style={{
                padding: "8px 14px",
                borderRadius: 12,
                border: "none",
                background: "#111827",
                color: "white",
                fontWeight: 600,
              }}
            >
              Zavřít
            </button>
          </div>

          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 8 }}>
            UID: {uid || "…" } • proto: {proto} • audio: {audioUnlocked}
          </div>

          <SettingRow>
            <label style={{ fontSize: 14, color: "#374151" }}>Jméno</label>
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Tvoje jméno"
                style={{
                  flex: 1,
                  height: 44,
                  borderRadius: 12,
                  border: "1px solid #e5e7eb",
                  padding: "0 12px",
                  fontSize: 16,
                }}
              />
              <button
                onClick={async () => {
                  if (!uid) return;
                  await update(dbref(db, `users/${uid}`), { name });
                  alert("✔️ Uloženo");
                }}
                style={{
                  height: 44,
                  padding: "0 16px",
                  borderRadius: 12,
                  border: "none",
                  background: "#0ea5e9",
                  color: "white",
                  fontWeight: 700,
                }}
              >
                Uložit
              </button>
            </div>
          </SettingRow>

          <SettingRow>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <button
                onClick={() => setSoundEnabled((v) => !v)}
                style={{
                  flex: 1,
                  height: 46,
                  borderRadius: 12,
                  border: "none",
                  background: soundEnabled ? "#10b981" : "#111827",
                  color: "white",
                  fontWeight: 700,
                }}
              >
                {soundEnabled ? "🔊 Zvuk povolen" : "🔇 Zvuk vypnut"}
              </button>
              <button
                onClick={() => {
                  try {
                    const a = new Audio(
                      "https://assets.mixkit.co/active_storage/sfx/2560/2560-preview.mp3"
                    );
                    a.play().catch(() =>
                      alert("Klepni ještě jednou, prohlížeč to nepustil.")
                    );
                  } catch {
                    alert("Klepni ještě jednou, prohlížeč to nepustil.");
                  }
                }}
                style={{
                  height: 46,
                  padding: "0 16px",
                  borderRadius: 12,
                  border: "none",
                  background: "#374151",
                  color: "white",
                  fontWeight: 700,
                }}
              >
                Test
              </button>
            </div>
          </SettingRow>

          <SettingRow>
            <div style={{ fontSize: 14, color: "#374151", marginBottom: 6 }}>
              Profilová fotka
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => uploadMainPhoto(e.target.files?.[0])}
            />
            {uploading && uploadLabel === "profil" && (
              <div style={{ marginTop: 6, color: "#6b7280" }}>
                Nahrávám… {uploadPct}%
              </div>
            )}
          </SettingRow>

          <SettingRow>
            <div
              style={{
                fontSize: 14,
                color: "#374151",
                marginBottom: 6,
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>Galerie (max 8)</span>
              <span style={{ color: "#9ca3af" }}>
                {(photos?.length || 0)}/8
              </span>
            </div>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => uploadGalleryPhoto(e.target.files?.[0])}
            />
            {uploading && uploadLabel === "galerie" && (
              <div style={{ marginTop: 6, color: "#6b7280" }}>
                Nahrávám… {uploadPct}%
              </div>
            )}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 8,
                marginTop: 10,
              }}
            >
              {(photos || []).map((u) => (
                <img
                  key={u}
                  src={u}
                  alt=""
                  style={{
                    width: "100%",
                    aspectRatio: "1 / 1",
                    objectFit: "cover",
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                  }}
                />
              ))}
            </div>
          </SettingRow>

          <SettingRow>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                userSelect: "none",
              }}
            >
              <input
                type="checkbox"
                checked={showOffline}
                onChange={(e) => setShowOffline(e.target.checked)}
              />
              Zobrazit offline uživatele (šedě)
            </label>
          </SettingRow>

          {/* Debug sekce */}
          <div
            style={{
              marginTop: 12,
              paddingTop: 12,
              borderTop: "1px solid #e5e7eb",
            }}
          >
            <div style={{ fontWeight: 700, color: "#111827", marginBottom: 8 }}>
              🛠️ Debug
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <button
                onClick={async () => {
                  try {
                    const dummy = new Blob(["hello"], { type: "text/plain" });
                    const task = uploadBytesResumable(
                      sref(storage, `diagnostic/${uid || "anon"}-${now()}.txt`),
                      dummy
                    );
                    setUploading(true);
                    setUploadLabel("diagnostic");
                    setUploadPct(0);
                    await waitUpload(task, setUploadPct);
                    setUploading(false);
                    setUploadLabel("");
                    setUploadPct(0);
                    alert("Diagnostic: OK (zápis do Storage funguje)");
                  } catch (e) {
                    alert(`Diagnostic failed: ${e.code || e.message}`);
                  }
                }}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  background: "white",
                }}
              >
                Test Storage zápisu
              </button>

              <button
                onClick={clearMyOldGhosts}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  background: "white",
                }}
              >
                Vyčistit můj starý marker
              </button>
            </div>
            {uploadLabel === "diagnostic" && (
              <div style={{ marginTop: 6, color: "#6b7280" }}>
                Diagnostický upload… {uploadPct}%
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
