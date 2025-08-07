import { useEffect, useState } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import mapboxgl from "mapbox-gl";

const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
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

export default function Home() {
  const [map, setMap] = useState(null);
  const [userId, setUserId] = useState(null);
  const [users, setUsers] = useState({});

  useEffect(() => {
    signInAnonymously(auth).then((userCredential) => {
      setUserId(userCredential.user.uid);
    });
  }, []);

  useEffect(() => {
    if (!map && document.getElementById('map')) {
      const initializeMap = new mapboxgl.Map({
        container: "map",
        style: "mapbox://styles/mapbox/streets-v11",
        center: [14.42076, 50.08804],
        zoom: 13
      });
      setMap(initializeMap);
    }
  }, [map]);

  useEffect(() => {
    if (userId && "geolocation" in navigator) {
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
            username: "Ty"
          });
        },
        (error) => {
          if (error.code === error.PERMISSION_DENIED) {
            alert("Musíš povolit sdílení polohy, aby ses zobrazil na mapě.");
          } else {
            alert("Nepodařilo se získat polohu.");
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    } else if (!("geolocation" in navigator)) {
      console.error("Geolocation not supported by this browser.");
    }
  }, [userId]);

  useEffect(() => {
    const usersRef = ref(db, "users");
    const unsubscribe = onValue(usersRef, (snapshot) => {
      const data = snapshot.val();
      setUsers(data || {});
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (map) {
      // Odstranit staré markery
      map.eachLayer?.((layer) => {
        if (layer.type === 'symbol') map.removeLayer(layer);
      });

      Object.entries(users).forEach(([uid, user]) => {
        if (user.location) {
          const marker = new mapboxgl.Marker({ color: uid === userId ? "red" : "blue" })
            .setLngLat([user.location.lng, user.location.lat])
            .addTo(map);

          // Popis uživatele (jméno + čas)
          const timeAgo = Date.now() - (user.lastActive || 0);
          const minutesAgo = Math.floor(timeAgo / 60000);
          const popupText = `${user.username || 'Uživatel'}\nAktivní před ${minutesAgo} min.`;

          const popup = new mapboxgl.Popup({ offset: 25 }).setText(popupText);
          marker.setPopup(popup);
        }
      });
    }
  }, [map, users, userId]);

  return (
    <div>
      <div id="map" style={{ width: "100vw", height: "100vh" }}></div>
    </div>
  );
}
