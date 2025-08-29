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

  // Self marker (teardrop + swipeable popup)
  useEffect(() => {
    if (!mapReady || !mapRef.current || !p?.coords) return;
    const el = document.createElement('div');
    el.className = 'pp-marker-tear';
    el.style.setProperty('--pp-color', p.color || '#444');
    el.innerHTML = `<div class="img-wrap">${p.photoDataUrl ? `<img src="${p.photoDataUrl}" alt="${p.name || 'me'}" />` : ''}</div>`;
    const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
      .setLngLat([p.coords.lng, p.coords.lat])
      .addTo(mapRef.current);
    const onClick = () => {
      try { el.classList.add('pp-zoom'); } catch {}
      let gallery = [];
      try { gallery = JSON.parse(localStorage.getItem('pp_gallery') || '[]'); } catch {}
      const imgs = [p.photoDataUrl, ...gallery].filter(Boolean);
      const first = imgs[0] || '';
      const html = `
        <div class=\"pp-popup\">
          <div class=\"pp-swipe\">
            <img class=\"pp-swipe-img\" src=\"${first}\" alt=\"\" />
            <button class=\"pp-prev\" type=\"button\">‹</button>
            <button class=\"pp-next\" type=\"button\">›</button>
          </div>
          <div class=\"pp-name\">${p.name || ''}</div>
        </div>`;
      const popup = new mapboxgl.Popup()
        .setLngLat([p.coords.lng, p.coords.lat])
        .setHTML(html)
        .addTo(mapRef.current);
      try {
        const root = popup.getElement();
        const imgEl = root.querySelector('.pp-swipe-img');
        const prev = root.querySelector('.pp-prev');
        const next = root.querySelector('.pp-next');
        let idx = 0;
        const show = () => { if (imgEl && imgs[idx]) imgEl.src = imgs[idx]; };
        prev?.addEventListener('click', (e) => { e.stopPropagation(); idx = (idx - 1 + imgs.length) % imgs.length; show(); });
        next?.addEventListener('click', (e) => { e.stopPropagation(); idx = (idx + 1) % imgs.length; show(); });
        try { popup.on('close', () => el.classList.remove('pp-zoom')); } catch {}
      } catch {}
    };
    el.addEventListener('click', onClick);
    return () => { el.removeEventListener('click', onClick); marker.remove(); };
  }, [mapReady, p?.coords?.lat, p?.coords?.lng, p?.photoDataUrl, p?.name, p?.color]);

  return <div ref={mapContainer} style={{ position: 'absolute', inset: 0 }} />;
}
