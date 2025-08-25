import { getDatabase, ref, set, update, onChildAdded, serverTimestamp, get } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import { initSecondaryApp } from "./firebase.js";

function pairIdOf(a,b){ return a<b ? `${a}_${b}` : `${b}_${a}`; }

// Zapisuje veřejné minimum do /publicProfiles/<uid>
function upsertPublicProfile(db, uid, partial) {
  if (!uid) return Promise.resolve();
  const safe = {};
  if ('name' in partial)     safe.name     = partial.name ?? '';
  if ('gender' in partial)   safe.gender   = partial.gender ?? 'any';
  if ('photoURL' in partial) safe.photoURL = partial.photoURL ?? '';
  if ('lat' in partial)      safe.lat      = Number(partial.lat) || 0;
  if ('lng' in partial)      safe.lng      = Number(partial.lng) || 0;
  safe.lastSeen = Date.now();
  return update(ref(db, `publicProfiles/${uid}`), safe);
}

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
      .sort((a,b)=> (b.lastActive||0) - (a.lastActive||0));
    const other = users.find(u => u.uid !== botUid);
    if (other?.lat && other?.lng){
      lat = other.lat + (Math.random()-0.5)*0.001; // ~±100 m
      lng = other.lng + (Math.random()-0.5)*0.001;
    }
  }

  const botName = "Kontrolní bot";
  const botPhotoURL = "https://i.pravatar.cc/200?img=12";
  const botGender = "any";

  const userRef = ref(db2, `users/${botUid}`);
  await set(userRef, {
    name: botName,
    photoURL: botPhotoURL,
    photos: [],
    gender: "muz",
    lat, lng,
    online: true,
    lastActive: Date.now(),
    isDevBot: true,
    privateTo: ownerUid,
  });

  await upsertPublicProfile(db2, botUid, {
    name: botName || 'Kontrolní bot',
    gender: botGender || 'any',
    photoURL: botPhotoURL || '',
    lat, lng,
  });

  // Reakce na pingy → spáruj pár a pošli zprávu
  const inboxRef = ref(db2, `pings/${botUid}`);
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

  // Keep-alive + malé chvění polohy, ať je vidět že žije
  setInterval(() => {
    const jitter = () => (Math.random()-0.5) * 0.0003; // ~±30 m
    lat += jitter(); lng += jitter();
    update(userRef, { lastActive: Date.now(), lat, lng });
  }, 15000);

  return botUid;
}
