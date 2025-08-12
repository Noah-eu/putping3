// src/App.jsx — dočasná verze BEZ Firebase Auth (pro rychlý test uploadu)
import React, { useEffect, useState } from "react";
import { storage } from "./firebase";
import { ref as sref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

export default function App() {
  // ===== STATE =====
  const [uid, setUid] = useState(localStorage.getItem("uid") || "");
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadErr, setUploadErr] = useState("");
  const [photoURL, setPhotoURL] = useState("");

  // ===== Pseudo-UID (bez Auth) =====
  useEffect(() => {
    if (!uid) {
      const tmp = "guest_" + Math.random().toString(36).slice(2);
      setUid(tmp);
      localStorage.setItem("uid", tmp);
    }
  }, [uid]);

  // ===== UPLOAD =====
  const onPickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    startPhotoUpload(file);
  };

  const startPhotoUpload = (file) => {
    setUploading(true);
    setUploadPct(0);
    setUploadErr("");

    const safeName = file.name.replace(/\s+/g, "_");
    const path = `user_uploads/${uid || "guest"}/${Date.now()}-${safeName}`;
    const r = sref(storage, path);
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
        alert("Fotka nahrána ✅");
        console.log("Photo URL:", url);
      }
    );
  };

  // ===== TEST: zápis malého blobu =====
  const testStorageWrite = async () => {
    try {
      const r = sref(storage, `user_uploads/${uid || "guest"}/__test_${Date.now()}.txt`);
      const blob = new Blob(["hello from putping"], { type: "text/plain" });
      const task = uploadBytesResumable(r, blob, { contentType: "text/plain" });
      await new Promise((res, rej) => task.on("state_changed", null, rej, res));
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
        UID: <code>{uid || "…"}</code>
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
        Dočasná verze bez Auth – po ověření, že upload funguje, Auth znovu zapneme a vrátíme
        původní pravidla Storage.
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
