import mapboxgl from "mapbox-gl";

export type PPProfile = {
  name?: string;
  gender?: "muž" | "žena" | "jine" | string;
  color?: string | null;
  photoDataUrl?: string | null;
  coords?: { lat: number; lng: number } | null;
};

let __selfMarker: mapboxgl.Marker | null = null;

export function getLocalProfile(): PPProfile|null {
  try { return JSON.parse(localStorage.getItem("pp_profile")||"null"); }
  catch { return null; }
}

function genderColor(p: PPProfile): string {
  if (p.color) return p.color as string;
  if (p.gender === "žena") return "#ff66b3";   // růžová
  if (p.gender === "muž") return "#66b3ff";    // modrá
  return "#2ecc71";                            // zelená (jiné)
}

function initials(name?: string) {
  if (!name) return "";
  const parts = name.trim().split(/\s+/);
  const s = (parts[0]?.[0]||"") + (parts[1]?.[0]||"");
  return s.toUpperCase();
}

export function makeTearElement(p: PPProfile): HTMLDivElement {
  const el = document.createElement("div");
  el.id = "pp-self-marker";
  el.className = "pp-marker-tear";
  el.style.setProperty("--pp-color", genderColor(p));
  el.innerHTML =
    `<div class="img-wrap">${
        p.photoDataUrl
          ? `<img src="${p.photoDataUrl}" alt="${p.name||''}"/>`
          : `<div class="noimg">${initials(p.name)||"ME"}</div>`
      }</div>`;
  return el;
}

export function openSelfPopup(map: mapboxgl.Map, p: PPProfile) {
  if (!p.coords) return;
  const html = `
    <div class="pp-popup">
      <div class="pp-popup-img">${
        p.photoDataUrl ? `<img src="${p.photoDataUrl}" alt="${p.name||''}"/>` : ""
      }</div>
      <div class="pp-popup-name">${p.name || ""}</div>
    </div>`;
  new mapboxgl.Popup({ closeOnClick: true, maxWidth: "440px" })
    .setLngLat([p.coords!.lng, p.coords!.lat])
    .setHTML(html)
    .addTo(map);
  map.flyTo({ center:[p.coords!.lng, p.coords!.lat], zoom:15, essential:true });
}

/** Create/refresh the single self marker (teardrop) and attach click popup */
export function renderSelfMarker(map: mapboxgl.Map) {
  const p = getLocalProfile();
  if (!p?.coords) return;

  // kill previous instance/DOM to avoid duplicates
  try { document.getElementById("pp-self-marker")?.remove(); } catch {}
  if (__selfMarker) { try { __selfMarker.remove(); } catch {} __selfMarker = null; }

  const el = makeTearElement(p);
  __selfMarker = new mapboxgl.Marker({ element: el, anchor: "bottom" })
    .setLngLat([p.coords.lng, p.coords.lat])
    .addTo(map);

  el.addEventListener("click", () => openSelfPopup(map, p));

  // Fly to marker and do a short class-based scale animation on click
  try {
    const elem = __selfMarker.getElement() as HTMLElement;
    elem.addEventListener("click", () => {
      try {
        elem.classList.add("pp-grow");
      } catch {}
      try {
        map.flyTo({ center: [p.coords!.lng, p.coords!.lat], zoom: 15, speed: 1.2, essential: true });
      } catch {}
      setTimeout(() => {
        try { elem.classList.remove("pp-grow"); } catch {}
      }, 400);
    });
  } catch {}
}
