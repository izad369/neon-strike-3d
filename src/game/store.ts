// DESERT STRIKE 3D — tiny persistent key/value store.
//
// In the Android APK the page origin changes on EVERY launch (the embedded
// asset server binds an ephemeral port: http://127.0.0.1:<random>), so
// localStorage there never survives a restart even when DOM storage is on —
// this was the "player name is forgotten" bug. APK v4.0 therefore exposes a
// native SharedPreferences bridge:
//   AndroidBridge.nsSave(key, value)  /  AndroidBridge.nsLoad(key)
// Web browsers simply keep using plain localStorage.
//
// Reads prefer localStorage (fresher within a live session, where both
// stores are mirrored), then fall back to the native store. Writes go to
// both, so whichever survives carries the data forward.

type Bridge = { nsLoad?: (k: string) => string | null; nsSave?: (k: string, v: string) => void };

function bridge(): Bridge | null {
  try {
    const b = (globalThis as unknown as { AndroidBridge?: Bridge }).AndroidBridge;
    if (b && typeof b.nsLoad === 'function' && typeof b.nsSave === 'function') return b;
  } catch { /* no bridge (web) */ }
  return null;
}

export function storeGet(key: string): string | null {
  try {
    const v = localStorage.getItem(key);
    if (v !== null) return v;
  } catch { /* blocked */ }
  try {
    const b = bridge();
    const load = b?.nsLoad;
    if (!load) return null;
    const v = load(key);
    return v == null ? null : String(v);
  } catch { return null; }
}

export function storeSet(key: string, value: string): void {
  try {
    const save = bridge()?.nsSave;
    if (save) save(key, value);
  } catch { /* no bridge */ }
  try { localStorage.setItem(key, value); } catch { /* blocked */ }
}

export function storeDel(key: string): void {
  // native has no delete in the bridge — empty string reads as "unset"
  try {
    const save = bridge()?.nsSave;
    if (save) save(key, '');
  } catch { /* no bridge */ }
  try { localStorage.removeItem(key); } catch { /* blocked */ }
}
