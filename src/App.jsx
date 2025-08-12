// src/App.jsx — DIAGNOSTICKÁ verze (bez Auth), vše na obrazovce
import React, { useEffect, useState } from "react";
import { storage } from "./firebase";
import { ref as sref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

export default function App() {
  const [uid, setUid] = useState(localStorage.getItem("uid") || "");
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [photoURL, setPhotoURL] = useState("");
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState("");

  // globální chyby do UI
  useEffect(() => {
    const onErr = (msg, src, line, col, err) => {
      setError(`window.onerror: ${msg || err?.message || "neznámá chyba"}`);
      return false;
    };
    const onRej = (e) => {
      const reason = e?.reason?.message || e?.reason || e;
      setError(`Unhandled rejection: ${reason}`);
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  // pseudo UID
  useEffect(() => {
    if (!uid) {
      const tmp = "guest_" + Math.random().toString(36).slice(2);
      setUid(tmp);
      localStorage.setItem("uid", tmp);
    }
  }, [uid]);

  // diagnostika při mountu
  useEffect(() => {
    const lines = [];
    try {
      const bucket = storage?.app?.options?.storageBucket || "(neznámý)";
      lines.push(`Bucket z configu: ${bucket}`);
    } catch (e) {
      lines.push("Bucket nelze přečíst z configu");
    }
    lines.push(`UserAgent: ${navigator.userAgent}`);
    setLog(lines);
    // rychlý reachability test na Google domény (no-cors)
    reachabilityTest();
  }, []);

  const addLog = (s) => setLog((prev) => [...prev, s]);

  const reachabilityTest = async () => {
    // 1) test DNS/HTTPS na google (mělo by projít i s no-cors)
    try {
      await fetch("https://www.gstatic.com/generate_204", { mode: "no-cors" });
      addLog("Reach gstatic: OK");
    } catch (e) {
      addLog("Reach gstatic: FAIL");
      setError("Síť blokuje přístup na gstatic (možný adblock/VPN).");
    }
    // 2) zkusíme „ping“ na storage endpoint (no-cors)
    try {
      await fetch("https://firebasestorage.googleapis.com/generate_204", { mode: "no-cors" });
      addLog("Reach firebasestorage.googleapis.com: OK");
    } catch (e) {
      addLog("Reach firebasestorage.googleapis.com: FAIL");
      setError((prev) =>
        prev || "Síť zřejmě blokuje firebasestorage.googleapis.com (zkus vypnout AdGuard/VPN nebo jinou síť)."
      );
    }
  };

  const onPickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    startUpload(file);
  };

  const startUpload = (file) => {
    setUploading(true);
    setUploadPct(0);
    setError("");
    setPhotoURL("");
    addLog(`Start uploadu souboru: ${file.name} (${file.type}, ${file.size} B)`);

    const safe = file.name.replace(/\s+/g, "_");
    const path = `user_uploads/${uid || "guest"}/${Date.now()}-${safe}`;
    const r = sref(storage, path);

    let task;
    try {
      task = uploadBytesResumable(r, file, { contentType: file.type });
    } catch (e) {
      setUploading(false);
      setError(`uploadBytesResumable THROW: ${e?.message || e}`);
      addLog(`uploadBytesResumable THROW: ${e?.message || e}`);
      return;
    }

    task.on(
      "state_changed",
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        setUploadPct(pct);
      },
      (err) => {
        const msg = mapStorageError(err);
        setError(msg);
        addLog(`Upload error: ${err?.code || ""} ${err?.message || ""}`);
        setUploading(false);
        alert(`UPLOAD ERROR: ${msg}`);
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          setPhotoURL(url);
          addLog("getDownloadURL: OK");
        } catch (e) {
          setError(`getDownloadURL: ${e?.message || e}`);
          addLog(`getDownloadURL ERROR: ${e?.message || e}`);
        }
        setUploading(false);
        setUploadPct(100);
        alert("Fotka nahrána ✅");
      }
    );
  };

  const testBlob = async () => {
    setError("");
    addLog("Test zápisu malého blobu…");
    try {
      const r = sref(storage, `user_uploads/${uid || "guest"}/__test_${Date.now()}.txt`);
      const blob = new Blob(["hello from putping"], { type: "text/plain" });
      const task = uploadBytesResumable(r, blob, { contentType: "text/plain" });
      await new Promise((res, rej) => task.on("state_changed", null, rej, res));
      alert("Test zápisu: ✅ OK");
      addLog("Test zápisu: OK");
    } catch (e) {
      const msg = e?.code ? `${e.code} – ${e.message}` : (e?.message || String(e));
      setError(`Test zápisu selhal: ${msg}`);
      addLog(`Test zápisu ERROR: ${msg}`);
      alert("Test zápisu: ❌");
    }
  };

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
                  maxWidth: 720, margin: "24px auto", padding: 16 }}>
      <h2>PutPing – Upload test (diagnostika)</h2>

      <div style={{ fontSize: 14, opacity: 0.8, marginBottom: 10 }}>
        UID: <code>{uid || "…"}</code>
      </div>

      <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
        <label style={{
          display: "inline-block", padding: "10px 14px", borderRadius: 12,
          boxShadow: "0 1px 3px rgba(0,0,0,.15)", cursor: "pointer", userSelect: "none"
        }}>
          Nahrát fotku
          <input type="file" accept="image/*" onChange={onPickPhoto} style={{ display: "none" }} />
        </label>
        <button onClick={testBlob} style={{
          padding: "10px 14px", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,.15)",
          border: 0, background: "#f3f3f3"
        }}>
          Test Storage zápisu
        </button>
      </div>

      <div style={{ height: 10, background: "#eee", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ width: `${uploadPct}%`, height: 10, borderRadius: 6 }} />
      </div>
      <div style={{ fontSize: 13, marginTop: 6 }}>{uploadPct}%</div>

      {error && <div style={{ color: "red", marginTop: 12, whiteSpace: "pre-wrap" }}>{error}</div>}

      {photoURL && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 14, marginBottom: 6 }}>URL:</div>
          <a href={photoURL} target="_blank" rel="noreferrer">{photoURL}</a>
          <div style={{ marginTop: 12 }}>
            <img src={photoURL} alt="nahraná" style={{ maxWidth: "100%", borderRadius: 12 }} />
          </div>
        </div>
      )}

      <hr style={{ margin: "20px 0", opacity: .2 }} />

      <div style={{ fontSize: 12, opacity: .85 }}>
        <b>Log:</b>
        <pre style={{ whiteSpace: "pre-wrap" }}>{log.join("\n")}</pre>
      </div>

      <div style={{ fontSize: 12, opacity: .6, marginTop: 8 }}>
        TIP: Když se nedaří reach „gstatic“ nebo „firebasestorage…“, vypni VPN/AdGuard/Blokátor reklam,
        přepni Wi‑Fi/Mobilní data, nebo zkus anonymní okno.
      </div>
    </div>
  );
}

function mapStorageError(err) {
  if (!err) return "Neznámá chyba";
  switch (err.code) {
    case "storage/unauthorized":
      return "Unauthorized (zkontroluj Storage rules nebo App Check).";
    case "storage/canceled":
      return "Nahrávání zrušeno.";
    case "storage/retry-limit-exceeded":
      return "Vypršel čas – zkus menší soubor / jiné připojení.";
    case "storage/object-not-found":
      return "Soubor nenalezen.";
    default:
      return `${err.code || "error"} – ${err.message || ""}`;
  }
}
