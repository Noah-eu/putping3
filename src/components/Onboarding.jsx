import { useState } from 'react';
import { genderColors } from '../constants/genderColors';

export default function Onboarding({ onDone }) {
  const [locAllowed, setLocAllowed] = useState(false);
const [coords, setCoords] = useState(null);
const [name, setName] = useState('');
  const [gender, setGender] = useState(null);
const [photoPreview, setPhotoPreview] = useState(null);
const [saving, setSaving] = useState(false);

const askLocation = () => {
if (!navigator.geolocation) {
alert('Tento prohlížeč nepodporuje geolokaci.');
return;
}
navigator.geolocation.getCurrentPosition(
(pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(c);
        setLocAllowed(true);
        if (typeof saveProfileDebounced === 'function') {
          saveProfileDebounced(me?.uid, { coords: c, locationAllowed: true });
        }
},
(err) => {
console.error(err);
alert('Povolení polohy se nezdařilo.');
},
{ enableHighAccuracy: true, timeout: 10000 }
);
};

const onPickPhoto = (e) => {
const file = e.target.files?.[0];
if (!file) return;
const reader = new FileReader();
reader.onload = () => setPhotoPreview(reader.result);
reader.readAsDataURL(file);
};

const saveProfile = () => {
if (!name.trim()) return alert('Zadej jméno.');
if (!gender) return alert('Vyber pohlaví.');
    if (!locAllowed || !coords) return alert('Povol polohu.');
setSaving(true);
    const color = genderColors[gender];
const profile = {
name: name.trim(),
gender,
photoDataUrl: photoPreview || null,
      locationAllowed: locAllowed,
coords,
      color,
      updatedAt: Date.now()
};
localStorage.setItem('pp_profile', JSON.stringify(profile));
setSaving(false);
onDone?.(profile);
};

const pill = (activeColor) => ({
padding: '10px 14px',
borderRadius: 999,
border: '1px solid #d1d5db',
cursor: 'pointer',
background: activeColor || '#f3f4f6',
});

return (
<div style={{ maxWidth: 560, margin: '32px auto', padding: 16 }}>
<h2 style={{ marginBottom: 12 }}>Vítej v PutPing</h2>
<div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
<button
 type="button"
 style={{
            padding: '10px 14px',
            border: '1px solid #d1d5db',
            borderRadius: 999,
            background: locAllowed ? '#22c55e' : '#e5e7eb',
            color: locAllowed ? '#fff' : '#111',
            cursor: 'pointer',
 }}
          onClick={askLocation}
>
          {locAllowed ? 'Poloha povolena' : 'Povolit polohu'}
</button>
</div>
<label style={{ display: 'block', margin: '12px 0 4px' }}>Jméno</label>
<input
 value={name}
 onChange={(e) => setName(e.target.value)}
 placeholder="Tvoje jméno"
 style={{ width: '100%', padding: 10, borderRadius: 8, border: '1px solid #d1d5db' }}
/>
<label style={{ display: 'block', margin: '16px 0 8px' }}>Pohlaví</label>
<div style={{ display: 'flex', alignItems: 'center' }}>
<button
 type="button"
          className={`pill muz${gender==='muz'?' active':''}`}
          onClick={() => setGender('muz')}
          style={{ marginRight: 8, ...(gender==='muz'?{background: genderColors['muz'], color: '#fff'}:{}) }}
        >Muž</button>
        <button
          type="button"
          className={`pill žena${gender==='žena'?' active':''}`}
          onClick={() => setGender('žena')}
          style={{ marginRight: 8, ...(gender==='žena'?{background: genderColors['žena'], color: '#fff'}:{}) }}
        >Žena</button>
        <button
          type="button"
          className={`pill jine${gender==='jine'?' active':''}`}
          onClick={() => setGender('jine')}
          style={{ ...(gender==='jine'?{background: genderColors['jine'], color: '#fff'}:{}) }}
        >Jiné</button>
</div>
      <label style={{ display: 'block', margin: '16px 0 8px' }}>Profilová fotka</label>
      <input type="file" accept="image/*" onChange={onPickPhoto} />
      {photoPreview && (
        <div style={{ marginTop: 8 }}>
          <img
            src={photoPreview}
            alt="preview"
            style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 12 }}
          />
</div>
      )}
      <div style={{ marginTop: 24 }}>
        <button
          type="button"
          disabled={saving}
          onClick={saveProfile}
          style={{
            ...pill(gender ? genderColors[gender] : '#111'),
            color: '#fff',
            width: '100%',
            fontWeight: 600
          }}
        >
          {saving ? 'Ukládám…' : 'Pokračovat'}
        </button>
      </div>
    </div>
);
}

