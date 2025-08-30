import { useEffect, useRef, useState } from 'react';

export default function ToolsFab({ tools = [] }) {
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

  const items = tools.length ? tools : [
    { label: 'Center na mě', onClick: () => console.log('[Tools] center me') },
    { label: 'Refresh data', onClick: () => window.location.reload() },
  ];

  return (
    <div className="pp-fab-left" aria-label="Nástroje">
      {open && (
        <div ref={cardRef} className="pp-card" style={{ padding: 8, marginBottom: 8 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 220 }}>
            {items.map((it, i) => (
              <button key={i} className="btn" onClick={() => { setOpen(false); it.onClick?.(); }}>
                {it.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <button aria-label="Nástroje" onClick={() => setOpen(v => !v)}>⚙️</button>
    </div>
  );
}

