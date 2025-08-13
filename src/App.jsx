import React, { useState, useEffect } from "react";
import mapboxgl from "mapbox-gl";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, onValue } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import { Swiper, SwiperSlide } from "swiper/react";
import "swiper/css";
import "./App.css";

const firebaseConfig = {
  apiKey: "AIzaSyCEUmxYLBn8LExlb2Ei3bUjz6vnEcNHx2Y",
  authDomain: "putping-dc57e.firebaseapp.com",
  projectId: "putping-dc57e",
  storageBucket: "putping-dc57e.appspot.com",
  messagingSenderId: "244045363394",
  appId: "1:244045363394:web:64e93b0ff17a816549635b",
  measurementId: "G-RL6MGM46M6X"
};

mapboxgl.accessToken =
  "pk.eyJ1IjoiZGl2YWRyZWRlIiwiYSI6ImNtZHd5YjR4NTE3OW4ybHF3bmVucWxqcjEifQ.tuOBnAN8iHiYujXklg9h5w";

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

export default function App() {
  const [map, setMap] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [profilePhoto, setProfilePhoto] = useState(null);
  const [showGallery, setShowGallery] = useState(false);

  useEffect(() => {
    signInAnonymously(auth);
    const m = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v11",
      center: [14.42076, 50.08804],
      zoom: 12
    });
    setMap(m);
  }, []);

  const uploadPhoto = (isProfile) => {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        if (isProfile) {
          setProfilePhoto(reader.result);
        }
        setPhotos((prev) => [...prev, reader.result]);
      };
      reader.readAsDataURL(file);
    };
    fileInput.click();
  };

  const markerClick = () => {
    if (photos.length > 0) {
      setShowGallery(true);
    }
  };

  return (
    <div style={{ height: "100vh", width: "100vw" }}>
      <div id="map" style={{ height: "100%", width: "100%" }}></div>

      {map &&
        profilePhoto &&
        new mapboxgl.Marker({
          element: (() => {
            const el = document.createElement("img");
            el.src = profilePhoto;
            el.style.width = "50px";
            el.style.height = "50px";
            el.style.borderRadius = "50%";
            el.style.cursor = "pointer";
            el.onclick = markerClick;
            return el;
          })()
        })
          .setLngLat([14.42076, 50.08804])
          .addTo(map)}

      {/* FAB */}
      <div
        style={{
          position: "absolute",
          bottom: "20px",
          right: "20px",
          display: "flex",
          flexDirection: "column",
          gap: "10px"
        }}
      >
        <button
          style={{
            width: "60px",
            height: "60px",
            borderRadius: "50%",
            background: "#1976d2",
            color: "white",
            border: "none",
            fontSize: "24px"
          }}
          onClick={() => uploadPhoto(true)}
        >
          📷
        </button>
        <button
          style={{
            width: "60px",
            height: "60px",
            borderRadius: "50%",
            background: "#4caf50",
            color: "white",
            border: "none",
            fontSize: "24px"
          }}
          onClick={() => uploadPhoto(false)}
        >
          ➕
        </button>
      </div>

      {/* Gallery */}
      {showGallery && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            background: "rgba(0,0,0,0.9)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column"
          }}
          onClick={() => setShowGallery(false)}
        >
          <Swiper spaceBetween={10} slidesPerView={1}>
            {photos.map((src, idx) => (
              <SwiperSlide key={idx}>
                <img
                  src={src}
                  alt=""
                  style={{
                    borderRadius: "50%",
                    width: "70vw",
                    height: "70vw",
                    objectFit: "cover"
                  }}
                />
              </SwiperSlide>
            ))}
          </Swiper>
        </div>
      )}
    </div>
  );
}
