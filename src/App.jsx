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

/* ===== TODO: doplň svoje údaje ===== */
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
/* =================================== */

initializeApp(firebaseConfig);
const db = getDatabase();

/** odemknutí WebAudio (pro iOS/Android) */
function useAudioUnlock() {
  const unlockedRef = useRef(false);
  const ctxRef = useRef(null);

  const unlock = async () => {
    try {
      if (!ctxRef.current) {
        const Ctx =
          window.AudioContext || window.webkitAudioContext || null;
        if (Ctx) ctxRef.current = new Ctx();
      }
      if (ctxRef.current && ctxRef.current.state !== "running") {
        await ctxRef.current.resume();
      }
      unlockedRef.current = true;
    } catch {}
  };

  return { unlockedRef, unlock };
}

export default function App() {
  const [map, setMap] = useState(null);
  const [userId] = useState(
    localStorage.getItem("userId") || Math.random().toString(36).slice(2, 11)
  );
  const [name, setName] = useState(localStorage.getItem("userName") || "");
  const [soundEnabled, setSoundEnabled] = useState(false);

  const markersRef = useRef({});
  const myMarkerRef = useRef(null);
  const pingUrl =
    "https://notificationsounds.com/storage/sounds/file-sounds-1150-event.mp3";
  const pingSound = useRef(new Audio(pingUrl));
  const { unlockedRef, unlock } = useAudioUnlock();

  useEffect(() => {
    localStorage.setItem("userId", userId);
  }, [userId]);

  // init mapy + zápis mé polohy
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

        const meRef = ref(db, `users/${userId}`);
        set(meRef, {
          name: name || "Anonymní uživatel",
          lat: latitude,
          lng: longitude,
          lastActive: Date.now(),
        });
        onDisconnect(meRef).remove();

        // můj marker
        const myPopup = new mapboxgl.Popup({ offset: 25 }).setHTML(
          `<b>${name || "Anonymní uživatel"}</b><br>${new Date().toLocaleTimeString()}`
        );
        const myMarker = new mapboxgl.Marker({ color: "red" })
          .setLngLat([longitude, latitude])
          .setPopup(myPopup)
          .addTo(m);
        myMarkerRef.current = { marker: myMarker, popup: myPopup };

        // live update pozice
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
              // POZOR: popup HTML už nepřepisujeme při každém ticku,
              // jen čas od času (nebo vůbec není nutné)
            }
          },
          () => {},
          { enableHighAccuracy: true }
        );

        return () => {
          navigator.geolocation.clearWatch(watchId);
        };
      },
      () => alert("Nepodařilo se získat polohu."),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveName = () => {
    localStorage.setItem("userName", name);
    update(ref(db, `users/${userId}`), {
      name: name || "Anonymní uživatel",
      lastActive: Date.now(),
    });
    if (myMarkerRef.current) {
      myMarkerRef.current.popup.setHTML(
        `<b>${name || "Anonymní uživatel"}</b><br>${new Date().toLocaleTimeString()}`
      );
    }
  };

  const sendPing = async (toUid, text = "") => {
    await push(ref(db, `pings/${toUid}`), {
      from: userId,
      fromName: name || "Anonym",
      text,
      ts: Date.now(),
    });
  };

  // příchozí pingy
  useEffect(() => {
    const unsub = onValue(ref(db, `pings/${userId}`), (snap) => {
      const all = snap.val() || {};
      const ids = Object.keys(all);
      if (!ids.length) return;

      ids.forEach((pid) => {
        const p = all[pid];
        const who = p.fromName ? ` od ${p.fromName}` : "";
        const textPart = p.text ? `\n„${p.text}“` : "";
        alert(`📩 Ping${who}!${textPart}`);

        if (soundEnabled) {
          try {
            // WebAudio odemknout na gesta – tlačítkem „Povolit zvuk“
            // a přehrávat klony, ať to neblokuje další zvuky
            const a = new Audio(pingUrl);
            a.preload = "auto";
            a.play().catch(() => {});
          } catch {}
        }

        remove(ref(db, `pings/${userId}/${pid}`));
      });
    });
    return () => unsub();
  }, [userId, soundEnabled]);

  // ostatní uživatelé – už NEpřepisuju popup HTML při každé změně!
  useEffect(() => {
    if (!map) return;

    const TTL = 5 * 60 * 1000;
    const unsub = onValue(ref(db, "users"), (snap) => {
      const now = Date.now();
      const data = snap.val() || {};

      // přidání/aktualizace
      Object.entries(data).forEach(([uid, u]) => {
        if (uid === userId) return;
        if (!u.lastActive || now - u.lastActive > TTL) {
          if (markersRef.current[uid]) {
            markersRef.current[uid].marker.remove();
            delete markersRef.current[uid];
          }
          return;
        }

        const ensureHandlers = (uid) => {
          // při otevření popupu napojíme listeners
          const pingBtn = document.getElementById(`ping-${uid}`);
          const msgInput = document.getElementById(`msg-${uid}`);
          const sendBtn = document.getElementById(`sendmsg-${uid}`);

          if (pingBtn && !pingBtn.dataset.bound) {
            pingBtn.dataset.bound = "1";
            pingBtn.onclick = (e) => {
              e.stopPropagation();
              sendPing(uid, "");
            };
          }
          if (sendBtn && msgInput && !sendBtn.dataset.bound) {
            sendBtn.dataset.bound = "1";
            sendBtn.onclick = (e) => {
              e.stopPropagation();
              const txt = msgInput.value || "";
              sendPing(uid, txt);
            };
          }
        };

        if (!markersRef.current[uid]) {
          // vytvoříme popup jen jednou
          const popupHtml = `
            <div style="min-width:170px">
              <b>${u.name || "Anonymní uživatel"}</b><br>
              <small>${new Date(u.lastActive).toLocaleTimeString()}</small><br>
              <div style="margin-top:6px">
                <button id="ping-${uid}" style="padding:4px 8px">📩 Ping</button>
              </div>
              <div style="margin-top:6px; display:flex; gap:4px">
                <input id="msg-${uid}" placeholder="Zpráva" style="flex:1;padding:4px" />
                <button id="sendmsg-${uid}" style="padding:4px 8px">💬</button>
              </div>
            </div>
          `;
          const popup = new mapboxgl.Popup({ offset: 25 }).setHTML(popupHtml);
          const marker = new mapboxgl.Marker({ color: "blue" })
            .setLngLat([u.lng, u.lat])
            .setPopup(popup)
            .addTo(map);

          popup.on("open", () => ensureHandlers(uid));
          markersRef.current[uid] = { marker, popup, lastName: u.name || "" };
        } else {
          // jen pohneme markerem, HTML nesahejte => input nezmizí
          markersRef.current[uid].marker.setLngLat([u.lng, u.lat]);

          // pokud se změnilo jméno, popup přegenerujeme (vzácně)
          const lastName = markersRef.current[uid].lastName || "";
          const newName = u.name || "";
          if (newName !== lastName) {
            markersRef.current[uid].lastName = newName;
            const popupHtml = `
              <div style="min-width:170px">
                <b>${newName || "Anonymní uživatel"}</b><br>
                <small>${new Date(u.lastActive).toLocaleTimeString()}</small><br>
                <div style="margin-top:6px">
                  <button id="ping-${uid}" style="padding:4px 8px">📩 Ping</button>
                </div>
                <div style="margin-top:6px; display:flex; gap:4px">
                  <input id="msg-${uid}" placeholder="Zpráva" style="flex:1;padding:4px" />
                  <button id="sendmsg-${uid}" style="padding:4px 8px">💬</button>
                </div>
              </div>
            `;
            markersRef.current[uid].popup.setHTML(popupHtml);
            markersRef.current[uid].popup.on("open", () => {
              const i = document.getElementById(`msg-${uid}`);
              if (i) i.value = "";
            });
          }
        }
      });

      // cleanup markerů co už nejsou
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
      {/* horní lišta – je vždy viditelná */}
      <div
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          top: 10,
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
          style={{ padding: "6px 8px", flex: "0 0 180px" }}
        />
        <button onClick={saveName} style={{ padding: "6px 10px" }}>
          Uložit
        </button>
        <button
          onClick={async () => {
            await unlock(); // odemkne AudioContext
            try {
              // „test“ přehrání – tím si prohlížeč zapamatuje gesta
              const a = new Audio(pingUrl);
              a.preload = "auto";
              await a.play();
            } catch {}
            setSoundEnabled(true);
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
