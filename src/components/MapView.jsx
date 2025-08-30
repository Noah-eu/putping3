import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';

// ---- helper pro teardrop element --------------------------------
function buildTearDropEl(photoUrl, color, map, lng, lat) {
  const el = document.createElement('div');
  el.className = 'pp-tear';
  el.style.setProperty('--pp-color', color);

  const img = document.createElement('img');
  img.className = 'pp-avatar';
  img.alt = 'avatar';
  img.src = photoUrl || '';
  el.appendChild(img);

  // --- klik = zvětšit 5× (toggle) ---


  el.addEventListener('click', toggleZoom);
  img.addEventListener('click', toggleZoom);

  // klik do mapy vrátí zpět
  map.on('click', () => el.classList.remove('is-zoom'));

  return el;
}

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export default function MapView({ profile }) {
  const mapRef = useRef(null);
  const mapElRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const selfRef = useRef(null);

  const center = profile?.coords
    ? [profile.coords.lng, profile.coords.lat]
    : [14.42076, 50.08804];

  useEffect(() => {
    if (mapRef.current) return;
    const m = new mapboxgl.Map({
      container: mapElRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center,
      zoom: 13,
    });
    mapRef.current = m;
    m.once('load', () => setMapReady(true));
    return () => { m.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !profile?.coords) return;
    const map = mapRef.current;
    const lng = profile.coords.lng;
    const lat = profile.coords.lat;
    const g = (profile.gender || '').toLowerCase();
    const color =
      g === 'žena' || g === 'zena'
        ? '#ff5aa5'
        : g === 'muz' || g === 'muž'
        ? '#4f8cff'
        : '#7b61ff';

    if (!selfRef.current) {
      const el = buildTearDropEl(profile?.photoDataUrl || profile?.photoURL || null, color, map, lng, lat);
      selfRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      selfRef.current.setLngLat([lng, lat]);
      const el = selfRef.current.getElement();
      el.style.setProperty('--pp-color', color);
      const img = el.querySelector('.pp-avatar');
      if (img && (profile.photoDataUrl || profile.photoURL)) {
        img.src = profile.photoDataUrl || profile.photoURL;
      }
    }
  }, [mapReady, profile]);

  return (
    <div id="map" ref={mapElRef} style={{ width: '100vw', height: '100vh' }} />
  );
}
