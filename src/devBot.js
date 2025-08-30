import { getDatabase, ref, set, update, onChildAdded, serverTimestamp, get } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import { initSecondaryApp } from "./firebase.js";

function pairIdOf(a,b){ return a<b ? `${a}_${b}` : `${b}_${a}`; }

export async function spawnDevBot(ownerUid){
  const app = initSecondaryApp("dev-bot");
  const db2 = getDatabase(app);
  const auth2 = getAuth(app);

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

  // Reakce na pingy → spáruj pár a pošli zprávu
  const inboxRef = ref(db2, `pings/${botUid}`);
  try {
    onChildAdded(inboxRef, async (snap) => {
      const fromUid = snap.key;
      const pid = pairIdOf(fromUid, botUid);

      await set(ref(db2, `pairPings/${pid}/${botUid}`), serverTimestamp());
      const other = await get(ref(db2, `pairPings/${pid}/${fromUid}`));
      if (other.exists()) await set(ref(db2, `pairs/${pid}`), true);

      await set(ref(db2, `messages/${pid}/${Date.now()}`), {
        from: botUid,
        text: "Ahoj, testuju, že to funguje 🙂",
        time: serverTimestamp(),
      });
    });
  } catch (e) {
    console.warn('[DevBot] inbox subscribe failed', e?.code || e);
  }

  // Keep-alive + malé chvění polohy, ať je vidět že žije
  setInterval(() => {
    const jitter = () => (Math.random()-0.5) * 0.0003; // ~±30 m
    lat += jitter(); lng += jitter();
    update(userRef, { lastActive: Date.now(), lat, lng });
  }, 15000);

  return botUid;
}
