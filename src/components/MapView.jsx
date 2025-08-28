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

    const { coords, photoDataUrl, name, color } = profile || {};
    const lng = coords?.lng;
    const lat = coords?.lat;
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;

    // Create custom marker element
    const el = document.createElement('div');
    el.className = 'pp-marker';
    if (photoDataUrl) {
      const img = document.createElement('img');
      img.src = photoDataUrl;
      img.alt = name || 'me';
      el.appendChild(img);
    } else {
      el.style.background = color || '#444';
    }

    const marker = new mapboxgl.Marker({ element: el })
      .setLngLat([lng, lat])
      .addTo(mapRef.current);

    // Center on user and open popup on click
    let popup = null;
    const openPopup = () => {
      mapRef.current.flyTo({ center: [lng, lat], zoom: 15, essential: true });
      const html = `
        <div class="pp-popup">
          ${photoDataUrl ? `<img src="${photoDataUrl}" alt="avatar" />` : ''}
          <div>${name || 'Já'}</div>
        </div>`;
      if (popup) popup.remove();
      popup = new mapboxgl.Popup({ closeOnClick: true })
        .setLngLat([lng, lat])
        .setHTML(html)
        .addTo(mapRef.current);
    };
    el.addEventListener('click', openPopup);

    // initial gentle fly
    mapRef.current.flyTo({ center: [lng, lat], zoom: 13, essential: true });

    return () => {
      el.removeEventListener('click', openPopup);
      if (popup) popup.remove();
      marker.remove();
    };
  }, [mapReady, profile?.coords?.lat, profile?.coords?.lng, profile?.photoDataUrl, profile?.name, profile?.color]);

  return <div ref={mapContainer} style={{ position:'absolute', inset:0 }} />;
}
