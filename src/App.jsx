// src/App.jsx
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import {
  getDatabase,
  ref,
  set,
  update,
  onValue,
  remove,
  onDisconnect,
  push,
} from "firebase/database";

/* ========= TODO: doplň své údaje ========= */
mapboxgl.accessToken = "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.firebasestorage.app",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e930bff17a816549635b",
};
/* ========================================= */

initializeApp(firebaseConfig);
const db = getDatabase();

export default function App() {
  const [map, setMap] = useState(null);
  const [userId] = useState(
    localStorage.getItem("userId") ||
      Math.random().toString(36).slice(2, 11)
  );
  const [name, setName] = useState(localStorage.getItem("userName") || "");
  const [soundEnabled, setSoundEnabled] = useState(false);
  const markersRef = useRef({}); // id -> { marker, popup }
  const myMarkerRef = useRef(null);
  const pingSound = useRef(
    new Audio(
      "https://notificationsounds.com/storage/sounds/file-sounds-1150-event.mp3"
    )
  );

  // ulož id do localStorage, ať je stabilní
  useEffect(() => {
    localStorage.setItem("userId", userId);
  }, [userId]);

  // inicializace mapy + zápis mé lokace do DB
  useEffect(() => {
    if (!navigator.geolocation) {
      alert("Prohlížeč nepodporuje geolokaci.");
      return;
    }

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

        // můj záznam v DB
        const meRef = ref(db, `users/${userId}`);
        const data = {
          name: name || "Anonymní uživatel",
          lat: latitude,
          lng: longitude,
          lastActive: Date.now(),
        };
        set(meRef, data);
        onDisconnect(meRef).remove();

        // můj marker
        const myPopupHtml = `
          <b>${name || "Anonymní uživatel"}</b><br>
          ${new Date().toLocaleTimeString()}
        `;
        const myPopup = new mapboxgl.Popup({ offset: 25 }).setHTML(myPopupHtml);

        const myMarker = new mapboxgl.Marker({ color: "red" })
          .setLngLat([longitude, latitude])
          .setPopup(myPopup)
          .addTo(m);

        myMarkerRef.current = { marker: myMarker, popup: myPopup };

        // průběžný update lokace (watchPosition je lepší než interval)
        const watchId = navigator.geolocation.watchPosition(
          (p) => {
            const { latitude: lat, longitude: lng } = p.coords;
            update(meRef, {
              lat,
              lng,
              name: name || "Anonymní uživatel",
              lastActive: Date.now(),
            });
            if (myMarkerRef.current) {
              myMarkerRef.current.marker.setLngLat([lng, lat]);
              myMarkerRef.current.popup.setHTML(`
                <b>${name || "Anonymní uživatel"}</b><br>
                ${new Date().toLocaleTimeString()}
              `);
            }
          },
          () => {},
          { enableHighAccuracy: true }
        );

        // úklid
        return () => {
          navigator.geolocation.clearWatch(watchId);
        };
      },
      () => {
        alert("Nepodařilo se získat polohu.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // uložení jména
  const saveName = () => {
    localStorage.setItem("userName", name);
    // okamžitě přepíšeme i v DB
    update(ref(db, `users/${userId}`), {
      name: name || "Anonymní uživatel",
      lastActive: Date.now(),
    });
    if (myMarkerRef.current) {
      myMarkerRef.current.popup.setHTML(`
        <b>${name || "Anonymní uživatel"}</b><br>
        ${new Date().toLocaleTimeString()}
      `);
    }
  };

  // poslat ping zprávu někomu
  const sendPing = async (toUid, text = "") => {
    const pRef = ref(db, `pings/${toUid}`);
    await push(pRef, {
      from: userId,
      fromName: name || "Anonym",
      text,
      ts: Date.now(),
    });
  };

  // naslouchání příchozím pingům
  useEffect(() => {
    const myPingsRef = ref(db, `pings/${userId}`);
    const unsub = onValue(myPingsRef, (snap) => {
      const val = snap.val() || {};
      const ids = Object.keys(val);
      if (!ids.length) return;

      ids.forEach((pid) => {
        const p = val[pid];
        // notifikace + zvuk
        const who = p.fromName ? ` od ${p.fromName}` : "";
        const textPart = p.text ? `\n„${p.text}“` : "";
        alert(`📩 Ping${who}!${textPart}`);

        if (soundEnabled) {
          pingSound.current
            .play()
            .catch(() => console.warn("Zvuk se nepodařilo přehrát."));
        }

        // ping smažeme po doručení
        remove(ref(db, `pings/${userId}/${pid}`));
      });
    });
    return () => unsub();
  }, [userId, soundEnabled]);

  // markers pro ostatní uživatele
  useEffect(() => {
    if (!map) return;

    const TTL = 5 * 60 * 1000; // 5 minut
    const usersRef = ref(db, "users");
    const unsub = onValue(usersRef, (snap) => {
      const now = Date.now();
      const data = snap.val() || {};

      // přidej/aktualizuj
      Object.entries(data).forEach(([uid, u]) => {
        if (uid === userId) return; // nepřidávej mě znovu
        if (!u.lastActive || now - u.lastActive > TTL) {
          // neaktivní -> smaž marker
          if (markersRef.current[uid]) {
            markersRef.current[uid].marker.remove();
            delete markersRef.current[uid];
          }
          return;
        }

        const popupHtml = `
          <div>
            <b>${u.name || "Anonymní uživatel"}</b><br>
            ${new Date(u.lastActive).toLocaleTimeString()}<br>
            <div style="margin-top:6px">
              <button id="ping-${uid}" style="padding:4px 8px">📩 Ping</button>
            </div>
            <div style="margin-top:6px">
              <input id="msg-${uid}" placeholder="Zpráva" style="width:140px;padding:3px" />
              <button id="sendmsg-${uid}" style="padding:3px 6px">💬</button>
            </div>
          </div>
        `;

        if (!markersRef.current[uid]) {
          const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(popupHtml);
          const marker = new mapboxgl.Marker({ color: "blue" })
            .setLngLat([u.lng, u.lat])
            .setPopup(popup)
            .addTo(map);

          // přidáme posluchače až po otevření popupu
          popup.on("open", () => {
            const pingBtn = document.getElementById(`ping-${uid}`);
            const msgInput = document.getElementById(`msg-${uid}`);
            const sendBtn = document.getElementById(`sendmsg-${uid}`);

            if (pingBtn) pingBtn.onclick = () => sendPing(uid, "");
            if (sendBtn && msgInput)
              sendBtn.onclick = () => sendPing(uid, msgInput.value || "");
          });

          markersRef.current[uid] = { marker, popup };
        } else {
          // update pozice + obsah popupu
          const { marker, popup } = markersRef.current[uid];
          marker.setLngLat([u.lng, u.lat]);
          popup.setHTML(popupHtml);
        }
      });

      // smaž markery, které už nejsou v DB
      Object.keys(markersRef.current).forEach((uid) => {
        if (!data[uid]) {
          markersRef.current[uid].marker.remove();
          delete markersRef.current[uid];
        }
      });
    });

    return () => unsub();
  }, [map, userId]);

  return (
    <div>
      {/* horní lišta */}
      <div
        style={{
          position: "absolute",
          inset: "10px 10px auto 10px",
          zIndex: 10,
          background: "white",
          borderRadius: 8,
          padding: 8,
          boxShadow: "0 2px 8px rgba(0,0,0,.15)",
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Zadej jméno"
          style={{ padding: "6px 8px", width: 180 }}
        />
        <button onClick={saveName} style={{ padding: "6px 10px" }}>
          Uložit
        </button>
        <button
          onClick={() => {
            pingSound.current
              .play()
              .then(() => setSoundEnabled(true))
              .catch(() => {
                // některé prohlížeče vyžadují gesta – kliknutí právě proběhlo, tak by to mělo projít
                setSoundEnabled(true);
              });
          }}
          style={{ padding: "6px 10px" }}
        >
          🔊 Povolit zvuk
        </button>
      </div>

      <div id="map" style={{ width: "100vw", height: "100vh" }} />
    </div>
  );
}
