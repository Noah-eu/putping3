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
  <div class="pp-drop">
    <div class="pp-avatar"><img alt="avatar" src="${photoDataUrl || ''}"/></div>
  </div>`;
  return el;
}

export function upsertSelfMarker(opts: SelfMarkerOpts) {
  const { map, lng, lat, photoUrl, color = "#ff66b3", onClick } = opts;

  // Reuse one instance
  if (!_marker) {
    const root = buildUserMarkerEl({ name: opts.name, photoDataUrl: photoUrl || undefined, gender: opts.gender, color });

    // Click → delegate to caller for flyTo + ProfileCard
    root.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick?.();
    });

    _marker = new mapboxgl.Marker({ element: root, anchor: "bottom" })
      .setLngLat([lng, lat])
      .addTo(map);
  } else {
    _marker.setLngLat([lng, lat]);
    // update SVG fill and photo if changed
    const el = _marker.getElement() as HTMLElement;
    if (color) el.style.setProperty('--pin', color);
    const img = el.querySelector('.pp-pin__photo') as HTMLImageElement | null;
    if (img && photoUrl !== undefined) img.src = photoUrl || '';
    const av = el.querySelector('.pp-pin__panelAvatar') as HTMLImageElement | null;
    if (av && photoUrl !== undefined) av.src = photoUrl || '';
    const nm = el.querySelector('.pp-pin__panelName') as HTMLElement | null;
    if (nm && opts.name !== undefined) nm.textContent = opts.name || '';
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
