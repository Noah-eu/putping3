import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { upsertSelfMarker } from '../lib/selfMarker';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

export default function MapView({ profile }){
  const mapRef = useRef(null);
  const mapElRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

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
    return () => { m.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!mapReady || !mapRef.current || !profile?.coords) return;
    const map = mapRef.current;
    upsertSelfMarker({
      map,
      lng: profile.coords.lng,
      lat: profile.coords.lat,
      photoUrl: profile.photoDataUrl || null,
      color: profile.color || '#ff66b3',
      onClick: () => {
        const z = Math.max(map.getZoom(), 15);
        map.easeTo({ center: [profile.coords.lng, profile.coords.lat], zoom: z, duration: 600 });
      }
    });
  }, [mapReady, profile]);

  return (
    <div id="map" ref={mapElRef} style={{ width: '100vw', height: '100vh' }} />
  );
}
