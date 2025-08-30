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
  let lastPinClickAt = 0;
  const PIN_CLICK_GUARD_MS = 350;

  const onPointerDown = () => { lastPinClickAt = Date.now(); };

  const onClick = (ev: Event) => {
    ev.stopPropagation();
    lastPinClickAt = Date.now();
    // close any other zoomed pins
    document.querySelectorAll('.pp-tear.is-zoom').forEach((n) => n.classList.remove('is-zoom'));
    if (!el.classList.contains('is-zoom')) {
      el.classList.add('is-zoom');
      // Do not change map zoom on pin click; only enlarge the pin.
    }
  };

  const onMapClick = () => {
    // Ignore the immediate map click that may follow a pin click
    if (Date.now() - lastPinClickAt < PIN_CLICK_GUARD_MS) return;
    el.classList.remove('is-zoom');
  };
  const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') el.classList.remove('is-zoom'); };

  el.addEventListener('pointerdown', onPointerDown, { passive: true });
  el.addEventListener('click', onClick);
  map.on('click', onMapClick);
  window.addEventListener('keydown', onEsc);

  // return cleanup
  return () => {
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('click', onClick);
    try { map.off('click', onMapClick); } catch {}
    window.removeEventListener('keydown', onEsc);
  };
}
