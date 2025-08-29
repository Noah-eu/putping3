import { useEffect, useState, useRef } from 'react';

function readChats() {
  try { return JSON.parse(localStorage.getItem('pp_chats') || '[]'); } catch { return []; }
}
function writeChats(arr) {
  localStorage.setItem('pp_chats', JSON.stringify(arr || []));
}

export default function Chats({ onClose }) {
  const [list, setList] = useState(() => readChats());
  const [openId, setOpenId] = useState(null);
  const [input, setInput] = useState('');
  const boxRef = useRef(null);

  useEffect(() => { writeChats(list); }, [list]);
  useEffect(() => { if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }, [openId, list]);

  const openChat = (id) => setOpenId(id);
  const closeChat = () => setOpenId(null);

  const send = () => {
    if (!input.trim() || !openId) return;
    const next = list.map(c => {
      if (c.id !== openId) return c;
      const msg = { from: 'me', text: input.trim(), ts: Date.now() };
      return { ...c, lastLine: msg.text, messages: [...(c.messages||[]), msg] };
    });
    setList(next);
    setInput('');
  };

  const del = (id) => {
    if (!confirm('Smazat chat?')) return;
    setList(list.filter(c => c.id !== id));
    setOpenId(null);
  };

  const report = () => alert('Nahlášeno');

  return (
    <div className="pp-modal" onClick={onClose}>
      <div className="pp-card" onClick={(e) => e.stopPropagation()}>
        {!openId ? (
          <div className="pp-chat-list">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <h3 style={{ margin:0 }}>Chaty</h3>
              <button className="icon-btn" onClick={onClose} aria-label="Zavřít">✕</button>
            </div>
            <div>
              {list.length === 0 && <div className="row">Žádné konverzace</div>}
              {list.map(c => (
                <div key={c.id} className="row" onClick={() => openChat(c.id)}>
                  <div style={{ fontWeight: 600 }}>{c.name || 'Uživatel'}</div>
                  <div style={{ color:'#666', fontSize: 13 }}>{c.lastLine || ''}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="pp-chat-view">
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <button className="icon-btn" onClick={closeChat} aria-label="Zpět">←</button>
              <div style={{ fontWeight:700 }}>
                {list.find(c=>c.id===openId)?.name || 'Chat'}
              </div>
              <div style={{ display:'flex', gap:8 }}>
                <button className="btn" onClick={() => del(openId)}>Smazat chat</button>
                <button className="btn btn-outline" onClick={report}>Nahlásit</button>
              </div>
            </div>
            <div ref={boxRef} style={{ overflowY:'auto', maxHeight:'60vh', padding:'8px 0', display:'flex', flexDirection:'column', gap:8 }}>
              {(list.find(c=>c.id===openId)?.messages || []).map((m, i) => (
                <div key={i} className={`pp-msg ${m.from==='me'?'me':'them'}`}>{m.text}</div>
              ))}
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <input className="input" value={input} onChange={(e)=>setInput(e.target.value)} onKeyDown={(e)=> e.key==='Enter' && send()} placeholder="Napiš zprávu…" />
              <button className="btn" onClick={send}>Odeslat</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

