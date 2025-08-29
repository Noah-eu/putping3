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

export function upsertSelfMarker(opts: SelfMarkerOpts) {
  const { map, lng, lat, photoUrl, color = "#ff66b3", onClick } = opts;

  // Reuse one instance
  if (!_marker) {
    const root = document.createElement("div");
    root.className = "pp-marker";         // ROOT: DO NOT animate or transform this one
    root.style.width = "0";
    root.style.height = "0";

    // Inner wrapper for visual/animation
    const inner = document.createElement("div");
    inner.className = "pp-marker__inner";  // animate THIS
    // HTML of teardrop + avatar
    inner.innerHTML = `
      <div class="pp-marker__teardrop" style="--pin:${color}"></div>
      <div class="pp-marker__avatar">
        ${photoUrl ? `<img src="${photoUrl}" alt="me" />` : ""}
      </div>
    `;
    root.appendChild(inner);

    // Click → toggle zoom class + optional map zoom callback
    root.addEventListener("click", (e) => {
      e.stopPropagation();
      inner.classList.toggle("is-zoom");
      onClick?.();
    });

    _marker = new mapboxgl.Marker({ element: root, anchor: "bottom" })
      .setLngLat([lng, lat])
      .addTo(map);
  } else {
    _marker.setLngLat([lng, lat]);
    // update avatar/color if changed
    const inner = _marker.getElement().querySelector(".pp-marker__inner") as HTMLElement;
    if (inner) {
      const pin = inner.querySelector(".pp-marker__teardrop") as HTMLElement | null;
      if (pin) pin.style.setProperty("--pin", color);
      const img = inner.querySelector(".pp-marker__avatar img") as HTMLImageElement | null;
      if (img && photoUrl) img.src = photoUrl;
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
