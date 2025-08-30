import React, { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import { attachPinZoom } from '../lib/pinZoom.ts';
import { db, auth } from '../firebase.js';
import { ref as dbref, onValue, onChildAdded, set, serverTimestamp } from 'firebase/database';
import { signInAnonymously } from 'firebase/auth';
import Chats from './Chats.jsx';
import { spawnDevBot } from '../devBot.js';

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

// helper: teardrop DOM – single element with img inside
function buildTearDropEl(photoUrl, color, name) {
  const el = document.createElement('div');
  el.className = 'pp-tear';
  el.style.setProperty('--pp-color', color || '#ff5aa5');
  // kontrastní barva pro rámeček jména (opačná barva genderu)
  const contrast = (c => {
    switch((c||'').toLowerCase()){
      case '#ff5aa5': return 'rgba(79,140,255,.55)';   // růžová -> modrá
      case '#4f8cff': return 'rgba(255,90,165,.55)';   // modrá -> růžová
      case '#22c55e': return 'rgba(123,97,255,.55)';   // zelená -> fialová
      default:        return 'rgba(17,17,17,.5)';
    }
  })(color);
  el.style.setProperty('--pp-contrast', contrast);
  const contrastSolid = (c => {
    switch((c||'').toLowerCase()){
      case '#ff5aa5': return '#4f8cff';   // růžová -> modrá
      case '#4f8cff': return '#ff5aa5';   // modrá -> růžová
      case '#22c55e': return '#7b61ff';   // zelená -> fialová
      default:        return '#e5e7eb';
    }
  })(color);
  el.style.setProperty('--pp-contrast-bg', contrastSolid);
  const inner = document.createElement('div');
  inner.className = 'pp-inner';
  const img = document.createElement('img');
  img.className = 'pp-avatar';
  img.alt = 'avatar';
  img.src = photoUrl || '';
  inner.appendChild(img);
  const label = document.createElement('div');
  label.className = 'pp-name';
  label.textContent = name || '';
  el.appendChild(inner);
  el.appendChild(label); // umísti jméno mimo .pp-inner, aby se neskalovalo 5×
  return el;
}

export default function MapView({ profile }) {
  const mapRef = useRef(null);
  const mapElRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);
  const selfMarkerRef = useRef(null);
  const botMarkerRef = useRef(null);
  const [botUid, setBotUid] = useState(null);
  const [openChatPid, setOpenChatPid] = useState(null);
  const [botPaired, setBotPaired] = useState(false);
  const [geoPos, setGeoPos] = useState(null); // {lng,lat} (averaged)
  const geoBufRef = useRef([]); // posledních N vzorků pro vyhlazení
  const centeredOnceRef = useRef(false); // zajistí centrování po načtení

  function pairIdOf(a,b){ return a<b ? `${a}_${b}` : `${b}_${a}`; }
  function getAuthInfo(){
    try { return { uid: auth?.currentUser?.uid || null, email: auth?.currentUser?.email || null }; } catch { return null; }
  }
  async function ensureAuthUid(){
    try{
      if (auth?.currentUser?.uid) return auth.currentUser.uid;
      const cred = await signInAnonymously(auth);
      try { localStorage.setItem('pp_auth', JSON.stringify({ uid: cred.user?.uid || null, email: cred.user?.email || null })); } catch {}
      return cred.user?.uid || null;
    }catch(e){ console.warn('ensureAuthUid failed', e); return null; }
  }
  function playBeep(){
    try{
      const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      const ctx = new Ctx(); const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type='sine'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination);
      o.start(); g.gain.setValueAtTime(0.2, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime+0.4); o.stop(ctx.currentTime+0.42);
    }catch{}
  }
  function toast(msg){
    try{
      const d = document.createElement('div');
      d.textContent = msg; d.style.cssText = 'position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#111;color:#fff;padding:10px 14px;border-radius:999px;z-index:4000;box-shadow:0 6px 16px rgba(0,0,0,.25);font-weight:700';
      document.body.appendChild(d); setTimeout(()=>{ d.remove(); }, 1600);
    }catch{}
  }

  const center = profile?.coords
    ? [profile.coords.lng, profile.coords.lat]
    : [14.42076, 50.08804];

  // 1) inicializace mapy
  useEffect(() => {
    if (mapRef.current) return;
    const m = new mapboxgl.Map({
      container: mapElRef.current,
      style: 'mapbox://styles/mapbox/streets-v12',
      center,
      // výrazně přiblížená mapa ~1 km čtvereční
      zoom: profile?.coords ? 16.5 : 14,
    });
    mapRef.current = m;
    m.once('load', () => setMapReady(true));
    return () => {
      m.remove();
      mapRef.current = null;
    };
  }, []); // pouze jednou

  // 1b) Owner-only: spawn kontrolní bot (jen když je povolen v env)
  useEffect(() => {
    const flag = String(import.meta.env.VITE_DEV_BOT || '').toLowerCase();
    const wantBot = flag === '1' || flag === 'true' || flag === 'yes';
    const local = typeof localStorage !== 'undefined' ? localStorage.getItem('pp_auth') : null;
    let ownerEmail = null, ownerUid = undefined;
    try { const p = JSON.parse(local || 'null'); ownerEmail = p?.email || null; ownerUid = p?.uid || undefined; } catch {}
    const OWNER = String(import.meta.env.VITE_OWNER_EMAIL || 'david.eder78@gmail.com').trim().toLowerCase();
    // Debug log to understand gating conditions
    try { console.log('[DevBot] gate', { wantBot, ownerEmail, OWNER, hasUid: !!ownerUid, botUid }); } catch {}
    if (!mapReady || !wantBot) return;
    if (!ownerEmail || ownerEmail.trim().toLowerCase() !== OWNER) return;
    if (botUid) return; // už běží
    (async () => {
      try {
        const uid = await spawnDevBot(ownerUid);
        setBotUid(uid);
        try { console.log('[DevBot] spawned', { uid }); } catch {}
      } catch (e) { console.warn('spawnDevBot failed', e?.code || e); }
    })();
  }, [mapReady, botUid, profile?.auth?.email]);

  // Ujisti se, že máme alespoň anonymní přihlášení pro RTDB zápisy (Pingy)
  useEffect(() => { ensureAuthUid(); }, []);

  // 2) náš pin (teardrop) + klik = 5× zoom
  useEffect(() => {
    if (!mapReady || !mapRef.current || !profile?.coords) return;
    const map = mapRef.current;

    const lng = (geoPos?.lng ?? profile.coords.lng);
    const lat = (geoPos?.lat ?? profile.coords.lat);

    const g = (profile.gender || '').toLowerCase();
    const color =
      (g === 'muz' || g === 'muž') ? '#ff5aa5' :
      (g === 'zena' || g === 'žena') ? '#4f8cff' :
      '#22c55e';

    // vytvoř/obnov marker
    if (!selfMarkerRef.current) {
      const el = buildTearDropEl(profile?.photoDataUrl || profile?.photoURL || null, color, profile?.name || '');
      attachPinZoom(el, map, [lng, lat]);

      selfMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat])
        .addTo(map);
    } else {
      // update pozice + barvy + fotky
      selfMarkerRef.current.setLngLat([lng, lat]);
      const el = selfMarkerRef.current.getElement();
      const pUrl = profile?.photoDataUrl || profile?.photoURL || '';
      el.style.setProperty('--pp-color', color);
      const contrast = ((c)=>{switch((c||'').toLowerCase()){case '#ff5aa5':return 'rgba(79,140,255,.55)';case '#4f8cff':return 'rgba(255,90,165,.55)';case '#22c55e':return 'rgba(123,97,255,.55)';default:return 'rgba(17,17,17,.5)';}})(color);
      el.style.setProperty('--pp-contrast', contrast);
      const img = el.querySelector('.pp-avatar');
      if (img && pUrl) img.src = pUrl;
      const label = el.querySelector('.pp-name');
      if (label) label.textContent = profile?.name || '';
    }
  }, [mapReady, profile?.coords?.lng, profile?.coords?.lat, profile?.photoDataUrl, profile?.photoURL, profile?.gender, geoPos?.lng, geoPos?.lat]);

  // 2c) Bot marker – jen pro ownera, sleduje /users/{botUid}
  useEffect(() => {
    if (!mapReady || !mapRef.current || !botUid) return;
    const map = mapRef.current;
    const unsub = onValue(dbref(db, `users/${botUid}`), (snap) => {
      const u = snap.val();
      if (!u || !Number.isFinite(u.lat) || !Number.isFinite(u.lng)) return;
      const g = (u.gender || 'muz').toLowerCase();
      const color = (g === 'muz' || g === 'muž') ? '#ff5aa5' : (g === 'zena' || g === 'žena') ? '#4f8cff' : '#22c55e';
      if (!botMarkerRef.current) {
        const el = buildTearDropEl(u.photoURL || null, color, u.name || 'Bot');
        // Stejné chování jako u uživatelů: jméno až při zoomu
        try { attachPinZoom(el, map, [u.lng, u.lat]); } catch {}

        botMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([u.lng, u.lat])
          .addTo(map);

        // Akční tlačítko (Ping/Chat) – viditelné při zvětšení
        const btn = document.createElement('button');
        btn.className = 'pp-action';
        btn.textContent = 'Ping';
        el.appendChild(btn);

        btn.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          const fromUid = await ensureAuthUid(); if (!fromUid){ toast('Přihlas se pro Ping'); return; }
          const toUid = botUid; const pid = pairIdOf(fromUid, toUid);
          try {
            if (!botPaired){
              // Zapiš pouze do pairPings – devBot na to reaguje a vyřeší párování
              await set(dbref(db, `pairPings/${pid}/${fromUid}`), serverTimestamp());
              toast('Ping odeslán');
            } else {
              // Otevři lokální chat modal
              try {
                const arr = JSON.parse(localStorage.getItem('pp_chats')||'[]');
                if (!arr.find(x=>x.id===pid)) arr.push({ id: pid, name: u.name||'Uživatel', messages: [] });
                localStorage.setItem('pp_chats', JSON.stringify(arr));
              } catch{}
              setOpenChatPid(pid);
            }
          } catch(e){ console.warn('Ping write failed', e); toast('Ping se nepodařil'); }
        });
      } else {
        botMarkerRef.current.setLngLat([u.lng, u.lat]);
        const el = botMarkerRef.current.getElement();
        el.style.setProperty('--pp-color', color);
        const label = el.querySelector('.pp-name');
        if (label) label.textContent = u.name || 'Bot';
        const img = el.querySelector('.pp-avatar');
        if (img && u.photoURL) img.src = u.photoURL;
      }
    });
    return () => unsub();
  }, [mapReady, botUid]);

  // 2d) Sleduj, zda máme s botem pár => přepínej na Chat
  useEffect(() => {
    const au = getAuthInfo(); const my = au?.uid; if (!mapReady || !botUid || !my) return;
    const pid = pairIdOf(my, botUid);
    const unsub = onValue(dbref(db, `pairPings/${pid}/${botUid}`), (snap) => {
      const isPaired = !!snap.val();
      setBotPaired(isPaired);
      const el = botMarkerRef.current?.getElement();
      const btn = el?.querySelector('.pp-action');
      if (btn) btn.textContent = isPaired ? 'Chat' : 'Ping';
    });
    return () => unsub();
  }, [mapReady, botUid]);

  // 2e) Příchozí ping od bota – zvuk + toast + nadskakující marker odesílatele
  useEffect(() => {
    const au = getAuthInfo(); const my = au?.uid; if (!mapReady || !my || !botUid) return;
    const pid = pairIdOf(my, botUid);
    let seen = false;
    const unsub = onValue(dbref(db, `pairPings/${pid}/${botUid}`), (snap) => {
      const v = snap.val();
      if (v && !seen){ seen = true; playBeep(); toast('Dostal jsi Ping!');
        if (botMarkerRef.current){ const el = botMarkerRef.current.getElement(); el.classList.add('is-ping'); setTimeout(()=> el.classList.remove('is-ping'), 4000); }
      }
    });
    return () => unsub();
  }, [mapReady, botUid]);

  // 2b) Po načtení mapy vždy vycentrovat uživatele doprostřed
  useEffect(() => {
    if (!mapReady || !mapRef.current) return;
    const lng = (geoPos?.lng ?? profile?.coords?.lng);
    const lat = (geoPos?.lat ?? profile?.coords?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
    if (centeredOnceRef.current) return;
    try {
      mapRef.current.jumpTo({ center: [lng, lat] });
      centeredOnceRef.current = true;
    } catch {}
  }, [mapReady, geoPos?.lng, geoPos?.lat, profile?.coords?.lng, profile?.coords?.lat]);

  // 3) Live geolocation – vyhlazení a zlepšení přesnosti
  useEffect(() => {
    if (!mapReady) return;
    if (!('geolocation' in navigator)) return;
    const opts = { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 };
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords || {};
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        // Akceptuj jen rozumné vzorky (<= 25 m) a vyhlaď váženým průměrem
        if (accuracy != null && accuracy > 25) return;
        const w = 1 / Math.max(accuracy || 10, 5) ** 2; // menší accuracy => větší váha
        const buf = geoBufRef.current || [];
        buf.push({ lat: latitude, lng: longitude, w });
        if (buf.length > 8) buf.shift();
        geoBufRef.current = buf;
        let sumW = 0, sumLat = 0, sumLng = 0;
        for (const s of buf) { sumW += s.w; sumLat += s.lat * s.w; sumLng += s.lng * s.w; }
        if (sumW > 0) setGeoPos({ lat: sumLat / sumW, lng: sumLng / sumW });
      },
      () => {},
      opts
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [mapReady]);

  return (
    <>
      <div ref={mapElRef} style={{ position: 'absolute', inset: 0 }} />
      {openChatPid && <Chats onClose={() => setOpenChatPid(null)} />}
    </>
  );
}
