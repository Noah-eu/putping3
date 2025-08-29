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
  el.className = 'pp-pin';
  const g = gender || 'muz';
  const c = color || (g === 'zena' ? '#66a3ff' : g === 'jine' ? '#44c776' : '#ff66b3');
  el.style.setProperty('--pin', c);

  el.innerHTML = `
    <div class="pp-pin__tear">
      <div class="pp-pin__photoWrap">
        <img class="pp-pin__photo" src="${photoDataUrl || ''}" alt="" />
      </div>
    </div>
    <div class="pp-pin__panel">
      <div class="pp-pin__panelHead">
        <img class="pp-pin__panelAvatar" src="${photoDataUrl || ''}" alt="" />
      </div>
      <div class="pp-pin__panelName">${name || ''}</div>
      <button class="pp-pin__pingBtn" type="button">Ping</button>
    </div>
  `;
  return el;
}

export function upsertSelfMarker(opts: SelfMarkerOpts) {
  const { map, lng, lat, photoUrl, color = "#ff66b3", onClick } = opts;

  // Reuse one instance
  if (!_marker) {
    const root = buildUserMarkerEl({ name: opts.name, photoDataUrl: photoUrl || undefined, gender: opts.gender, color });

    // Click → toggle zoom class + optional map zoom callback
    root.addEventListener("click", (e) => {
      e.stopPropagation();
      // flyTo; open panel after move ends
      onClick?.();
      const open = () => { try { root.classList.add('is-open'); } catch {} opts.map.off('moveend', open); };
      opts.map.on('moveend', open);
    });

    // close on map click when clicking outside the pin
    const onMapClick = (ev: any) => {
      const target = ev?.originalEvent?.target as Node | null;
      if (!target) return;
      if (!(root.contains(target))) {
        try { root.classList.remove('is-open'); } catch {}
      }
    };
    opts.map.on('click', onMapClick);

    // ESC closes
    const onKey = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { try { root.classList.remove('is-open'); } catch {} } };
    window.addEventListener('keydown', onKey);

    // Ping button hook
    const btn = root.querySelector('.pp-pin__pingBtn') as HTMLButtonElement | null;
    if (btn) btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      try { const w: any = window as any; if (typeof w.ppPing === 'function') w.ppPing({ name: opts.name, lng, lat }); else alert('Ping!'); } catch { alert('Ping!'); }
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
