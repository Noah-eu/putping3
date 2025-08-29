import { useState } from 'react';

export default function Onboarding({ onDone }) {
  // Local state per spec
  const [name, setName] = useState('');
  const [gender, setGender] = useState(null); // 'muz' | 'zena' | 'jine'
  const [age, setAge] = useState(null); // number | null
  const [photoDataUrl, setPhotoDataUrl] = useState(null); // string | null
  const [locationAllowed, setLocationAllowed] = useState(false);
  const [coords, setCoords] = useState(null); // { lat, lng } | null
  const [contactPolicy, setContactPolicy] = useState('vsichni');
  const [saving, setSaving] = useState(false);
  const [consent, setConsent] = useState(false);

  // Gender color mapping
  const genderColors = { muz: '#ff66b3', zena: '#3399ff', jine: '#2ecc71' };

  const askLocation = () => {
    if (!navigator.geolocation) {
      alert('Tento prohlížeč nepodporuje geolokaci.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCoords(c);
        setLocationAllowed(true);
      },
      () => {
        alert('Povolení polohy se nezdařilo.');
        setLocationAllowed(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const onPickPhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setPhotoDataUrl(String(reader.result));
    reader.readAsDataURL(file);
  };

  const canContinue = Boolean(name.trim() && gender && coords && consent === true);
  const activeColor = gender ? genderColors[gender] : '#111';

  const saveProfile = () => {
    if (!canContinue) return;
    setSaving(true);
    const profile = {
      name: name.trim(),
      gender,
      color: genderColors[gender],
      age: Number.isFinite(Number(age)) ? Number(age) : null,
      photoDataUrl: photoDataUrl ?? null,
      coords, // { lat, lng }
      contactPolicy,
      createdAt: Date.now(),
    };
    localStorage.setItem('pp_profile', JSON.stringify(profile));
    localStorage.setItem('pp_consent', '1');
    setSaving(false);
    onDone?.(profile);
  };

  return (
    <div className="pp-onb-overlay">
      <div className="pp-onb-card">
        <h2>Vítej v PutPing</h2>

        <div className="pp-field pp-allow">
          <button
            type="button"
            onClick={askLocation}
            className={locationAllowed ? 'allowed' : ''}
          >
            {locationAllowed ? 'Poloha povolena' : 'Povolit polohu'}
          </button>
        </div>

        <div className="pp-field">
          <label>Jméno</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Tvoje jméno"
            className="input"
          />
        </div>

        <div className="pp-field">
          <label>Pohlaví</label>
          <div className="pp-pills">
            <button
              type="button"
              className={`pp-pill${gender==='muz' ? ' active' : ''}`}
              onClick={() => setGender('muz')}
              style={gender==='muz' ? { background: genderColors.muz } : undefined}
            >Muž</button>
            <button
              type="button"
              className={`pp-pill${gender==='zena' ? ' active' : ''}`}
              onClick={() => setGender('zena')}
              style={gender==='zena' ? { background: genderColors.zena } : undefined}
            >Žena</button>
            <button
              type="button"
              className={`pp-pill${gender==='jine' ? ' active' : ''}`}
              onClick={() => setGender('jine')}
              style={gender==='jine' ? { background: genderColors.jine } : undefined}
            >Jiné</button>
          </div>
        </div>

        <div className="pp-field">
          <label>Věk (volitelné)</label>
          <input
            type="number"
            inputMode="numeric"
            placeholder="Věk (volitelné)"
            className="input"
            value={age ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              const n = v === '' ? null : Number(v);
              setAge(Number.isFinite(n) ? n : null);
            }}
          />
        </div>

        <div className="pp-field pp-photo">
          <label>Profilová fotka</label>
          <input type="file" accept="image/*" onChange={onPickPhoto} />
          {photoDataUrl && (
            <div className="preview">
              <img src={photoDataUrl} alt="preview" />
            </div>
          )}
        </div>

        <div className="pp-field">
          <label>Kdo mě může kontaktovat</label>
          <select className="input" value={contactPolicy} onChange={(e)=>setContactPolicy(e.target.value)}>
            <option value="vsichni">všichni</option>
            <option value="jen-zeny">jen ženy</option>
            <option value="jen-muzi">jen muži</option>
            <option value="vek-plusminus-5">v mém věku ±5</option>
          </select>
        </div>

        <div className="pp-field">
          <label>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              style={{ marginRight: 8 }}
            />
            Souhlasím s podmínkami a zásadami ochrany soukromí
          </label>
        </div>

        <button
          type="button"
          className="pp-primary"
          style={{ background: activeColor }}
          disabled={!canContinue || saving}
          onClick={saveProfile}
        >
          {saving ? 'Ukládám…' : 'Pokračovat'}
        </button>
      </div>
    </div>
  );
}
