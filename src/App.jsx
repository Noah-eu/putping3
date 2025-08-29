import React, { useEffect, useState } from 'react';
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

