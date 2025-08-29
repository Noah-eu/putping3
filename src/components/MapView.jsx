import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || window.MAPBOX_TOKEN || '';

export default function MapView({ profile }) {
  const p = profile ?? (() => { try { return JSON.parse(localStorage.getItem('pp_profile') || 'null'); } catch { return null; } })();

  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  // Init map once
  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return;
    mapRef.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: p?.coords ? [p.coords.lng, p.coords.lat] : [14.42076, 50.08804],
      zoom: p?.coords ? 13 : 11,
    });
    mapRef.current.on('load', () => setMapReady(true));
  }, []);

  // Self marker is handled centrally (lib/selfMarker.ts); do not create another
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
  }, [mapReady]);

  return <div ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />;
}
