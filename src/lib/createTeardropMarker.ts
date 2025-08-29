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

  // structure
  const bubble = document.createElement('div');
  bubble.className = 'pp-marker__bubble';

  const tail = document.createElement('div');
  tail.className = 'pp-marker__tail';

  const img = document.createElement('img');
  img.className = 'pp-marker__avatar';
  if (profile.photoDataUrl) img.src = profile.photoDataUrl;
  img.alt = profile.name || '';

  el.appendChild(bubble);
  el.appendChild(tail);
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
