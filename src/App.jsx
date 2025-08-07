import { useEffect, useState } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue, remove, push } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import mapboxgl from "mapbox-gl";

const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  databaseURL: "https://putping-dc57e-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e93b0ff17a816549635b",
  measurementId: "G-RL6MGM46M6X"
};

initializeApp(firebaseConfig);
const db = getDatabase();
const auth = getAuth();

mapboxgl.accessToken = 'pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w';

const pingSound = new Audio("https://notificationsounds.com/notification-sounds/event-538/download/mp3");

export default function Home() {
  const [map, setMap] = useState(null);
  const [userId, setUserId] = useState(null);
  const [users, setUsers] = useState({});
  const [nickname, setNickname] = useState("");
  const [markers, setMarkers] = useState([]);
  const [nicknameSubmitted, setNicknameSubmitted] = useState(false);
  const [pingMessage, setPingMessage] = useState("");

  useEffect(() => {
    Notification.requestPermission().then(permission => {
      console.log("Notification permission:", permission);
    });
  }, []);

  useEffect(() => {
    signInAnonymously(auth).then((userCredential) => {
      setUserId(userCredential.user.uid);
    });
  }, []);

  useEffect(() => {
    if (!map && document.getElementById("map")) {
      const newMap = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/streets-v11",
        center: [14.42076, 50.08804],
        zoom: 13
      });
      setMap(newMap);
    }
  }, [map]);

  useEffect(() => {
    const updateLocation = () => {
      if (userId && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            const userRef = ref(db, `users/${userId}`);
            set(userRef, {
              location: {
                lat: position.coords.latitude,
                lng: position.coords.longitude
              },
              status: "active",
              lastActive: Date.now(),
              name: nickname || "Anonymní uživatel"
            });
          },
          (error) => {
            console.error("Geolocation error:", error);
          },
          {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
          }
        );
      }
    };

    updateLocation();
    const interval = setInterval(updateLocation, 10000);
    return () => clearInterval(interval);
  }, [userId, nickname]);

  useEffect(() => {
    const usersRef = ref(db, "users");
    const unsubscribe = onValue(usersRef, (snapshot) => {
      const data = snapshot.val();
      setUsers(data || {});
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      Object.entries(users).forEach(([uid, user]) => {
        if (user.lastActive && now - user.lastActive > 60 * 1000) {
          remove(ref(db, `users/${uid}`));
        }
      });
    }, 30000);
    return () => clearInterval(interval);
  }, [users]);

  useEffect(() => {
    if (!userId) return;

    const pingRef = ref(db, `pings/${userId}`);
    const unsubscribe = onValue(pingRef, (snapshot) => {
      const pings = snapshot.val();
      if (pings) {
        Object.entries(pings).forEach(([pingId, pingData]) => {
          setPingMessage("📨 Dostal jsi ping!");
          if (Notification.permission === "granted") {
            new Notification("📨 Dostal jsi ping!");
          }
          pingSound.play().catch((e) => {
            console.warn("Zvuk se nepodařilo přehrát:", e);
          });
          remove(ref(db, `pings/${userId}/${pingId}`));
          setTimeout(() => setPingMessage(""), 4000);
        });
      }
    });

    return () => unsubscribe();
  }, [userId]);

  const sendPing = (targetId) => {
    const pingRef = ref(db, `pings/${targetId}`);
    push(pingRef, {
      from: userId,
      timestamp: Date.now()
    });
    console.log("Ping odeslán:", targetId);
  };

  useEffect(() => {
    if (map) {
      markers.forEach(marker => marker.remove());
      const newMarkers = [];

      Object.entries(users).forEach(([uid, user]) => {
        if (user.location) {
          const distance = getDistance(user.location.lat, user.location.lng);
          if (distance <= 5000) {
            const marker = new mapboxgl.Marker({ color: uid === userId ? "red" : distance < 500 ? "green" : "blue" })
              .setLngLat([user.location.lng, user.location.lat]);

            const isOnline = Date.now() - user.lastActive < 30000;

            const popupDiv = document.createElement("div");
            popupDiv.innerHTML = `
              <strong>${user.name || "Uživatel"}</strong><br/>
              ${isOnline ? "<em>Online právě teď</em><br/>" : ""}
              ${uid !== userId ? `Vzdálenost: ${Math.round(distance)} m<br/>` : ""}
              ${uid !== userId ? `<button id="ping-${uid}">📨 Poslat ping</button>` : ""}
              Aktivní: ${new Date(user.lastActive).toLocaleString()}
            `;

            const popup = new mapboxgl.Popup({ offset: 25 }).setDOMContent(popupDiv);
            marker.setPopup(popup).addTo(map);
            newMarkers.push(marker);

            popup.on('open', () => {
              const button = document.getElementById(`ping-${uid}`);
              if (button) {
                button.addEventListener("click", () => sendPing(uid));
              }
            });
          }
        }
      });

      setMarkers(newMarkers);
    }
  }, [map, users, userId]);

  const getDistance = (lat, lng) => {
    const R = 6371e3;
    const toRad = (x) => (x * Math.PI) / 180;
    const user = users[userId];
    if (!user || !user.location) return Infinity;

    const φ1 = toRad(user.location.lat);
    const φ2 = toRad(lat);
    const Δφ = toRad(lat - user.location.lat);
    const Δλ = toRad(lng - user.location.lng);

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

  const handleNicknameSubmit = () => {
    if (userId) {
      const userRef = ref(db, `users/${userId}/name`);
      set(userRef, nickname);
      setNicknameSubmitted(true);
    }
  };

  return (
    <div>
      {!nicknameSubmitted && (
        <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1, background: "white", padding: 10, borderRadius: 5 }}>
          <input
            type="text"
            value={nickname}
            placeholder="Zadej jméno"
            onChange={(e) => setNickname(e.target.value)}
          />
          <button onClick={handleNicknameSubmit}>Uložit</button>
        </div>
      )}
      {pingMessage && (
        <div style={{
          position: "absolute",
          bottom: 20,
          left: "50%",
          transform: "translateX(-50%)",
          background: "#333",
          color: "#fff",
          padding: "10px 20px",
          borderRadius: "8px",
          zIndex: 2,
          boxShadow: "0 2px 10px rgba(0,0,0,0.3)"
        }}>
          {pingMessage}
        </div>
      )}
      <div id="map" style={{ width: "100vw", height: "100vh" }}></div>
    </div>
  );
}

