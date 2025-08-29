import React, { useEffect } from 'react';

export default function ProfileCard({ profile, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="pp-card-backdrop" onClick={onClose}>
      <div className="pp-card" onClick={e => e.stopPropagation()}>
        <button className="pp-card-close" onClick={onClose} aria-label="Zavřít">×</button>
        <img className="pp-card-avatar" src={profile.photoDataUrl || ''} alt="" />
        <div className="pp-card-name">{profile.name || 'Uživatel'}</div>
        <button className="pp-card-btn" onClick={() => alert('Ping!')}>Ping</button>
      </div>
    </div>
  );
}

