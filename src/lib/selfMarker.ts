import mapboxgl from 'mapbox-gl';

export type SelfMarkerOpts = {
  map: mapboxgl.Map;
  lng: number;
  lat: number;
  color?: string;        // gender color, default #ff4f93
  photoUrl?: string;     // data URL or http(s)
};

export function createSelfMarker({ map, lng, lat, color = '#ff4f93', photoUrl = '' }: SelfMarkerOpts) {
  // Root element
  const el = document.createElement('div');
  el.className = 'pp-pin';
  el.style.setProperty('--pp-pin', color);

  // Head (round) + avatar
  const head = document.createElement('div');
  head.className = 'pp-pin__head';

  const img = document.createElement('img');
  img.className = 'pp-pin__ava';
  img.alt = 'me';
  img.src = photoUrl;
  head.appendChild(img);
  el.appendChild(head);

  // Toggle 5× zoom on click
  const toggle = (e?: Event) => {
    if (e) e.stopPropagation();
    el.classList.toggle('is-open');
  };
  el.addEventListener('click', toggle);

  // ESC closes
  const onEsc = (e: KeyboardEvent) => { if ((e as any).key === 'Escape') el.classList.remove('is-open'); };
  window.addEventListener('keydown', onEsc);

  // offset: anchor the sharp tip exactly on the coord
  const TIP_PX = 16; // must match --pp-tip in CSS
  const marker = new mapboxgl.Marker({ element: el, offset: [0, -TIP_PX] as any })
    .setLngLat([lng, lat])
    .addTo(map);

  // Cleanup helper
  (marker as any).__destroy = () => {
    window.removeEventListener('keydown', onEsc);
    marker.remove();
  };

  return marker;
}

export default createSelfMarker;
