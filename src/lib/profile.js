export function getLocalProfile() {
  try {
    const raw = localStorage.getItem("pp_profile");
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (p && typeof p === "object") return p;
  } catch (_) {}
  return null;
}

export function saveLocalProfile(p) {
  try {
    localStorage.setItem("pp_profile", JSON.stringify(p || {}));
  } catch (_) {}
}

export function ensureUid(p) {
  if (!p) p = {};
  if (!p.uid) p.uid = "pp-" + Date.now().toString(36);
  return p;
}

