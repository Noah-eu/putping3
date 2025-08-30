import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { attachPinZoom } from '../lib/pinZoom.ts';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// helper: teardrop DOM – single element with img inside
function buildTearDropEl(photoUrl, color, name) {
  const el = document.createElement('div');
  el.className = 'pp-tear';
  el.style.setProperty('--pp-color', color || '#ff5aa5');
  // kontrastní barva pro rámeček jména (opačná barva genderu)
  const contrast = (c => {
    switch((c||'').toLowerCase()){
      case '#ff5aa5': return 'rgba(79,140,255,.55)';   // růžová -> modrá
      case '#4f8cff': return 'rgba(255,90,165,.55)';   // modrá -> růžová
      case '#22c55e': return 'rgba(123,97,255,.55)';   // zelená -> fialová
      default:        return 'rgba(17,17,17,.5)';
    }
  })(color);
  el.style.setProperty('--pp-contrast', contrast);
  const inner = document.createElement('div');
  inner.className = 'pp-inner';
  const img = document.createElement('img');
  img.className = 'pp-avatar';
  img.alt = 'avatar';
  img.src = photoUrl || '';
  inner.appendChild(img);
  const label = document.createElement('div');
  label.className = 'pp-name';
  label.textContent = name || '';
  el.appendChild(inner);
  el.appendChild(label); // umísti jméno mimo .pp-inner, aby se neskalovalo 5×
  return el;
}

export default function MapView({ profile }) {
  const mapRef = useRef(null);
  const mapElRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const selfMarkerRef = useRef(null);
  const [geoPos, setGeoPos] = useState(null); // {lng,lat} (averaged)
  const geoBufRef = useRef([]); // posledních N vzorků pro vyhlazení
  const centeredOnceRef = useRef(false); // zajistí centrování po načtení

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

    const lng = (geoPos?.lng ?? profile.coords.lng);
    const lat = (geoPos?.lat ?? profile.coords.lat);

    const g = (profile.gender || '').toLowerCase();
    const color =
      (g === 'muz' || g === 'muž') ? '#ff5aa5' :
      (g === 'zena' || g === 'žena') ? '#4f8cff' :
      '#22c55e';

    // vytvoř/obnov marker
    if (!selfMarkerRef.current) {
      const el = buildTearDropEl(profile?.photoDataUrl || profile?.photoURL || null, color, profile?.name || '');
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
      const contrast = ((c)=>{switch((c||'').toLowerCase()){case '#ff5aa5':return 'rgba(79,140,255,.55)';case '#4f8cff':return 'rgba(255,90,165,.55)';case '#22c55e':return 'rgba(123,97,255,.55)';default:return 'rgba(17,17,17,.5)';}})(color);
      el.style.setProperty('--pp-contrast', contrast);
      const img = el.querySelector('.pp-avatar');
      if (img && pUrl) img.src = pUrl;
      const label = el.querySelector('.pp-name');
      if (label) label.textContent = profile?.name || '';
    }
  }, [mapReady, profile?.coords?.lng, profile?.coords?.lat, profile?.photoDataUrl, profile?.photoURL, profile?.gender, geoPos?.lng, geoPos?.lat]);

  // 2b) Po načtení mapy vždy vycentrovat uživatele doprostřed
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const lng = (geoPos?.lng ?? profile?.coords?.lng);
    const lat = (geoPos?.lat ?? profile?.coords?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    if (centeredOnceRef.current) return;
    try {
      mapRef.current.jumpTo({ center: [lng, lat] });
      centeredOnceRef.current = true;
    } catch {}
  }, [mapReady, geoPos?.lng, geoPos?.lat, profile?.coords?.lng, profile?.coords?.lat]);

  // 3) Live geolocation – vyhlazení a zlepšení přesnosti
  useEffect(() => {
    if (!mapReady) return;
    if (!('geolocation' in navigator)) return;
    const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords || {};
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        // Akceptuj jen rozumné vzorky (<= 25 m) a vyhlaď váženým průměrem
        if (accuracy != null && accuracy > 25) return;
        const w = 1 / Math.max(accuracy || 10, 5) ** 2; // menší accuracy => větší váha
        const buf = geoBufRef.current || [];
        buf.push({ lat: latitude, lng: longitude, w });
        if (buf.length > 8) buf.shift();
        geoBufRef.current = buf;
        let sumW = 0, sumLat = 0, sumLng = 0;
        for (const s of buf) { sumW += s.w; sumLat += s.lat * s.w; sumLng += s.lng * s.w; }
        if (sumW > 0) setGeoPos({ lat: sumLat / sumW, lng: sumLng / sumW });
      },
      () => {},
      opts
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [mapReady]);

  return (
    <div ref={mapElRef} style={{ position: 'absolute', inset: 0 }} />
  );
}
