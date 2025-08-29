import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { createTeardropMarkerEl, closeAllTeardrops } from '../lib/createTeardropMarker.ts';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export default function MapView({ profile }){
  const mapRef = useRef(null);
  const mapElRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const selfRef = useRef(null);

  const center = profile?.coords ? [profile.coords.lng, profile.coords.lat] : [14.42076, 50.08804];

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
    m.on('click', () => closeAllTeardrops());
    return () => { m.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !profile?.coords) return;
    const map = mapRef.current;
    const lng = profile.coords.lng;
    const lat = profile.coords.lat;
    if (!selfRef.current){
      const el = createTeardropMarkerEl({
        uid: profile.uid,
        name: profile.name,
        gender: profile.gender,
        color: profile.color,
        photoDataUrl: profile.photoDataUrl,
      });
      selfRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      selfRef.current.setLngLat([lng, lat]);
      const el = selfRef.current.getElement();
      if (profile.color) el.style.setProperty('--pp-color', profile.color);
      const img = el.querySelector('.pp-marker__avatar');
      if (img && profile.photoDataUrl) img.src = profile.photoDataUrl;
    }
  }, [mapReady, profile]);

  return (
    <div id="map" ref={mapElRef} style={{ width: '100vw', height: '100vh' }} />
  );
}
