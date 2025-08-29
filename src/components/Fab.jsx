import { useState, useEffect, useRef } from 'react';

export default function Fab({ onOpenGallery, onOpenChats }) {
  const [open, setOpen] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    const onDoc = (e) => {
      if (!cardRef.current) return;
      if (!cardRef.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('pointerdown', onDoc);
    return () => document.removeEventListener('pointerdown', onDoc);
  }, [open]);

  return (
    <div className="pp-fab">
      {open && (
        <div ref={cardRef} className="pp-card" style={{ padding: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn" onClick={() => { setOpen(false); onOpenGallery?.(); }}>Galerie</button>
            <button className="btn" onClick={() => { setOpen(false); onOpenChats?.(); }}>Chaty</button>
          </div>
        </div>
      )}
      <button aria-label="Menu" onClick={() => setOpen(v => !v)}>⚙️</button>
    </div>
  );
}

