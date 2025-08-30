import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// helper: teardrop DOM (wrapper + inner pin)
function buildTearDropEl(photoUrl, color) {
  // wrapper – jde do mapbox Marker.element
  const wrapper = document.createElement('div');
  wrapper.className = 'pp-tear';

  // inner – ten se bude škálovat
  const pin = document.createElement('div');
  pin.className = 'pp-pin';
  pin.style.setProperty('--pp-color', color || '#ff5aa5');

  const img = document.createElement('img');
  img.className = 'pp-avatar';
  img.alt = 'avatar';
  if (photoUrl) img.src = photoUrl;
  pin.appendChild(img);

  wrapper.appendChild(pin);
  return wrapper;
}

export default function MapView({ profile }) {
  const mapRef = useRef(null);
  const mapElRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const selfMarkerRef = useRef(null);

  const center = profile?.coords
    ? [profile.coords.lng, profile.coords.lat]
    : [14.42076, 50.08804];

  // 1) inicializace mapy
  useEffect(() => {
    if (mapRef.current) return;
    const m = new mapboxgl.Map({
      container: mapElRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center,
      zoom: profile?.coords ? 13 : 11,
    });
    mapRef.current = m;
    m.once('load', () => setMapReady(true));
    return () => {
      m.remove();
      mapRef.current = null;
    };
  }, []); // pouze jednou

  // 2) náš pin (teardrop) + klik = 5× zoom
  useEffect(() => {
    if (!mapReady || !mapRef.current || !profile?.coords) return;
    const map = mapRef.current;

    const lng = profile.coords.lng;
    const lat = profile.coords.lat;

    const g = (profile.gender || '').toLowerCase();
    const color =
      g === 'žena' || g === 'zena'
        ? '#ff5aa5'
        : g === 'muž' || g === 'muz'
        ? '#4f8cff'
        : '#7b61ff';

    // vytvoř/obnov marker
    if (!selfMarkerRef.current) {
      const el = buildTearDropEl(profile?.photoDataUrl || profile?.photoURL || null, color);

      // klik = toggle zvětšení 5×
      const toggleZoom = (ev) => {
        ev.stopPropagation();
        const willZoom = !el.classList.contains('is-zoom');
        el.classList.toggle('is-zoom', willZoom);
        if (willZoom) {
          map.easeTo({
            center: [lng, lat],
            zoom: Math.max(map.getZoom(), 15),
            duration: 600,
          });
        }
      };
      el.addEventListener('click', toggleZoom);
      const imgEl = el.querySelector('.pp-avatar');
      if (imgEl) imgEl.addEventListener('click', toggleZoom);
      map.on('click', () => el.classList.remove('is-zoom'));

      selfMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      // update pozice + barvy + fotky
      selfMarkerRef.current.setLngLat([lng, lat]);
      const el = selfMarkerRef.current.getElement();
      el.style.setProperty('--pp-color', color);
      const img = el.querySelector('.pp-avatar');
      const pUrl = profile?.photoDataUrl || profile?.photoURL;
      if (img && pUrl) img.src = pUrl;
    }
  }, [mapReady, profile?.coords?.lng, profile?.coords?.lat, profile?.photoDataUrl, profile?.photoURL, profile?.gender]);

  return (
    <div ref={mapElRef} style={{ position: 'absolute', inset: 0 }} />
  );
}
