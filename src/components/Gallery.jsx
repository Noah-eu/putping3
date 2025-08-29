import { useEffect, useState, useRef } from 'react';

function readGallery() {
  try { return JSON.parse(localStorage.getItem('pp_gallery') || '[]'); } catch { return []; }
}
function writeGallery(arr) {
  localStorage.setItem('pp_gallery', JSON.stringify(arr || []));
}
function updateProfileFirst(url) {
  try {
    const raw = localStorage.getItem('pp_profile');
    const p = raw ? JSON.parse(raw) : null;
    if (!p) return;
    const next = { ...p, photoDataUrl: url || null };
    localStorage.setItem('pp_profile', JSON.stringify(next));
  } catch {}
}

export default function Gallery({ onClose }) {
  const [items, setItems] = useState(() => readGallery());
  const dragFrom = useRef(null);

  useEffect(() => {
    writeGallery(items);
    if (items[0]) updateProfileFirst(items[0]);
  }, [items]);

  const onPick = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const remain = Math.max(0, 9 - items.length);
    const chosen = files.slice(0, remain);
    let done = 0;
    const next = [...items];
    chosen.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        next.push(String(reader.result));
        done += 1;
        if (done === chosen.length) setItems(next);
      };
      reader.readAsDataURL(file);
    });
    e.target.value = '';
  };

  const onDragStart = (i) => (e) => { dragFrom.current = i; e.dataTransfer.effectAllowed = 'move'; };
  const onDrop = (i) => (e) => {
    e.preventDefault();
    const from = dragFrom.current;
    if (from == null || from === i) return;
    const arr = [...items];
    const [m] = arr.splice(from, 1);
    arr.splice(i, 0, m);
    setItems(arr);
    dragFrom.current = null;
  };
  const onDragOver = (e) => e.preventDefault();

  const del = (i) => {
    if (!confirm('Smazat fotku?')) return;
    const arr = [...items];
    arr.splice(i, 1);
    setItems(arr);
  };

  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-card" onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Galerie</h3>
          <div>
            <input id="ppGalPick" type="file" accept="image/*" multiple hidden onChange={onPick} />
            <button className="btn" onClick={() => document.getElementById('ppGalPick')?.click()}>+ Přidat</button>
            <button className="icon-btn" onClick={onClose} aria-label="Zavřít">✕</button>
          </div>
        </div>
        <div className="pp-gallery-grid">
          {Array.from({ length: 9 }).map((_, i) => (
            <div
              key={i}
              className="pp-g-tile"
              draggable={items[i] != null}
              onDragStart={onDragStart(i)}
              onDragOver={onDragOver}
              onDrop={onDrop(i)}
            >
              {items[i] ? (
                <>
                  <img src={items[i]} alt="" />
                  {i === 0 && <div className="pp-g-badge">Profilová</div>}
                  <button className="pp-g-del" onClick={() => del(i)}>✕</button>
                </>
              ) : (
                <span style={{ color: '#777' }}>{i === items.length ? '+ Přidat' : ''}</span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

