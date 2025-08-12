// App.jsx — Diagnostic v2 (bez Auth), vše viditelné na obrazovce
import React, { useEffect, useState } from "react";
import { storage } from "./firebase";
import { ref as sref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

const BUILD_VERSION = "diag-v2 • " + new Date().toISOString();

export default function App() {
  const [uid, setUid] = useState(localStorage.getItem("uid") || "");
  const [uploadPct, setUploadPct] = useState(0);
  const [photoURL, setPhotoURL] = useState("");
  const [log, setLog] = useState([]);
  const [error, setError] = useState("");

  const addLog = (line) =>
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${line}`]);

  // Pseudo UID bez Auth
  useEffect(() => {
    if (!uid) {
      const tmp = "guest_" + Math.random().toString(36).slice(2);
      setUid(tmp);
      localStorage.setItem("uid", tmp);
      addLog(`Vytvořen pseudo UID: ${tmp}`);
    } else {
      addLog(`Načten UID z localStorage: ${uid}`);
    }

    try {
      const bucket = storage?.app?.options?.storageBucket || "(neznámý)";
      addLog(`Bucket z configu: ${bucket}`);
    } catch {
      addLog("Nelze přečíst bucket z configu.");
    }
    addLog(`UserAgent: ${navigator.userAgent}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global error -> do UI
  useEffect(() => {
    const onErr = (msg, src, line, col, err) => {
      const m = `window.onerror: ${msg || err?.message || "neznámá chyba"}`;
      setError(m);
      addLog(m);
      return false;
    };
    const onRej = (e) => {
      const m = `unhandledrejection: ${e?.reason?.message || e?.reason || e}`;
      setError(m);
      addLog(m);
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
    };
  }, []);

  // --- Síťové testy ---
  const pingGstatic = async () => {
    addLog("Ping gstatic…");
    try {
      await fetch("https://www.gstatic.com/generate_204", { mode: "no-cors" });
      addLog("Ping gstatic: OK");
    } catch (e) {
      addLog(`Ping gstatic: FAIL (${e?.message || e})`);
      setError("Síť blokuje gstatic (zkus vypnout VPN/AdGuard a přepnout síť).");
    }
  };

  const pingFirebaseStorage = async () => {
    addLog("Ping firebasestorage…");
    try {
      await fetch("https://firebasestorage.googleapis.com/generate_204", { mode: "no-cors" });
      addLog("Ping firebasestorage: OK");
    } catch (e) {
      addLog(`Ping firebasestorage: FAIL (${e?.message || e})`);
      setError("Síť blokuje firebasestorage.googleapis.com.");
    }
  };

  // --- Test zápisu malého blobu ---
  const testBlob = async () => {
    setError("");
    setUploadPct(0);
    addLog("Test zápisu blobu start…");
    try {
      const r = sref(storage, `user_uploads/${uid || "guest"}/__test_${Date.now()}.txt`);
      const blob = new Blob(["hello from putping"], { type: "text/plain" });
      const task = uploadBytesResumable(r, blob, { contentType: "text/plain" });
      await new Promise((res, rej) => {
        task.on("state_changed",
          (snap) => setUploadPct(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
          rej,
          res
        );
      });
      addLog("Test zápisu: ✅ OK");
    } catch (e) {
      const msg = e?.code ? `${e.code} – ${e.message}` : (e?.message || String(e));
      setError(`Test zápisu selhal: ${msg}`);
      addLog(`Test zápisu ERROR: ${msg}`);
    }
  };

  // --- Upload fotky ---
  const onPickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    startUpload(file);
  };

  const startUpload = (file) => {
    setError("");
    setUploadPct(0);
    setPhotoURL("");
    addLog(`Upload start: ${file.name} (${file.type}, ${file.size} B)`);

    const safe = file.name.replace(/\s+/g, "_");
    const path = `user_uploads/${uid || "guest"}/${Date.now()}-${safe}`;
    const r = sref(storage, path);

    let task;
    try {
      task = uploadBytesResumable(r, file, { contentType: file.type });
    } catch (e) {
      const msg = `uploadBytesResumable THROW: ${e?.message || e}`;
      setError(msg);
      addLog(msg);
      return;
    }

    task.on(
      "state_changed",
      (snap) => setUploadPct(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      (err) => {
        const msg = mapStorageError(err);
        setError(msg);
        addLog(`Upload error: ${err?.code || ""} ${err?.message || ""}`);
      },
      async () => {
        try {
          const url = await getDownloadURL(task.snapshot.ref);
          setPhotoURL(url);
          addLog("getDownloadURL: OK");
        } catch (e) {
          const msg = `getDownloadURL ERROR: ${e?.message || e}`;
          setError(msg);
          addLog(msg);
        }
        setUploadPct(100);
        addLog("Upload DONE");
      }
    );
  };

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
                  maxWidth: 760, margin: "24px auto", padding: 16 }}>
      <h2>PutPing – Upload test (diagnostic v2)</h2>
      <div style={{ fontSize: 12, opacity: .7, marginBottom: 6 }}>{BUILD_VERSION}</div>

      <div style={{ fontSize: 14, opacity: .8, marginBottom: 12 }}>
        UID: <code>{uid || "…"}</code>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <button onClick={pingGstatic} style={btn}>Ping gstatic</button>
        <button onClick={pingFirebaseStorage} style={btn}>Ping firebasestorage</button>
        <button onClick={testBlob} style={btn}>Test Storage zápisu</button>

        <label style={{ ...btn, display: "inline-block", cursor: "pointer" }}>
          Nahrát fotku
          <input type="file" accept="image/*" onChange={onPickPhoto} style={{ display: "none" }} />
        </label>
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
    </div>
  );
}

const btn = {
  padding: "10px 14px",
  borderRadius: 12,
  boxShadow: "0 1px 3px rgba(0,0,0,.15)",
  border: 0,
  background: "#f3f3f3"
};

function mapStorageError(err) {
  if (!err) return "Neznámá chyba";
  switch (err.code) {
    case "storage/unauthorized": return "Unauthorized (zkontroluj Storage rules nebo App Check).";
    case "storage/canceled": return "Nahrávání zrušeno.";
    case "storage/retry-limit-exceeded": return "Vypršel čas – zkus menší soubor / jiné připojení.";
    case "storage/object-not-found": return "Soubor nenalezen.";
    default: return `${err.code || "error"} – ${err.message || ""}`;
  }
}
