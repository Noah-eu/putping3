import { ref, update } from "firebase/database";
import { db } from "./firebase.js";

export function upsertPublicProfile(uid, partial){
  if(!uid) return Promise.resolve();
  // piš jen „bezpečné“ minimum
  const safe = {};
  if('name' in partial) safe.name = partial.name ?? '';
  if('gender' in partial) safe.gender = partial.gender ?? 'any';
  if('photoURL' in partial) safe.photoURL = partial.photoURL ?? '';
  if('lat' in partial) safe.lat = partial.lat ?? 0;
  if('lng' in partial) safe.lng = partial.lng ?? 0;
  safe.lastSeen = Date.now();
  return update(ref(db, `publicProfiles/${uid}`), safe);
}
