import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { attachPinZoom } from '../lib/pinZoom.ts';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// helper: teardrop DOM – single element with img inside
function buildTearDropEl(photoUrl, color) {
  const el = document.createElement('div');
  el.className = 'pp-tear';
  el.style.setProperty('--pp-color', color || '#ff5aa5');
  const inner = document.createElement('div');
  inner.className = 'pp-inner';
  const img = document.createElement('img');
  img.className = 'pp-avatar';
  img.alt = 'avatar';
  img.src = photoUrl || '';
  inner.appendChild(img);
  el.appendChild(inner);
  return el;
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
      // výrazně přiblížená mapa ~1 km čtvereční
      zoom: profile?.coords ? 16.5 : 14,
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
      attachPinZoom(el, map, [lng, lat]);

      selfMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      // update pozice + barvy + fotky
      selfMarkerRef.current.setLngLat([lng, lat]);
      const el = selfMarkerRef.current.getElement();
      const pUrl = profile?.photoDataUrl || profile?.photoURL || '';
      el.style.setProperty('--pp-color', color);
      const img = el.querySelector('.pp-avatar');
      if (img && pUrl) img.src = pUrl;
    }
  }, [mapReady, profile?.coords?.lng, profile?.coords?.lat, profile?.photoDataUrl, profile?.photoURL, profile?.gender]);

  return (
    <div ref={mapElRef} style={{ position: 'absolute', inset: 0 }} />
  );
}
