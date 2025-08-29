// src/lib/createTeardropMarker.ts
export type PPProfile = {
  uid?: string;
  name?: string;
  gender?: 'muž' | 'žena' | 'jine' | string;
  color?: string;           // gender color (fallback below)
  photoDataUrl?: string;    // data:image/... for avatar
};

const genderColor: Record<string, string> = {
  'muž': '#5ea0ff',
  'žena': '#ff5ea8',
  'jine': '#8b5eff',
};

export function createTeardropMarkerEl(profile: PPProfile): HTMLElement {
  const el = document.createElement('div');
  el.className = 'pp-marker';
  el.dataset.uid = profile.uid || '';
  const color = profile.color || genderColor[profile.gender || ''] || '#ff5ea8';
  el.style.setProperty('--pp-color', color);

  // structure – unified SVG teardrop with outline
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 64 88');
  svg.setAttribute('width', '44');
  svg.setAttribute('height', '58');
  svg.classList.add('pp-tear');
  // color via currentColor to allow CSS variable
  (svg as any).style = `color: var(--pp-color)`;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  // Teardrop path: smooth circle head + pointed tail
  path.setAttribute('d', 'M32 2 C49 2 62 15 62 32 C62 56 32 86 32 86 C32 86 2 56 2 32 C2 15 15 2 32 2 Z');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('stroke', '#111');
  path.setAttribute('stroke-width', '4');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  svg.appendChild(path);

  const img = document.createElement('img');
  img.className = 'pp-marker__avatar';
  if (profile.photoDataUrl) img.src = profile.photoDataUrl;
  img.alt = profile.name || '';

  el.appendChild(svg);
  el.appendChild(img);

  // toggle zoom on click
  el.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const already = el.classList.contains('pp-marker--zoomed');
    (document.querySelectorAll('.pp-marker--zoomed') as NodeListOf<HTMLElement>)
      .forEach((n) => n.classList.remove('pp-marker--zoomed'));
    if (!already) el.classList.add('pp-marker--zoomed');
    // bubble an event for app logic if needed
    el.dispatchEvent(new CustomEvent('pp:marker:toggle', { bubbles: true, detail: { uid: profile.uid, zoomed: !already }}));
  });

  return el;
}

// utility to close all (call from map click)
export function closeAllTeardrops() {
  (document.querySelectorAll('.pp-marker--zoomed') as NodeListOf<HTMLElement>)
    .forEach((n) => n.classList.remove('pp-marker--zoomed'));
}
