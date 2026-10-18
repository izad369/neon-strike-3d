// DESERT STRIKE 3D — persistent career stats (per-device).
// Records every finished match (mode, kills, deaths, result) + the player name,
// shown in the menu's CAREER screen. Storage is deliberately redundant so it
// survives inside the Android APK WebView too:
//   1. localStorage (normal browsers + modern WebView)
//   2. document.cookie fallback (some WebViews disable DOM storage on file://)
//   3. in-memory (session-only last resort)
// Writes go to EVERY backend that works; reads use the first backend with data.

export interface MatchRecord {
  t: number;     // finish time (epoch ms)
  m: string;     // game mode id (dm/tdm/survival/gun/duel/br)
  k: number;     // kills
  d: number;     // deaths
  w: boolean;    // won?
  info: string;  // mode-specific note (wave reached, placement, rounds...)
}

export interface Career {
  name: string;              // last used player name
  matches: MatchRecord[];    // newest first (capped)
  games: number;
  kills: number;
  deaths: number;
  wins: number;
  bestWave: number;          // survival
  bestBr: number;            // battle royale placement (lower = better, 0 = none)
}

const KEY = 'ns_career_v1';
const COOKIE = 'ns_career_v1';
const MAX_MATCHES = 12;

export function emptyCareer(): Career {
  return { name: '', matches: [], games: 0, kills: 0, deaths: 0, wins: 0, bestWave: 0, bestBr: 0 };
}

// ---- storage backends -------------------------------------------------------

type Backend = { name: string; read: () => string | null; write: (s: string) => boolean };

function lsBackend(): Backend {
  return {
    name: 'localStorage',
    read: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
    write: (s) => { try { localStorage.setItem(KEY, s); return true; } catch { return false; } },
  };
}

function cookieBackend(): Backend {
  return {
    name: 'cookie',
    read: () => {
      try {
        const m = document.cookie.match(new RegExp('(?:^|;\\s*)' + COOKIE + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : null;
      } catch { return null; }
    },
    write: (s) => {
      try {
        document.cookie = `${COOKIE}=${encodeURIComponent(s)};max-age=31536000;path=/;SameSite=Lax`;
        return document.cookie.indexOf(COOKIE + '=') >= 0;
      } catch { return false; }
    },
  };
}

let memStore: string | null = null;
function memBackend(): Backend {
  return {
    name: 'memory',
    read: () => memStore,
    write: (s) => { memStore = s; return true; },
  };
}

// v3.11 — APK native bridge (SharedPreferences): survives the APK's
// ephemeral localhost port that resets localStorage every launch.
function nativeBackend(): Backend {
  return {
    name: 'AndroidBridge',
    read: () => {
      try {
        const b = (globalThis as unknown as { AndroidBridge?: { nsLoad?: (k: string) => string | null } }).AndroidBridge;
        const v = b?.nsLoad?.(KEY);
        return v == null || v === '' ? null : v;
      } catch { return null; }
    },
    write: (s) => {
      try {
        const b = (globalThis as unknown as { AndroidBridge?: { nsSave?: (k: string, v: string) => void } }).AndroidBridge;
        if (!b || typeof b.nsSave !== 'function') return false;
        b.nsSave(KEY, s);
        return true;
      } catch { return false; }
    },
  };
}

function backends(): Backend[] {
  const list: Backend[] = [];
  try { if (typeof localStorage !== 'undefined') list.push(lsBackend()); } catch { /* blocked */ }
  try { list.push(nativeBackend()); } catch { /* no bridge */ }
  try { if (typeof document !== 'undefined' && document.cookie !== undefined) list.push(cookieBackend()); } catch { /* blocked */ }
  list.push(memBackend());
  return list;
}

function parseCareer(raw: string | null): Career | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as Career;
    if (!c || typeof c !== 'object' || !Array.isArray(c.matches)) return null;
    // merge forward-compatible defaults
    return { ...emptyCareer(), ...c, matches: c.matches.slice(0, MAX_MATCHES) };
  } catch { return null; }
}

/** Load the stored career; prefers the backend with the most matches. */
export function loadCareer(): Career {
  let best: Career | null = null;
  for (const b of backends()) {
    const c = parseCareer(b.read());
    if (c && (!best || c.matches.length > best.matches.length || ((c.games ?? 0) > (best.games ?? 0) && c.matches.length === best.matches.length))) best = c;
  }
  return best ?? emptyCareer();
}

function persist(c: Career) {
  const s = JSON.stringify(c);
  for (const b of backends()) b.write(s);
}

/** Save the player name whenever it is used (keeps CAREER screen in sync). */
export function saveCareerName(name: string) {
  const c = loadCareer();
  if (c.name === name) return;
  c.name = name;
  persist(c);
}

/**
 * Record a finished match. Safe to call from any mode; never throws.
 * Returns the updated career (also re-persisted).
 */
export function recordMatch(name: string, mode: string, kills: number, deaths: number, won: boolean, info: string): Career {
  const c = loadCareer();
  if (name) c.name = name;
  c.games = (c.games ?? 0) + 1;
  c.kills = (c.kills ?? 0) + Math.max(0, kills | 0);
  c.deaths = (c.deaths ?? 0) + Math.max(0, deaths | 0);
  if (won) c.wins = (c.wins ?? 0) + 1;
  if (mode === 'survival') c.bestWave = Math.max(c.bestWave ?? 0, parseInt(info.replace(/\D/g, ''), 10) || 0);
  if (mode === 'br') {
    const pl = parseInt(info.replace(/\D/g, ''), 10) || 0;
    if (pl > 0) c.bestBr = c.bestBr ? Math.min(c.bestBr, pl) : pl;
  }
  c.matches.unshift({ t: Date.now(), m: mode, k: Math.max(0, kills | 0), d: Math.max(0, deaths | 0), w: !!won, info: String(info).slice(0, 40) });
  if (c.matches.length > MAX_MATCHES) c.matches.length = MAX_MATCHES;
  persist(c);
  return c;
}

/** Wipe all recorded stats but keep the player name (CAREER "Clear stats"). */
export function clearCareerStats(keepName: string): Career {
  const c = emptyCareer();
  c.name = keepName;
  persist(c);
  return c;
}

const MODE_LABEL: Record<string, string> = {
  dm: 'DEATHMATCH', tdm: 'TEAM DM', survival: 'SURVIVAL', gun: 'GUN GAME', duel: 'DUEL', br: 'BATTLE ROYALE',
};

export function modeLabel(m: string): string { return MODE_LABEL[m] ?? m.toUpperCase(); }

export function fmtWhen(t: number): string {
  try {
    const d = new Date(t);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return ''; }
}
