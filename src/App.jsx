import React, { useEffect, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import Onboarding from './components/Onboarding.jsx';
import MapView from './components/MapView.jsx';
import { ensureUid, getLocalProfile, saveLocalProfile } from './lib/profile.js';

export default function App(){
  const [showSplash, setShowSplash] = useState(true);
  const [profile, setProfile] = useState(() => getLocalProfile());
  const consent = typeof window !== 'undefined' ? localStorage.getItem('pp_consent') === 'true' : false;

  useEffect(() => {
    const t = setTimeout(() => setShowSplash(false), 2000);
    return () => clearTimeout(t);
  }, []);

  function handleDone(p){
    const filled = ensureUid({ ...p });
    saveLocalProfile(filled);
    try { localStorage.setItem('pp_consent', 'true'); } catch {}
    setProfile(filled);
  }

  const needsOnboarding = !profile || !profile.coords || !consent;

  // Global click handler for self marker to open Popup
  useEffect(() => {
    const w = window;
    (w)._ppLastPopup && (w)._ppLastPopup.remove && (w)._ppLastPopup.remove();
    (w).ppOpenSelfPopup = (map, detail) => {
      try { w._ppLastPopup && w._ppLastPopup.remove && w._ppLastPopup.remove(); } catch {}
      const p = profile || {};
      const name = p.name || '';
      const photos = Array.isArray(p.photos) ? p.photos : (p.photoDataUrl ? [p.photoDataUrl] : []);
      const hasMany = photos.length > 1;
      const imgHtml = hasMany
        ? `<div class="pp-pop-rail">${photos.map(u=>`<img src="${u}"/>`).join('')}</div>`
        : (photos[0] ? `<img class="pp-pop-img" src="${photos[0]}"/>` : '');

      const html = `
        <div class="pp-popup">
          <div class="pp-pop-media">${imgHtml}</div>
          <div class="pp-pop-name">${name}</div>
          <button class="pp-pop-btn" id="ppPingBtn">Ping</button>
        </div>`;
      const popup = new mapboxgl.Popup({ anchor: 'bottom', closeOnClick: true, maxWidth: '360px' })
        .setLngLat([detail.lng, detail.lat])
        .setHTML(html)
        .addTo(map);
      (w)._ppLastPopup = popup;
      setTimeout(() => {
        const btn = document.getElementById('ppPingBtn');
        if (btn) btn.onclick = async (e) => {
          e.preventDefault();
          try {
            const anyW = window;
            if (typeof (anyW).spawnDevBot === 'function') { await (anyW).spawnDevBot(p?.uid || ''); return; }
          } catch {}
          alert('Ping!');
        };
      }, 0);
    };
    return () => { try { delete (w).ppOpenSelfPopup; } catch {} };
  }, [profile]);

  return (
    <div>
      {showSplash && <div className="pp-splash" aria-hidden="true" />}
      {!showSplash ? (
        needsOnboarding ? (
          <Onboarding onDone={handleDone} />
        ) : (
          <MapView
            profile={profile}
            onProfileChange={(p)=>{ saveLocalProfile(p); setProfile(p); }}
          />
        )
      ) : null}
    </div>
  );
}
