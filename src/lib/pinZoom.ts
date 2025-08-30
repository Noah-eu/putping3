import mapboxgl from 'mapbox-gl';

/**
 * Attaches single-click 5× zoom behavior to a teardrop pin element.
 * - On first click: adds `.is-zoom` (CSS handles transform: scale(5)).
 * - Click on map or ESC: removes `.is-zoom`.
 * - Ensures only one pin is zoomed at a time.
 */
export function attachPinZoom(
  el: HTMLElement,
  map: mapboxgl.Map,
  lngLat: [number, number]
) {
  const onClick = (ev: Event) => {
    ev.stopPropagation();
    // close any other zoomed pins
    document.querySelectorAll('.pp-tear.is-zoom').forEach((n) => n.classList.remove('is-zoom'));
    if (!el.classList.contains('is-zoom')) {
      el.classList.add('is-zoom');
      try {
        map.easeTo({ center: lngLat as any, zoom: Math.max(map.getZoom(), 15), duration: 600 });
      } catch {}
    }
  };

  const onMapClick = () => el.classList.remove('is-zoom');
  const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') el.classList.remove('is-zoom'); };

  el.addEventListener('click', onClick);
  map.on('click', onMapClick);
  window.addEventListener('keydown', onEsc);

  // return cleanup
  return () => {
    el.removeEventListener('click', onClick);
    try { map.off('click', onMapClick); } catch {}
    window.removeEventListener('keydown', onEsc);
  };
}

