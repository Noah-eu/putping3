// src/App.jsx - KOMPLETNÍ VERZE se všemi funkcemi
import React, { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { signInAnonymously, onAuthStateChanged, getRedirectResult, signOut, GoogleAuthProvider, signInWithRedirect } from "firebase/auth";
import { ref, set, update, onValue, remove, push, get, serverTimestamp } from "firebase/database";
import { ref as sref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, auth, storage } from "./firebase.js";

// ===== KONFIGURACE =====
mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;
const ONLINE_TTL_MS = 10 * 60_000; // 10 minut
const PING_COOLDOWN_MS = 2 * 60 * 60_000; // 2 hodiny

// ===== POMOCNÉ FUNKCE =====
function pairIdOf(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function getGenderColor(gender) {
  const g = String(gender || '').toLowerCase();
  if (g.includes('m') || g === 'muz' || g === 'muž') return '#EC4899'; // růžová pro muže
  if (g.includes('f') || g.includes('ž') || g === 'zena' || g === 'žena') return '#3B82F6'; // modrá pro ženy
  return '#10B981'; // zelená pro ostatní
}

function canPing(viewer = {}, target = {}, lastPingTime = null) {
  // Cooldown check
  if (lastPingTime && Date.now() - lastPingTime < PING_COOLDOWN_MS) {
    return false;
  }

  const prefs = target.pingPrefs || { gender: 'any', minAge: 16, maxAge: 100 };
  
  // Gender filter
  const viewerGender = String(viewer.gender || '').toLowerCase();
  if (prefs.gender === 'm' && !viewerGender.includes('m')) return false;
  if (prefs.gender === 'f' && (!viewerGender.includes('f') && !viewerGender.includes('ž'))) return false;
  
  // Age filter
  const age = Number(viewer.age);
  if (Number.isFinite(age)) {
    if (age < (prefs.minAge || 16)) return false;
    if (age > (prefs.maxAge || 100)) return false;
  }
  
  return true;
}

async function compressImage(file, maxDim = 800, quality = 0.8) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const ratio = Math.min(maxDim / Math.max(img.width, img.height), 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * ratio);
      canvas.height = Math.round(img.height * ratio);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

// ===== ONBOARDING KOMPONENT =====
function Onboarding({ onComplete }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [gender, setGender] = useState('');
  const [coords, setCoords] = useState(null);

  const askLocation = () => {
    if (!navigator.geolocation) {
      alert('Geolokace není podporována');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setStep(3);
      },
      () => alert('Nepodařilo se získat polohu. Prosím povol geolokaci v nastavení prohlížeče.'),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const finish = () => {
    if (!name.trim()) return alert('Zadej jméno');
    if (!gender) return alert('Vyber pohlaví');
    if (!coords) return alert('Povol polohu');
    
    const profile = {
      name: name.trim(),
      age: age ? Number(age) : null,
      gender,
      coords,
      color: getGenderColor(gender),
      completed: true,
      pingPrefs: { gender: 'any', minAge: 16, maxAge: 100 }
    };
    localStorage.setItem('pp_onboarded', '1');
    localStorage.setItem('pp_profile', JSON.stringify(profile));
    onComplete(profile);
  };

  const btnStyle = (active) => ({
    flex: 1,
    padding: 12,
    borderRadius: 10,
    border: active ? 'none' : '1px solid #ddd',
    background: active ? getGenderColor(active) : '#fff',
    color: active ? '#fff' : '#000',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
    transition: 'all 0.2s'
  });

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}>
      <div style={{ width: 'min(420px, 92vw)', background: '#fff', borderRadius: 16, padding: 24, boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        {step === 1 && (
          <>
            <h2 style={{ marginBottom: 8, fontSize: 24 }}>Vítej v PutPing! 📍</h2>
            <p style={{ color: '#666', marginBottom: 24 }}>Aplikace k setkávání lidí v okolí na základě mapy</p>
            <button
              onClick={() => setStep(2)}
              style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none', background: '#111', color: '#fff', cursor: 'pointer', fontSize: 16, fontWeight: 600 }}
            >
              Začít
            </button>
          </>
        )}
        
        {step === 2 && (
          <>
            <h3 style={{ marginBottom: 16 }}>Základní údaje</h3>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Tvoje jméno"
              style={{ width: '100%', padding: 12, marginBottom: 12, borderRadius: 10, border: '1px solid #ddd', fontSize: 15 }}
            />
            <input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="Věk (volitelné)"
              min="16"
              max="100"
              style={{ width: '100%', padding: 12, marginBottom: 16, borderRadius: 10, border: '1px solid #ddd', fontSize: 15 }}
            />
            <p style={{ fontSize: 14, color: '#666', marginBottom: 8 }}>Pohlaví</p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
              <button onClick={() => setGender('m')} style={btnStyle(gender === 'm' ? 'm' : null)}>Muž</button>
              <button onClick={() => setGender('f')} style={btnStyle(gender === 'f' ? 'f' : null)}>Žena</button>
              <button onClick={() => setGender('x')} style={btnStyle(gender === 'x' ? 'x' : null)}>Jiné</button>
            </div>
            <button
              onClick={askLocation}
              disabled={!name || !gender}
              style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none', background: (!name || !gender) ? '#ccc' : '#111', color: '#fff', cursor: (!name || !gender) ? 'not-allowed' : 'pointer', fontSize: 16, fontWeight: 600 }}
            >
              Povolit polohu
            </button>
          </>
        )}
        
        {step === 3 && (
          <>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
              <h3 style={{ marginBottom: 8 }}>Vše je připraveno!</h3>
            </div>
            <div style={{ background: '#f9fafb', padding: 16, borderRadius: 10, marginBottom: 20 }}>
              <p style={{ margin: '8px 0' }}><strong>Jméno:</strong> {name}</p>
              {age && <p style={{ margin: '8px 0' }}><strong>Věk:</strong> {age}</p>}
              <p style={{ margin: '8px 0' }}><strong>Poloha:</strong> Povolena</p>
            </div>
            <button
              onClick={finish}
              style={{ width: '100%', padding: 14, borderRadius: 10, border: 'none', background: '#111', color: '#fff', cursor: 'pointer', fontSize: 16, fontWeight: 600 }}
            >
              Do aplikace
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ===== HLAVNÍ APLIKACE =====
export default function App() {
  // State
  const [profile, setProfile] = useState(null);
  const [me, setMe] = useState(null);
  const [map, setMap] = useState(null);
  const [users, setUsers] = useState({});
  const [openBubble, setOpenBubble] = useState(null);
  const [selectedPhotoIdx, setSelectedPhotoIdx] = useState({});
  const [openChat, setOpenChat] = useState(null);
  const [chatMsgs, setChatMsgs] = useState([]);
  const [chatText, setChatText] = useState('');
  const [pairPings, setPairPings] = useState({});
  const [chatPairs, setChatPairs] = useState({});
  const [lastPingTimes, setLastPingTimes] = useState({});
  const [showGallery, setShowGallery] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showChats, setShowChats] = useState(false);
  const [fabOpen, setFabOpen] = useState(false);
  
  // Refs
  const markersRef = useRef({});
  const chatBoxRef = useRef(null);

  // Init profilu z localStorage
  useEffect(() => {
    const saved = localStorage.getItem('pp_profile');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.completed) {
          setProfile(parsed);
        }
      } catch {}
    }
  }, []);

  // Auth - anonymní přihlášení
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        const cred = await signInAnonymously(auth);
        user = cred.user;
      }
      
      const userData = {
        uid: user.uid,
        name: profile?.name || 'Anonym',
        age: profile?.age || null,
        gender: profile?.gender || null,
        photos: [],
        pingPrefs: profile?.pingPrefs || { gender: 'any', minAge: 16, maxAge: 100 }
      };
      
      setMe(userData);
      
      // Sync do Firebase
      if (profile?.name) {
        update(ref(db, `users/${user.uid}`), {
          name: profile.name,
          age: profile.age || null,
          gender: profile.gender,
          online: true,
          lastActive: Date.now(),
          pingPrefs: profile.pingPrefs || { gender: 'any', minAge: 16, maxAge: 100 }
        });
      }
    });
    return () => unsub();
  }, [profile]);

  // Sledování polohy
  useEffect(() => {
    if (!me?.uid || !profile?.coords) return;
    
    const opts = { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 };
    const updatePos = (pos) => {
      const { latitude, longitude } = pos.coords;
      update(ref(db, `users/${me.uid}`), {
        lat: latitude,
        lng: longitude,
        online: true,
        lastActive: Date.now()
      });
      
      // Update můj marker
      if (markersRef.current[me.uid]) {
        markersRef.current[me.uid].setLngLat([longitude, latitude]);
        map?.setCenter([longitude, latitude]);
      }
    };

    navigator.geolocation.getCurrentPosition(updatePos, console.warn, opts);
    const watchId = navigator.geolocation.watchPosition(updatePos, console.warn, opts);
    return () => navigator.geolocation.clearWatch(watchId);
  }, [me, profile, map]);

  // Init mapy
  useEffect(() => {
    if (map || !profile?.coords) return;

    const m = new mapboxgl.Map({
      container: "map",
      style: "mapbox://styles/mapbox/streets-v12",
      center: [profile.coords.lng, profile.coords.lat],
      zoom: 14
    });

    m.on('load', () => {
      setMap(m);
      m.on('click', () => setOpenBubble(null));
    });

    return () => m.remove();
  }, [profile]);

  // Sledování uživatelů a vytváření markerů
  useEffect(() => {
    if (!map || !me?.uid) return;

    const unsub = onValue(ref(db, "users"), (snap) => {
      const data = snap.val() || {};
      setUsers(data);

      Object.entries(data).forEach(([uid, u]) => {
        const isMe = uid === me.uid;
        const isOnline = u.online && u.lastActive && (Date.now() - u.lastActive < ONLINE_TTL_MS);
        
        // Odstranit offline markery
        if (!isMe && (!isOnline || !u.lat || !u.lng)) {
          if (markersRef.current[uid]) {
            markersRef.current[uid].remove();
            delete markersRef.current[uid];
          }
          return;
        }

        // Vytvořit nebo aktualizovat marker
        if (u.lat && u.lng) {
          if (!markersRef.current[uid]) {
            // Nový marker
            const el = document.createElement('div');
            el.style.width = '32px';
            el.style.height = '44px';
            el.style.backgroundSize = 'cover';
            el.style.backgroundPosition = 'center';
            el.style.clipPath = "path('M16 0C24.8 0 32 7.2 32 16C32 29.2 16 44 16 44C16 44 0 29.2 0 16C0 7.2 7.2 0 16 0Z')";
            el.style.boxShadow = '0 0 0 2px #fff, 0 0 0 4px rgba(0,0,0,.15)';
            el.style.cursor = 'pointer';
            el.style.transition = 'transform 0.2s';
            
            const photos = Array.isArray(u.photos) ? u.photos : [];
            if (photos.length > 0) {
              el.style.backgroundImage = `url(${photos[0]})`;
            } else {
              el.style.backgroundColor = isMe ? '#EF4444' : getGenderColor(u.gender);
            }

            el.addEventListener('click', (e) => {
              e.stopPropagation();
              setOpenBubble(uid);
            });

            const marker = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
              .setLngLat([u.lng, u.lat])
              .addTo(map);

            markersRef.current[uid] = marker;
          } else {
            // Aktualizovat pozici
            markersRef.current[uid].setLngLat([u.lng, u.lat]);
            
            // Aktualizovat fotku
            const el = markersRef.current[uid].getElement();
            const photos = Array.isArray(u.photos) ? u.photos : [];
            const idx = selectedPhotoIdx[uid] || 0;
            if (photos.length > 0 && photos[idx]) {
              el.style.backgroundImage = `url(${photos[idx]})`;
            }
          }
        }
      });

      // Odstranit markery smazaných uživatelů
      Object.keys(markersRef.current).forEach((uid) => {
        if (!data[uid]) {
          markersRef.current[uid].remove();
          delete markersRef.current[uid];
        }
      });
    });

    return () => unsub();
  }, [map, me, selectedPhotoIdx]);

  // Ping systém - sledování
  useEffect(() => {
    if (!me?.uid) return;
    
    // Poslech příchozích pingů
    const unsub = onValue(ref(db, `pings/${me.uid}`), (snap) => {
      const data = snap.val();
      if (data) {
        Object.keys(data).forEach(fromUid => {
          new Audio('/ping.mp3').play().catch(() => {});
          remove(ref(db, `pings/${me.uid}/${fromUid}`));
        });
      }
    });
    return () => unsub();
  }, [me]);

  // Sledování pairPings
  useEffect(() => {
    if (!me?.uid) return;
    const unsub = onValue(ref(db, "pairPings"), (snap) => {
      const data = snap.val() || {};
      setPairPings(data);
      
      // Auto-create chat pairs
      Object.entries(data).forEach(([pid, obj]) => {
        const uids = Object.keys(obj || {});
        if (uids.length >= 2) {
          set(ref(db, `pairs/${pid}`), true);
        }
      });
    });
    return () => unsub();
  }, [me]);

  // Sledování chatPairs
  useEffect(() => {
    if (!me?.uid) return;
    const unsub = onValue(ref(db, "pairs"), (snap) => {
      const data = snap.val() || {};
      setChatPairs(data);
    });
    return () => unsub();
  }, [me]);

  // Chat zprávy
  useEffect(() => {
    if (!openChat || !me?.uid) {
      setChatMsgs([]);
      return;
    }
    
    const pid = pairIdOf(me.uid, openChat);
    const unsub = onValue(ref(db, `messages/${pid}`), (snap) => {
      const data = snap.val() || {};
      const arr = Object.entries(data)
        .map(([id, m]) => ({ id, ...m }))
        .sort((a, b) => (a.time || 0) - (b.time || 0));
      setChatMsgs(arr);
      
      // Scroll to bottom
      setTimeout(() => {
        if (chatBoxRef.current) {
          chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
        }
      }, 100);
    });
    return () => unsub();
  }, [openChat, me]);

  // ===== AKCE =====
  const sendPing = async (toUid) => {
    if (!me?.uid) return;
    
    const pid = pairIdOf(me.uid, toUid);
    const lastTime = lastPingTimes[toUid];
    
    if (!canPing(users[me.uid], users[toUid], lastTime)) {
      alert('Můžeš pingovat znovu až za 2 hodiny, nebo uživatel nesplňuje tvé filtry.');
      return;
    }
    
    await set(ref(db, `pings/${toUid}/${me.uid}`), Date.now());
    await set(ref(db, `pairPings/${pid}/${me.uid}`), Date.now());
    
    setLastPingTimes(prev => ({ ...prev, [toUid]: Date.now() }));
    new Audio('/ping.mp3').play().catch(() => {});
    
    setOpenBubble(null);
  };

  const sendMessage = async () => {
    if (!chatText.trim() || !me?.uid || !openChat) return;
    const pid = pairIdOf(me.uid, openChat);
    await push(ref(db, `messages/${pid}`), {
      from: me.uid,
      to: openChat,
      text: chatText.trim(),
      time: Date.now()
    });
    setChatText('');
  };

  const uploadPhotos = async (files) => {
    if (!me?.uid) return;
    const existing = users[me.uid]?.photos || [];
    const allowed = Math.max(0, 9 - existing.length);
    const selected = Array.from(files).slice(0, allowed);
    
    const urls = [...existing];
    for (let i = 0; i < selected.length; i++) {
      const compressed = await compressImage(selected[i], 1200, 0.85);
      const dest = sref(storage, `userPhotos/${me.uid}/${Date.now()}_${i}.jpg`);
      await uploadBytes(dest, compressed);
      const url = await getDownloadURL(dest);
      urls.push(url);
    }
    
    await update(ref(db, `users/${me.uid}`), {
      photos: urls,
      photoURL: urls[0] || null
    });
    
    alert(`Nahráno ${selected.length} fotek`);
  };

  const deletePhoto = async (idx) => {
    if (!me?.uid) return;
    const photos = [...(users[me.uid]?.photos || [])];
    photos.splice(idx, 1);
    await update(ref(db, `users/${me.uid}`), {
      photos,
      photoURL: photos[0] || null
    });
  };

  const updateSettings = async (data) => {
    if (!me?.uid) return;
    await update(ref(db, `users/${me.uid}`), {
      ...data,
      lastActive: Date.now()
    });
    
    // Update profile v localStorage
    const newProfile = { ...profile, ...data };
    localStorage.setItem('pp_profile', JSON.stringify(newProfile));
    setProfile(newProfile);
  };

  // ===== RENDER =====
  if (!profile?.completed) {
    return <Onboarding onComplete={(p) => setProfile(p)} />;
  }

  const currentUser = users[me?.uid] || {};
  const myPhotos = Array.isArray(currentUser.photos) ? currentUser.photos : [];

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative', overflow: 'hidden' }}>
      <div id="map" style={{ width: '100%', height: '100%' }} />

      {/* BUBLINA s fotkami a swipe */}
      {openBubble && users[openBubble] && (
        <div
          onClick={(e) => e.target === e.currentTarget && setOpenBubble(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ width: 'min(360px, 90vw)', background: '#fff', borderRadius: 20, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
          >
            {/* Galerie s horizontálním swipe */}
            <div
              style={{
                display: 'flex',
                overflowX: 'auto',
                scrollSnapType: 'x mandatory',
                scrollBehavior: 'smooth',
                WebkitOverflowScrolling: 'touch'
              }}
              onScroll={(e) => {
                const idx = Math.round(e.target.scrollLeft / e.target.offsetWidth);
                setSelectedPhotoIdx(prev => ({ ...prev, [openBubble]: idx }));
              }}
            >
              {(() => {
                const photos = Array.isArray(users[openBubble].photos) ? users[openBubble].photos : [];
                if (photos.length === 0) {
                  return (
                    <div style={{ minWidth: '100%', height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f4f6', scrollSnapAlign: 'start' }}>
                      <span style={{ fontSize: 48 }}>👤</span>
                    </div>
                  );
                }
                return photos.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt=""
                    style={{ minWidth: '100%', height: 280, objectFit: 'cover', scrollSnapAlign: 'start' }}
                  />
                ));
              })()}
            </div>

            {/* Info */}
            <div style={{ padding: 20 }}>
              <h3 style={{ margin: '0 0 8px 0', fontSize: 20 }}>
                {users[openBubble].name}
                {users[openBubble].age && `, ${users[openBubble].age}`}
              </h3>
              
              {/* Tlačítka */}
              {openBubble !== me?.uid && (
                <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                  {(() => {
                    const pid = pairIdOf(me.uid, openBubble);
                    const pair = pairPings[pid] || {};
                    const canChat = (pair[me.uid] && pair[openBubble]) || chatPairs[pid];
                    
                    return (
                      <>
                        <button
                          onClick={() => sendPing(openBubble)}
                          style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#EC4899', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 15 }}
                        >
                          📍 Ping
                        </button>
                        {canChat && (
                          <button
                            onClick={() => { setOpenChat(openBubble); setOpenBubble(null); }}
                            style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#3B82F6', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 15 }}
                          >
                            💬 Chat
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* CHAT okno */}
      {openChat && (
        <div style={{ position: 'fixed', bottom: 20, right: 20, width: 'min(380px, calc(100vw - 40px))', maxHeight: 'min(70vh, 600px)', background: '#fff', borderRadius: 16, boxShadow: '0 10px 40px rgba(0,0,0,0.3)', display: 'flex', flexDirection: 'column', zIndex: 2100 }}>
          <div style={{ padding: 14, borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong style={{ fontSize: 16 }}>{users[openChat]?.name || 'Chat'}</strong>
            <button onClick={() => setOpenChat(null)} style={{ border: 'none', background: 'transparent', fontSize: 24, cursor: 'pointer', lineHeight: 1 }}>×</button>
          </div>
          <div ref={chatBoxRef} style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {chatMsgs.map(m => (
              <div key={m.id} style={{ alignSelf: m.from === me.uid ? 'flex-end' : 'flex-start', maxWidth: '75%' }}>
                <div style={{ padding: '10px 12px', borderRadius: 12, background: m.from === me.uid ? '#e6f2ff' : '#f3f4f6', fontSize: 14, lineHeight: 1.4 }}>
                  {m.text}
                </div>
                <div style={{ fontSize: 11, color: '#999', marginTop: 4, textAlign: m.from === me.uid ? 'right' : 'left' }}>
                  {new Date(m.time).toLocaleTimeString('cs-CZ', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
          <div style={{ padding: 12, borderTop: '1px solid #eee', display: 'flex', gap: 8 }}>
            <input
              value={chatText}
              onChange={(e) => setChatText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Napiš zprávu..."
              style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }}
            />
            <button onClick={sendMessage} style={{ padding: '10px 16px', borderRadius: 8, border: 'none', background: '#111', color: '#fff', cursor: 'pointer', fontSize: 18 }}>
              ➤
            </button>
          </div>
        </div>
      )}

      {/* FAB MENU */}
      <div style={{ position: 'fixed', bottom: 20, right: 20, zIndex: 1500 }}>
        {fabOpen && (
          <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-end' }}>
            <button
              onClick={() => { setShowGallery(true); setFabOpen(false); }}
              style={{ padding: '12px 20px', borderRadius: 20, border: 'none', background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              🖼️ Galerie
            </button>
            <button
              onClick={() => { setShowChats(true); setFabOpen(false); }}
              style={{ padding: '12px 20px', borderRadius: 20, border: 'none', background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              💬 Chaty
            </button>
            <button
              onClick={() => { setShowSettings(true); setFabOpen(false); }}
              style={{ padding: '12px 20px', borderRadius: 20, border: 'none', background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}
            >
              ⚙️ Nastavení
            </button>
          </div>
        )}
        <button
          onClick={() => setFabOpen(!fabOpen)}
          style={{ width: 56, height: 56, borderRadius: 28, border: 'none', background: '#111', color: '#fff', fontSize: 24, cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'transform 0.2s' }}
        >
          {fabOpen ? '✕' : '☰'}
        </button>
      </div>

      {/* GALERIE modal */}
      {showGallery && (
        <div
          onClick={(e) => e.target === e.currentTarget && setShowGallery(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(480px, 100%)', maxHeight: '80vh', background: '#fff', borderRadius: 16, padding: 24, overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>Moje fotky ({myPhotos.length}/9)</h3>
              <button onClick={() => setShowGallery(false)} style={{ border: 'none', background: 'transparent', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>
            
            <input
              id="photoUpload"
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => uploadPhotos(e.target.files).then(() => e.target.value = '')}
              style={{ display: 'none' }}
            />
            
            {myPhotos.length < 9 && (
              <button
                onClick={() => document.getElementById('photoUpload').click()}
                style={{ width: '100%', padding: 14, marginBottom: 20, borderRadius: 10, border: '2px dashed #ddd', background: '#f9fafb', cursor: 'pointer', fontSize: 15, fontWeight: 600 }}
              >
                📷 Přidat fotky
              </button>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {myPhotos.map((url, i) => (
                <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 12, overflow: 'hidden' }}>
                  <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  <button
                    onClick={() => window.confirm('Smazat tuto fotku?') && deletePhoto(i)}
                    style={{ position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: 14, border: 'none', background: 'rgba(0,0,0,0.6)', color: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
                  >
                    ×
                  </button>
                  {i === 0 && (
                    <div style={{ position: 'absolute', bottom: 6, left: 6, padding: '4px 8px', borderRadius: 6, background: 'rgba(0,0,0,0.6)', color: '#fff', fontSize: 11, fontWeight: 600 }}>
                      Hlavní
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* CHATY modal */}
      {showChats && (
        <div
          onClick={(e) => e.target === e.currentTarget && setShowChats(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(400px, 100%)', maxHeight: '80vh', background: '#fff', borderRadius: 16, padding: 24, overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>Aktivní chaty</h3>
              <button onClick={() => setShowChats(false)} style={{ border: 'none', background: 'transparent', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>
            
            {Object.keys(chatPairs).length === 0 && (
              <p style={{ textAlign: 'center', color: '#999', padding: 40 }}>Zatím žádné chaty</p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Object.keys(chatPairs).map((pid) => {
                const [a, b] = pid.split('_');
                const otherUid = a === me.uid ? b : a;
                const u = users[otherUid];
                if (!u) return null;
                
                return (
                  <div
                    key={pid}
                    onClick={() => { setOpenChat(otherUid); setShowChats(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, borderRadius: 12, background: '#f9fafb', cursor: 'pointer', transition: 'background 0.2s' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#f3f4f6'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#f9fafb'}
                  >
                    <div style={{ width: 48, height: 48, borderRadius: 24, background: getGenderColor(u.gender), backgroundImage: u.photos?.[0] ? `url(${u.photos[0]})` : 'none', backgroundSize: 'cover', flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }}>{u.name}</div>
                      <div style={{ fontSize: 13, color: '#999' }}>Klikni pro otevření</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* NASTAVENÍ modal */}
      {showSettings && (
        <div
          onClick={(e) => e.target === e.currentTarget && setShowSettings(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2500, padding: 20 }}
        >
          <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(440px, 100%)', maxHeight: '80vh', background: '#fff', borderRadius: 16, padding: 24, overflow: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 style={{ margin: 0 }}>Nastavení</h3>
              <button onClick={() => setShowSettings(false)} style={{ border: 'none', background: 'transparent', fontSize: 24, cursor: 'pointer' }}>×</button>
            </div>

            <SettingsForm
              currentUser={currentUser}
              onSave={(data) => {
                updateSettings(data);
                setShowSettings(false);
              }}
              onSignOut={async () => {
                await signOut(auth);
                localStorage.clear();
                window.location.reload();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ===== NASTAVENÍ FORM =====
function SettingsForm({ currentUser, onSave, onSignOut }) {
  const [name, setName] = useState(currentUser.name || '');
  const [age, setAge] = useState(currentUser.age || '');
  const [gender, setGender] = useState(currentUser.gender || '');
  const [allowGender, setAllowGender] = useState(currentUser.pingPrefs?.gender || 'any');
  const [minAge, setMinAge] = useState(currentUser.pingPrefs?.minAge || 16);
  const [maxAge, setMaxAge] = useState(currentUser.pingPrefs?.maxAge || 100);

  const handleSave = () => {
    if (!name.trim()) return alert('Zadej jméno');
    
    onSave({
      name: name.trim(),
      age: age ? Number(age) : null,
      gender,
      pingPrefs: {
        gender: allowGender,
        minAge: Number(minAge),
        maxAge: Number(maxAge)
      }
    });
  };

  return (
    <div>
      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>Jméno</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }}
        />
      </div>

      <div style={{ marginBottom: 16 }}>
        <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 600 }}>Věk</label>
        <input
          type="number"
          value={age}
          onChange={(e) => setAge(e.target.value)}
          min="16"
          max="100"
          style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }}
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600 }}>Pohlaví</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { value: 'm', label: 'Muž' },
            { value: 'f', label: 'Žena' },
            { value: 'x', label: 'Jiné' }
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setGender(opt.value)}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: gender === opt.value ? 'none' : '1px solid #ddd', background: gender === opt.value ? getGenderColor(opt.value) : '#fff', color: gender === opt.value ? '#fff' : '#000', cursor: 'pointer', fontWeight: gender === opt.value ? 600 : 400 }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 20, paddingTop: 20, borderTop: '1px solid #eee' }}>
        <label style={{ display: 'block', marginBottom: 8, fontSize: 14, fontWeight: 600 }}>Kdo mě může pingnout</label>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {[
            { value: 'any', label: 'Kdokoliv' },
            { value: 'f', label: 'Jen ženy' },
            { value: 'm', label: 'Jen muži' }
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setAllowGender(opt.value)}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: allowGender === opt.value ? 'none' : '1px solid #ddd', background: allowGender === opt.value ? '#111' : '#fff', color: allowGender === opt.value ? '#fff' : '#000', cursor: 'pointer', fontWeight: allowGender === opt.value ? 600 : 400, fontSize: 13 }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <label style={{ display: 'block', marginBottom: 6, fontSize: 13, color: '#666' }}>Věkové rozmezí</label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="number"
            value={minAge}
            onChange={(e) => setMinAge(e.target.value)}
            min="16"
            max="100"
            style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }}
          />
          <span style={{ color: '#999' }}>–</span>
          <input
            type="number"
            value={maxAge}
            onChange={(e) => setMaxAge(e.target.value)}
            min="16"
            max="100"
            style={{ flex: 1, padding: 10, borderRadius: 8, border: '1px solid #ddd', fontSize: 14 }}
          />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, paddingTop: 20, borderTop: '1px solid #eee' }}>
        <button
          onClick={handleSave}
          style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#111', color: '#fff', cursor: 'pointer', fontWeight: 600 }}
        >
          Uložit
        </button>
        <button
          onClick={onSignOut}
          style={{ padding: 12, borderRadius: 10, border: '1px solid #ddd', background: '#fff', color: '#000', cursor: 'pointer' }}
        >
          Odhlásit
        </button>
      </div>
    </div>
  );
}
