import { getDatabase, ref, set, update, onChildAdded, serverTimestamp, get, push, child } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import { initSecondaryApp } from "./firebase.js";

function pairIdOf(a,b){ return a<b ? `${a}_${b}` : `${b}_${a}`; }

export async function spawnDevBot(ownerUid){
  const app = initSecondaryApp("dev-bot");
  const db2 = getDatabase(app);
  const auth2 = getAuth(app);
  const startedAt = Date.now();

  const cred = await signInAnonymously(auth2);
  const botUid = cred.user.uid;
  try { console.log('[DevBot] signed in anonymously', { botUid }); } catch {}

  // Najdi někoho poblíž a spawn se u něj – pokud čtení users není povoleno,
  // pokračuj s fallback souřadnicemi (nechceme na tom celé spuštění shodit)
  let lat = 50.083, lng = 14.419; // fallback Praha
  try {
    const usersSnap = await get(ref(db2, "users"));
    if (usersSnap.exists()){
      const users = Object.entries(usersSnap.val() || {})
        .map(([uid,u]) => ({ uid, ...(u||{}) }))
        .filter(u => !!u.uid)
        .sort((a,b)=> (b.lastActive||0) - (a.lastActive||0));
      const other = users.find(u => u.uid !== botUid);
      if (other?.lat && other?.lng){
        lat = other.lat + (Math.random()-0.5)*0.001; // ~±100 m
        lng = other.lng + (Math.random()-0.5)*0.001;
      }
    }
  } catch (e) {
    console.warn('[DevBot] users read failed, using fallback', e?.code || e);
  }

  const userRef = ref(db2, `users/${botUid}`);
  await set(userRef, {
    name: "Kontrolní bot",
    photoURL: "https://i.pravatar.cc/200?img=12",
    photos: [],
    gender: "muz",
    lat, lng,
    online: true,
    lastActive: Date.now(),
    isDevBot: true,
    privateTo: ownerUid,
  });
  try { console.log('[DevBot] user created', { botUid, lat, lng }); } catch {}

  // New ping handling per spec
  try {
    const handled = new Set();
    const toMeRef = ref(db2, `pings/${botUid}`);
    onChildAdded(toMeRef, (snap) => {
      const fromUid = snap.key;
      if (!fromUid) return;
      const fromRef = ref(db2, `pings/${botUid}/${fromUid}`);
      onChildAdded(fromRef, async (childSnap) => {
        try {
          const pid = childSnap.key;
          if (!pid || handled.has(pid)) return;
          const val = childSnap.val();
          // Ignore historical pings prior to bot start
          const tsVal = (val && typeof val === 'object') ? val.ts : (typeof val === 'number' ? val : null);
          if (tsVal && typeof tsVal === 'number' && tsVal < startedAt - 1000) return;
          handled.add(pid);

          // Reply ping back to sender at a new key
          const replyRef = push(ref(db2, `pings/${fromUid}/${botUid}`));
          await set(replyRef, { ts: serverTimestamp(), from: botUid, to: fromUid });

          // Pulse flag so client can animate their marker
          await set(ref(db2, `pairPings/${fromUid}/${botUid}`), serverTimestamp());

          // Promote to pair if mutual (both sides have at least one child)
          try {
            const aRef = child(ref(db2, `pings/${fromUid}`), botUid);
            const bRef = child(ref(db2, `pings/${botUid}`), fromUid);
            const [a, b] = await Promise.all([get(aRef), get(bRef)]);
            if (a.exists() && b.exists()) {
              const pairId = pairIdOf(botUid, fromUid);
              await update(ref(db2), {
                [`pairMembers/${pairId}/${botUid}`]: true,
                [`pairMembers/${pairId}/${fromUid}`]: true,
                [`pairs/${pairId}/createdAt`]: serverTimestamp(),
              });
            }
          } catch (e) {
            console.warn('[DevBot] pair promotion check failed', e?.code || e);
          }
          try { console.log('[DevBot] replied to ping', { fromUid, pid }); } catch {}
        } catch (e) {
          console.warn('[DevBot] reply handler failed', e?.code || e);
        }
      }, (err) => console.warn('[DevBot] onChildAdded pings/from error', err?.code || err));
    }, (err) => console.warn('[DevBot] onChildAdded pings root error', err?.code || err));
  } catch (e) {
    console.warn('[DevBot] new ping handling failed', e?.code || e);
  }

  // Keep-alive + malé chvění polohy, ať je vidět že žije
  setInterval(() => {
    const jitter = () => (Math.random()-0.5) * 0.0003; // ~±30 m
    lat += jitter(); lng += jitter();
    update(userRef, { lastActive: Date.now(), lat, lng });
  }, 15000);

  return botUid;
}
