// App.jsx (Debug Safe Mode)
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
} from "firebase/database";
import {
  getStorage,
  ref as sref,
  uploadBytesResumable,
  getDownloadURL,
} from "firebase/storage";

/* ===== Mapbox token ===== */
mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

/* ===== Firebase config ===== */
const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL:
    "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e93b0ff17a816549635b",
  measurementId: "G-RLMGM46M6X",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getDatabase(app);
const storage = getStorage(app);

const now = () => Date.now();

/* ===== WebAudio „beep“ (spolehlivý test) ===== */
function useWebAudio() {
  const ctxRef = useRef(null);
  const unlockedRef = useRef(false);

  const ensure = async () => {
    try {
      if (!ctxRef.current) ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      if (ctxRef.current.state === "suspended") {
        await ctxRef.current.resume();
      }
      unlockedRef.current = true;
      return true;
    } catch {
      unlockedRef.current = false;
      return false;
    }
  };

  const beep = async (ms = 160, freq = 880) => {
    const ok = await ensure();
    if (!ok) throw new Error("audio-locked");
    const ctx = ctxRef.current;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.value = 0.2;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    await new Promise((r) => setTimeout(r, ms));
    osc.stop();
  };

  return { beep, ensure, unlockedRef };
}

export default function App() {
  /* ===== STATE ===== */
  const [uid, setUid] = useState(localStorage.getItem("uid") || null);
  const [name, setName] = useState(localStorage.getItem("name") || "Anonym");
  const [soundEnabled, setSoundEnabled] = useState(
    localStorage.getItem("soundEnabled") === "true"
  );
  const [showOffline, setShowOffline] = useState(
    localStorage.getItem("showOffline") !== "false"
  );

  const [photoURL, setPhotoURL] = useState(localStorage.getItem("photoURL") || "");
  const [photos, setPhotos] = useState(JSON.parse(localStorage.getItem("photos") || "[]"));

  const [map, setMap] = useState(null);
  const meMarker = useRef(null);
  const others = useRef({});
  const [settingsOpen, setSettingsOpen] = useState(false);

  // upload stav
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadLabel, setUploadLabel] = useState(""); // "profil" | "galerie" | "diagnostic"
  const [lastUploadError, setLastUploadError] = useState("");

  // audio
  const { beep, ensure, unlockedRef } = useWebAudio();

  /* ===== AUTH ===== */
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

  /* ===== MAP ===== */
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

  /* ===== Zápis mé pozice + můj marker ===== */
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
          if (meMarker.current) {
            meMarker.current.setLngLat([coords.longitude, coords.latitude]);
          }
        },
        () => {},
        { enableHighAccuracy: true }
      );
    }, 20000);

    return () => clearInterval(id);
  }, [uid, map, name, photoURL, JSON.stringify(photos)]);

  /* ===== Ostatní uživatelé ===== */
  useEffect(() => {
    if (!map) return;
    const usersRef = dbref(db, "users");
    return onValue(usersRef, (snap) => {
      const data = snap.val() || {};
      Object.entries(data).forEach(([id, u]) => {
        if (!u || !u.lat || !u.lng) return;
        if (id === uid) return;

        const isOnline = !!u.online && (now() - (u.lastActive || 0) < 90000);

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
          const el = mk.getElement();
          el.style.boxShadow = isOnline ? boxShadowOnline : boxShadowOffline;
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

  /* ===== Perzistence ===== */
  useEffect(() => localStorage.setItem("name", name), [name]);
  useEffect(() => localStorage.setItem("soundEnabled", String(soundEnabled)), [soundEnabled]);
  useEffect(() => localStorage.setItem("showOffline", String(showOffline)), [showOffline]);
  useEffect(() => localStorage.setItem("photoURL", photoURL || ""), [photoURL]);
  useEffect(() => localStorage.setItem("photos", JSON.stringify(photos || [])), [photos]);

  /* ===== Uploady (bez komprese, s jasnou chybou) ===== */
  function attachProgress(task, label) {
    setUploading(true);
    setUploadPct(0);
    setUploadLabel(label);
    setLastUploadError("");

    task.on(
      "state_changed",
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        setUploadPct(pct);
      },
      (err) => {
        console.error("UPLOAD ERROR", err);
        setLastUploadError(`${err.code || "error"}: ${err.message || ""}`);
        alert(`Nahrávání selhalo: ${err.code || ""}\n${err.message || ""}`);
        setUploading(false);
        setUploadPct(0);
        setUploadLabel("");
      }
    );
  }

  async function uploadMainPhoto(file) {
    if (!file) return;
    if (!uid) {
      alert("Přihlašuju… zkus znovu za vteřinu.");
      return;
    }
    try {
      const path = `avatars/${uid}.jpg`;
      const task = uploadBytesResumable(sref(storage, path), file);
      attachProgress(task, "profil");
      await task;
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
      alert(`Nahrávání selhalo: ${e.code || ""}\n${e.message || ""}`);
    } finally {
      setUploading(false);
      setUploadPct(0);
      setUploadLabel("");
    }
  }

  async function uploadGalleryPhoto(file) {
    if (!file) return;
    if (!uid) {
      alert("Přihlašuju… zkus znovu za vteřinu.");
      return;
    }
    if ((photos?.length || 0) >= 8) {
      alert("Max 8 fotek v galerii.");
      return;
    }
    try {
      const filename = `${uid}-${now()}.jpg`;
      const path = `gallery/${uid}/${filename}`;
      const task = uploadBytesResumable(sref(storage, path), file);
      attachProgress(task, "galerie");
      await task;
      const url = await getDownloadURL(sref(storage, path));
      const next = [...(photos || []), url].slice(0, 8);
      setPhotos(next);
      await update(dbref(db, `users/${uid}`), { photos: next });
      alert("🖼️ Fotka přidána do galerie");
    } catch (e) {
      console.error(e);
      alert(`Nahrávání selhalo: ${e.code || ""}\n${e.message || ""}`);
    } finally {
      setUploading(false);
      setUploadPct(0);
      setUploadLabel("");
    }
  }

  /* ===== Debug akce ===== */
  async function debugWriteTinyFile() {
    if (!uid) return alert("UID zatím není.");
    try {
      const blob = new Blob([new Uint8Array([1])], { type: "application/octet-stream" });
      const path = `diagnostics/${uid}-${Date.now()}.bin`;
      const task = uploadBytesResumable(sref(storage, path), blob);
      attachProgress(task, "diagnostic");
      await task;
      setUploading(false);
      setUploadPct(100);
      alert("✅ Storage zápis OK (diagnostics).");
    } catch (e) {
      console.error(e);
      alert(`❌ Storage zápis FAIL: ${e.code || ""}\n${e.message || ""}`);
    } finally {
      setUploadLabel("");
      setUploadPct(0);
    }
  }

  async function clearMyGhost() {
    if (!uid) return;
    const meRef = dbref(db, `users/${uid}`);
    await update(meRef, { online: false, lastActive: now() });
    await new Promise((r) => setTimeout(r, 300));
    await update(meRef, { online: true, lastActive: now() });
    alert("🧹 Zkuste znovu přepnout zobrazení offline—ghost by měl zmizet.");
  }

  /* ===== UI ===== */
  const SettingRow = ({ children }) => (
    <div style={{ marginBottom: 14 }}>{children}</div>
  );

  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden" }}>
      {/* MAPA */}
      <div id="map" style={{ width: "100%", height: "100%" }} />

      {/* FAB – Chat placeholder */}
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

          {/* Debug info řádek */}
          <div style={{ fontSize: 12, color: "#6b7280", marginTop: 6 }}>
            UID: {uid || "—"} • proto: {typeof window !== "undefined" ? window.location.protocol : "—"} • audio: {unlockedRef.current ? "odemyklé" : "zamknuté"}
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
                onClick={async () => {
                  try {
                    await ensure(); // odemknout
                    await beep(160, 880); // píp
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
              <span style={{ color: "#9ca3af" }}>{(photos?.length || 0)}/8</span>
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
            {!!lastUploadError && (
              <div style={{ marginTop: 6, color: "#ef4444", fontSize: 12 }}>
                {lastUploadError}
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
            <label style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                type="checkbox"
                checked={showOffline}
                onChange={(e) => setShowOffline(e.target.checked)}
              />
              Zobrazit offline uživatele (šedě)
            </label>
          </SettingRow>

          {/* DEBUG TOOLS */}
          <div style={{ marginTop: 16, paddingTop: 10, borderTop: "1px solid #e5e7eb" }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>🔧 Debug</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={debugWriteTinyFile}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  background: "#f9fafb",
                }}
              >
                Test Storage zápisu
              </button>
              <button
                onClick={clearMyGhost}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  border: "1px solid #e5e7eb",
                  background: "#f9fafb",
                }}
              >
                Vyčistit můj starý marker
              </button>
            </div>

            {uploading && uploadLabel === "diagnostic" && (
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
