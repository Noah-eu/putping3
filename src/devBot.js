import { getDatabase, ref, set, update, onChildAdded, serverTimestamp, get, remove } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import { initSecondaryApp } from "./firebase.js";

function pairIdOf(a,b){ return a<b ? `${a}_${b}` : `${b}_${a}`; }

export async function spawnDevBot(ownerUid){
  const app = initSecondaryApp("dev-bot");
  const db2 = getDatabase(app);
  const auth2 = getAuth(app);

  const cred = await signInAnonymously(auth2);
  const botUid = cred.user.uid;

  // Najdi někoho poblíž a spawn se u něj
  const usersSnap = await get(ref(db2, "users"));
  let lat = 50.083, lng = 14.419; // fallback Praha
  if (usersSnap.exists()){
    const users = Object.entries(usersSnap.val() || {})
      .map(([uid,u]) => ({ uid, ...(u||{}) }))
      .filter(u => !!u.uid)
      .sort((a,b)=> (b.lastSeen||0) - (a.lastSeen||0));
    const other = users.find(u => u.uid !== botUid);
    if (other?.lat && other?.lng){
      lat = other.lat + (Math.random()-0.5)*0.001; // ~±100 m
      lng = other.lng + (Math.random()-0.5)*0.001;
    }
  }

  const userRef = ref(db2, `users/${botUid}`);
  await set(userRef, {
    name: "Kontrolní bot",
    photoURL: "https://i.pravatar.cc/200?img=12",
    photos: [],
    gender: "muz",
    lat, lng,
    online: true,
    lastSeen: Date.now(),
    isDevBot: true,
    privateTo: ownerUid,
  });

  // Reakce na pingy → spáruj pár a pošli zprávu
  const inboxRef = ref(db2, `pings/${botUid}`);
  onChildAdded(inboxRef, async (snap) => {
    const data = snap.val() || {};
    const fromUid = data.from;
    if (!fromUid) return;
    const pid = pairIdOf(fromUid, botUid);

    await remove(ref(db2, `pings/${botUid}/${snap.key}`));
    await set(ref(db2, `pairs/${botUid}/${fromUid}`), true);
    await set(ref(db2, `pairs/${fromUid}/${botUid}`), true);

    await set(ref(db2, `messages/${pid}/${Date.now()}`), {
      sender: botUid,
      text: "Ahoj, testuju, že to funguje 🙂",
      type: 'text',
      createdAt: serverTimestamp(),
    });
  });

  // Keep-alive + malé chvění polohy, ať je vidět že žije
  setInterval(() => {
    const jitter = () => (Math.random()-0.5) * 0.0003; // ~±30 m
    lat += jitter(); lng += jitter();
    update(userRef, { lastSeen: Date.now(), lat, lng });
  }, 15000);

  return botUid;
}
