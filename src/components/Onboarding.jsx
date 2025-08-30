import React, { useEffect, useMemo, useState } from 'react';
import { auth } from '../firebase.js';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';

const GENDER_META = {
  muz: { label: 'Muž', color: '#ff66b3' },
  zena: { label: 'Žena', color: '#4da3ff' },
  jine: { label: 'Jiné', color: '#00c853' },
};

export default function Onboarding({ onDone }){
  const [coords, setCoords] = useState(null);
  const [locLoading, setLocLoading] = useState(false);
  const [name, setName] = useState('');
  const [gender, setGender] = useState(null); // 'muz' | 'zena' | 'jine'
  const [age, setAge] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState(null);
  const [agree, setAgree] = useState(false);
  const [authInfo, setAuthInfo] = useState(null);
  const color = useMemo(()=> gender ? GENDER_META[gender]?.color : '#888', [gender]);

  function reqLocation(){
    if (!('geolocation' in navigator)) return;
    setLocLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos)=>{
        setLocLoading(false);
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      ()=>{
        setLocLoading(false);
        setCoords(null);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function onPickPhoto(e){
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(reader.result);
    reader.readAsDataURL(file);
  }

  async function signInGoogle(){
    try {
      const provider = new GoogleAuthProvider();
      const res = await signInWithPopup(auth, provider);
      const u = res.user;
      const info = { uid: u?.uid||null, email: u?.email||null, displayName: u?.displayName||null, photoURL: u?.photoURL||null };
      setAuthInfo(info);
      try { localStorage.setItem('pp_auth', JSON.stringify(info)); } catch {}
      if (!name && info.displayName) setName(info.displayName);
      if (!photoDataUrl && info.photoURL) setPhotoDataUrl(info.photoURL);
      alert('✅ Přihlášen Googlem');
    } catch(e){ console.error(e); alert('Přihlášení Googlem se nezdařilo.'); }
  }

  const canContinue = !!coords && !!name.trim() && !!agree;

  function handleDone(){
    if (!canContinue) return;
    const profile = {
      uid: undefined,
      name: name.trim(),
      gender: gender || 'muz',
      color,
      age: age ? Number(age) : null,
      photoDataUrl: photoDataUrl || null,
      coords,
      contactPolicy: 'vsichni',
    };
    if (authInfo) profile.auth = { uid: authInfo.uid, email: authInfo.email };
    onDone && onDone(profile);
  }

  return (
    <div style={{position:'fixed', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.35)', zIndex:9999}}>
      <div className="pp-card" style={{ width: 360, maxWidth: '92vw' }}>
        <div style={{fontWeight:700, fontSize:18, marginBottom:10, textAlign:'center'}}>Vytvoř si profil</div>

        <div style={{ marginBottom: 12 }}>
          <button onClick={reqLocation} className="pill" style={{ background: coords ? '#e6ffe6' : '#fff' }}>
            {locLoading ? 'Zjišťuji polohu…' : (coords ? 'Poloha povolena ✓' : 'Povolit polohu')}
          </button>
        </div>

        <div style={{ marginBottom: 12, display:'flex', gap:8, alignItems:'center' }}>
          <button onClick={signInGoogle} className="pill" style={{ background: authInfo ? '#e6f4ff' : '#fff' }}>
            {authInfo ? 'Přihlášen Googlem ✓' : 'Přihlásit se Googlem (volitelné)'}
          </button>
          {authInfo?.email && (
            <span style={{ fontSize:12, color:'#555' }}>{authInfo.email}</span>
          )}
        </div>

        <label style={{ display:'block', marginBottom:10 }}>
          Jméno
          <input value={name} onChange={e=>setName(e.target.value)} style={{width:'100%', padding:'8px 10px', border:'1px solid #ddd', borderRadius:8, marginTop:6}} />
        </label>

        <div style={{ marginBottom: 10 }}>
          <div style={{ marginBottom: 6 }}>Pohlaví</div>
          {(['muz','zena','jine']).map(k => (
            <button key={k} onClick={()=>setGender(k)} className={`pill ${gender===k? 'active':''}`} style={{ background: gender===k ? GENDER_META[k].color : '#fff' }}>
              {GENDER_META[k].label}
            </button>
          ))}
        </div>

        <label style={{ display:'block', marginBottom:10 }}>
          Věk (volitelné)
          <input type="number" inputMode="numeric" value={age} onChange={e=>setAge(e.target.value)} style={{width:'100%', padding:'8px 10px', border:'1px solid #ddd', borderRadius:8, marginTop:6}} />
        </label>

        <div style={{ marginBottom: 10 }}>
          <div style={{ marginBottom: 6 }}>Profilová fotka</div>
          <input type="file" accept="image/*" onChange={onPickPhoto} />
          {photoDataUrl && (
            <div style={{ marginTop:8, textAlign:'center' }}>
              <img src={photoDataUrl} alt="náhled" style={{ width:72, height:72, objectFit:'cover', borderRadius:'50%', border:'2px solid #fff', boxShadow:'0 2px 6px rgba(0,0,0,.25)' }} />
            </div>
          )}
        </div>

        <label style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
          <input type="checkbox" checked={agree} onChange={e=>setAgree(e.target.checked)} /> Souhlasím s podmínkami
        </label>

        <div style={{ display:'flex', justifyContent:'flex-end' }}>
          <button onClick={handleDone} disabled={!canContinue} style={{ opacity: canContinue?1:.6, cursor: canContinue?'pointer':'not-allowed', padding:'10px 14px', border:'1px solid #ddd', borderRadius:8, background:'#fff' }}>
            Pokračovat
          </button>
        </div>
      </div>
    </div>
  );
}
