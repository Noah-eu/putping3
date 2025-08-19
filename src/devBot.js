import { getDatabase, ref, set, update, onChildAdded, serverTimestamp, get, remove, push } from "firebase/database";
import { getAuth, signInAnonymously } from "firebase/auth";
import { initSecondaryApp } from "./firebase.js";

function pairIdOf(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

export async function spawnDevBot() {
  const botApp = initSecondaryApp("dev-bot");
  const botDb = getDatabase(botApp);
  const botAuth = getAuth(botApp);

  const cred = await signInAnonymously(botAuth);
  const botUid = cred.user.uid;

  const photos = [
    "https://placekitten.com/200/200",
    "https://placekitten.com/201/200",
  ];

  let lat = 50.087;
  let lng = 14.421;
  const userRef = ref(botDb, `users/${botUid}`);
  await set(userRef, {
    name: "Kontrolní bot",
    photos,
    photoURL: photos[0],
    online: true,
    lastActive: Date.now(),
    lat,
    lng,
  });

  const inboxRef = ref(botDb, `pings/${botUid}`);
  onChildAdded(inboxRef, async (snap) => {
    const fromUid = snap.key;
    const pid = pairIdOf(fromUid, botUid);

    await set(ref(botDb, `pairPings/${pid}/${botUid}`), serverTimestamp());
    const otherSnap = await get(ref(botDb, `pairPings/${pid}/${fromUid}`));
    if (otherSnap.exists()) {
      await set(ref(botDb, `pairs/${pid}`), true);
      await push(ref(botDb, `messages/${pid}`), {
        from: botUid,
        text: "Ahoj, test!",
        time: serverTimestamp(),
      });
    }
    await remove(ref(botDb, `pings/${botUid}/${fromUid}`));
  });

  setInterval(() => {
    const jitter = () => {
      const meters = 20 + Math.random() * 30; // 20-50 m
      const deg = meters / 111000;
      return (Math.random() < 0.5 ? -1 : 1) * deg;
    };
    lat += jitter();
    lng += jitter();
    update(userRef, {
      lastActive: Date.now(),
      lat,
      lng,
    });
  }, 15000);

  return botUid;
}
