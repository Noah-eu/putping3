import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN || window.MAPBOX_TOKEN || '';
export default function MapView({ profile }) {
  const mapContainer = useRef(null);
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (mapRef.current || !mapContainer.current) return;
    mapRef.current = new mapboxgl.Map({
      container: mapContainer.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center: profile?.coords ? [profile.coords.lng, profile.coords.lat] : [14.42076, 50.08804],
      zoom: profile?.coords ? 13 : 11,
    });
    mapRef.current.on('load', () => setMapReady(true));
  }, []); // only once

  useEffect(() => {
    if (!mapReady || !mapRef.current || !profile?.coords) return;
    const color = profile?.color || '#444';
    const marker = new mapboxgl.Marker({ color })
      .setLngLat([profile.coords.lng, profile.coords.lat])
      .addTo(mapRef.current);
    mapRef.current.flyTo({ center: [profile.coords.lng, profile.coords.lat], zoom: 13, essential: true });
    return () => marker.remove();
  }, [mapReady, profile?.coords?.lat, profile?.coords?.lng, profile?.color]);

  return <div ref={mapContainer} style={{ position:'absolute', inset:0 }} />;
}
