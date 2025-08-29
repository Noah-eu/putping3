//////////////////////////////////////////////////
import mapboxgl from "mapbox-gl";

export type SelfMarkerOpts = {
  map: mapboxgl.Map;
  lng: number;
  lat: number;
  photoUrl?: string | null;
  color?: string; // gender color
  onClick?: () => void;
  name?: string;
  gender?: string; // 'muz' | 'zena' | 'jine'
};

let _marker: mapboxgl.Marker | null = null;

export function buildUserMarkerEl({ name, photoDataUrl, gender = 'muz', color }: { name?: string; photoDataUrl?: string | null; gender?: string; color?: string; }): HTMLElement {
  const el = document.createElement('div');
  const g = gender || 'muz';
  el.className = `pp-marker ${g}`;
  if (color) el.style.setProperty('--pp-color', color);
  el.innerHTML = `
    <div class="pp-marker__inner">
      <div class="pp-drop"></div>
      <div class="pp-avatar"><img alt="avatar" src="${photoDataUrl || ''}"/></div>
    </div>`;
  return el;
}

export function upsertSelfMarker(opts: SelfMarkerOpts) {
  const { map, lng, lat, photoUrl, color = "#ff66b3", onClick } = opts;

  // Reuse one instance
  if (!_marker) {
    const root = buildUserMarkerEl({ name: opts.name, photoDataUrl: photoUrl || undefined, gender: opts.gender, color });

    // Click → delegate flyTo to caller; then add zoom class after moveend
    root.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick?.();
      const open = () => { try { root.classList.add('is-zoom5'); } catch {} opts.map.off('moveend', open); };
      opts.map.on('moveend', open);
    });

    // Close zoom on map click outside or ESC
    const onMapClick = (ev: any) => {
      const t = ev?.originalEvent?.target as Node | null;
      if (!t) return;
      if (!root.contains(t)) { try { root.classList.remove('is-zoom5'); } catch {} }
    };
    opts.map.on('click', onMapClick);
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { try { root.classList.remove('is-zoom5'); } catch {} } };
    window.addEventListener('keydown', onKey);

    _marker = new mapboxgl.Marker({ element: root, anchor: "bottom" })
      .setLngLat([lng, lat])
      .addTo(map);
  } else {
    _marker.setLngLat([lng, lat]);
    // update color and photo if changed
    const el = _marker.getElement() as HTMLElement;
    if (color) el.style.setProperty('--pp-color', color);
    const img = el.querySelector('.pp-avatar img') as HTMLImageElement | null;
    if (img && photoUrl !== undefined) img.src = photoUrl || '';
  }

  return _marker!;
}

export function removeSelfMarker() {
  if (_marker) {
    _marker.remove();
    _marker = null;
  }
}
//////////////////////////////////////////////////
