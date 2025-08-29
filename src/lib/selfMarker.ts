//////////////////////////////////////////////////
import mapboxgl from "mapbox-gl";

export type SelfMarkerOpts = {
  map: mapboxgl.Map;
  lng: number;
  lat: number;
  photoUrl?: string | null;
  color?: string; // gender color
  onClick?: () => void;
};

let _marker: mapboxgl.Marker | null = null;

export function createTeardropEl({ color = "#ff66b3", photoUrl }: { color?: string; photoUrl?: string | null; }): HTMLElement {
  const root = document.createElement("div");
  root.className = "pp-tear";
  root.style.width = "44px";
  root.style.height = "58px";
  root.style.position = "relative";
  root.style.pointerEvents = "auto";

  // Inline SVG teardrop
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 44 58");
  svg.setAttribute("width", "44");
  svg.setAttribute("height", "58");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", color);
  path.setAttribute(
    "d",
    "M22 0 C34 0, 44 10, 44 22 C44 32, 28 46, 24 57 C23 59, 21 59, 20 57 C16 46, 0 32, 0 22 C0 10, 10 0, 22 0 Z"
  );
  svg.appendChild(path);
  root.appendChild(svg);

  // Photo overlay
  const ph = document.createElement("div");
  ph.className = "pp-photo";
  ph.style.position = "absolute";
  ph.style.left = "50%";
  ph.style.top = "14px";
  ph.style.width = "28px";
  ph.style.height = "28px";
  ph.style.borderRadius = "50%";
  ph.style.transform = "translateX(-50%)";
  ph.style.border = "2px solid #fff";
  ph.style.boxShadow = "0 2px 6px rgba(0,0,0,.25)";
  ph.style.backgroundSize = "cover";
  ph.style.backgroundPosition = "center";
  if (photoUrl) ph.style.backgroundImage = `url(${photoUrl})`;
  else ph.style.background = "#e5e7eb";
  root.appendChild(ph);

  return root;
}

export function upsertSelfMarker(opts: SelfMarkerOpts) {
  const { map, lng, lat, photoUrl, color = "#ff66b3", onClick } = opts;

  // Reuse one instance
  if (!_marker) {
    const root = createTeardropEl({ color, photoUrl });

    // Click → toggle zoom class + optional map zoom callback
    root.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick?.();
      // optional global handler to open a Popup with details
      try {
        const anyW: any = window as any;
        if (typeof anyW.ppOpenSelfPopup === 'function') {
          anyW.ppOpenSelfPopup(opts.map, { lng, lat });
        }
      } catch {}
    });

    _marker = new mapboxgl.Marker({ element: root, anchor: "bottom" })
      .setLngLat([lng, lat])
      .addTo(map);
  } else {
    _marker.setLngLat([lng, lat]);
    // update SVG fill and photo if changed
    const el = _marker.getElement();
    const path = el.querySelector('path') as SVGPathElement | null;
    if (path) path.setAttribute('fill', color);
    const ph = el.querySelector('.pp-photo') as HTMLElement | null;
    if (ph) {
      if (photoUrl) ph.style.backgroundImage = `url(${photoUrl})`;
    }
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
