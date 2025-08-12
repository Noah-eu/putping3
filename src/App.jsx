// App.jsx – dočasná testovací stránka pro upload fotky na Firebase Storage
import React, { useEffect, useState } from "react";
import { auth, db, storage } from "./firebase";

import { onAuthStateChanged, signInAnonymously } from "firebase/auth";
import { ref as dbref, set } from "firebase/database";
import { ref as sref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

export default function App() {
  // ===== STATE =====
  const [uid, setUid] = useState(localStorage.getItem("uid") || "");
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadErr, setUploadErr] = useState("");
  const [photoURL, setPhotoURL] = useState("");

  // ===== AUTH (anon) =====
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user?.uid) {
        setUid(user.uid);
        localStorage.setItem("uid", user.uid);
      }
    });

    if (!auth.currentUser) {
      signInAnonymously(auth).catch((e) => {
        alert("Chyba při anonymním přihlášení: " + (e?.message || e));
      });
    }
    return () => unsub();
  }, []);

  // ===== UPLOAD =====
  const onPickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    startPhotoUpload(file);
  };

  const startPhotoUpload = (file) => {
    if (!uid) {
      alert("Nejste přihlášen.");
      return;
    }
    setUploading(true);
    setUploadPct(0);
    setUploadErr("");

    const safeName = file.name.replace(/\s+/g, "_");
    const r = sref(storage, `user_uploads/${uid}/${Date.now()}-${safeName}`);
    const task = uploadBytesResumable(r, file, { contentType: file.type });

    task.on(
      "state_changed",
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        setUploadPct(pct);
      },
      (err) => {
        const msg = mapStorageError(err);
        setUploadErr(msg);
        setUploading(false);
        alert(`UPLOAD ERROR: ${msg}`);
      },
      async () => {
        const url = await getDownloadURL(task.snapshot.ref);
        setUploading(false);
        setUploadPct(100);
        setPhotoURL(url);
        try {
          await set(dbref(db, `debug_uploads/${uid}/${Date.now()}`), {
            url,
            at: Date.now(),
          });
        } catch (_) {}
        alert("Fotka nahrána ✅");
        console.log("Photo URL:", url);
      }
    );
  };

  const testStorageWrite = async () => {
    try {
      if (!uid) throw new Error("Chybí UID (nejste přihlášen).");
      const r = sref(storage, `user_uploads/${uid}/__test_${Date.now()}.txt`);
      const blob = new Blob(["hello from putping"], { type: "text/plain" });
      const task = uploadBytesResumable(r, blob, { contentType: "text/plain" });
      await new Promise((res, rej) => {
        task.on("state_changed", null, rej, res);
      });
      alert("Test zápisu do Storage: ✅ OK");
    } catch (e) {
      alert("Test zápisu do Storage: ❌ " + (e?.message || e));
    }
  };

  // ===== UI =====
  return (
    <div style={{
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
      maxWidth: 560, margin: "24px auto", padding: 16
    }}>
      <h2 style={{ marginBottom: 8 }}>PutPing – Upload test</h2>

      <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 16 }}>
        {uid ? <>UID: <code>{uid}</code></> : "Přihlašuji anonymně..."}
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{
          display: "inline-block",
          padding: "10px 14px",
          borderRadius: 12,
          boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
          cursor: "pointer",
          userSelect: "none"
        }}>
          Nahrát fotku
          <input
            type="file"
            accept="image/*"
            onChange={onPickPhoto}
            style={{ display: "none" }}
            capture="environment"
          />
        </label>
        <button
          onClick={testStorageWrite}
          style={{
            marginLeft: 12,
            padding: "10px 14px",
            borderRadius: 12,
            boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
            border: 0,
            background: "#f3f3f3"
          }}
        >
          Test Storage zápisu
        </button>
      </div>

      {uploading && (
        <div style={{ marginTop: 8 }}>
          <div style={{ height: 10, background: "#eee", borderRadius: 6 }}>
            <div
              style={{
                width: `${uploadPct}%`,
                height: 10,
                borderRadius: 6
              }}
            />
          </div>
          <div style={{ fontSize: 13, marginTop: 6 }}>{uploadPct}%</div>
        </div>
      )}

      {uploadErr && (
        <div style={{ color: "red", marginTop: 10 }}>
          {uploadErr}
        </div>
      )}

      {photoURL && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 14, marginBottom: 6 }}>Stažitelná URL:</div>
          <a href={photoURL} target="_blank" rel="noreferrer">{photoURL}</a>
          <div style={{ marginTop: 12 }}>
            <img src={photoURL} alt="nahraná fotka" style={{ maxWidth: "100%", borderRadius: 12 }} />
          </div>
        </div>
      )}

      <hr style={{ margin: "24px 0", opacity: 0.2 }} />
      <div style={{ fontSize: 13, opacity: 0.75 }}>
        Tohle je dočasná test stránka. Až potvrdíme, že upload jede, vložím to do tvé sekce Nastavení u mapy.
      </div>
    </div>
  );
}

function mapStorageError(err) {
  switch (err?.code) {
    case "storage/unauthorized": return "Nemáš oprávnění (zkontroluj Storage rules).";
    case "storage/canceled": return "Nahrávání zrušeno.";
    case "storage/retry-limit-exceeded": return "Vypršel čas (zkus menší soubor / jiné připojení).";
    default: return `${err?.code || "error"} – ${err?.message || ""}`;
  }
}
