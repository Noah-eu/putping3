import React, { useEffect, useState } from 'react';
import Onboarding from './components/Onboarding.jsx';
import MapView from './components/MapView.jsx';
import ToolsFab from './components/ToolsFab.jsx';
import { ensureUid, getLocalProfile, saveLocalProfile } from './lib/profile.js';
import { db } from './firebase.js';
import { ref, onValue } from 'firebase/database';

export default function App(){
  const [showSplash, setShowSplash] = useState(true);
  const [profile, setProfile] = useState(() => getLocalProfile());
  const consent = typeof window !== 'undefined' ? localStorage.getItem('pp_consent') === 'true' : false;
  const [pulseUids, setPulseUids] = useState(new Set());

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

  // Subscribe to pairPings/<me> to know who pinged me (for pulsing markers)
  useEffect(() => {
    const meUid = profile?.auth?.uid;
    if (!meUid) return;
    const r = ref(db, `pairPings/${meUid}`);
    const unsubscribe = onValue(r, (snap) => {
      const uids = new Set();
      try {
        snap.forEach((child) => { if (child.key) uids.add(child.key); });
      } catch {}
      setPulseUids(uids);
    });
    return () => unsubscribe();
  }, [profile?.auth?.uid]);

  return (
    <div>
      {showSplash && <div className="pp-splash" aria-hidden="true" />}
      {!showSplash ? (
        needsOnboarding ? (
          <Onboarding onDone={handleDone} />
        ) : (
          <>
            <MapView
              profile={profile}
              pulseUids={pulseUids}
              onProfileChange={(p)=>{ saveLocalProfile(p); setProfile(p); }}
            />
            <ToolsFab />
          </>
        )
      ) : null}
    </div>
  );
}
