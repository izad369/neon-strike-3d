// DESERT STRIKE 3D - shared constants & types
export const CFG = {
  arena: 80, // square arena size
  wallH: 5,
  gravity: 22,
  jumpVel: 7.6,
  walkSpeed: 6.2,
  sprintSpeed: 9.2,
  playerHeight: 1.7,
  playerRadius: 0.42,
  eyeHeight: 1.62,
  fireInterval: 0.11, // seconds between shots
  magSize: 30,
  reloadTime: 1.5,
  damage: 12,
  headshotMul: 2,
  range: 120,
  botDamage: 7,
  botHp: 100,
  playerHp: 100,
  respawnDelay: 3,
  regenDelay: 5,
  regenRate: 12,
  matchTime: 300, // 5 minutes
  targetKills: 25,
  snapRate: 12, // online snapshots per second
  inputRate: 20, // online input sends per second
  // crouch
  crouchEye: 0.95,
  crouchHeight: 1.15,
  crouchSpeedMul: 0.55,
  crouchSpreadMul: 0.6,
  eyeLerp: 9, // eye-height lerp speed (per second)
  // aim down sights (ADS)
  baseFov: 75,
  aimSpeedMul: 0.62,  // move speed while aiming
  aimSpreadMul: 0.45, // fire dispersion while aiming
  aimSensMul: 0.62,   // look sensitivity while aiming
  aimLerp: 12,        // aim blend speed (per second)
  // modes
  tdmTargetKills: 40,   // team kill target
  survivalStartBots: 3, // wave 1 bot count
  survivalPerWave: 1,   // bots added per wave
  survivalMaxAlive: 9,  // concurrent bots cap
  survivalIntermission: 5, // seconds between waves
  gunGameTime: 360,     // 6 minutes
};

/** offline game modes (online play is always deathmatch) */
export type GameMode = 'dm' | 'tdm' | 'survival' | 'gun';
export const MODE_LABEL: Record<GameMode, string> = {
  dm: 'DEATHMATCH',
  tdm: 'TEAM DEATHMATCH',
  survival: 'SURVIVAL',
  gun: 'GUN GAME',
};

export const COLORS = {
  // desert-military palette (keys kept for compatibility)
  cyan: 0xbfa46f,      // generic sand-tan accent
  magenta: 0x8a6d3b,   // dark khaki accent
  purple: 0x6b7a53,    // olive accent
  green: 0x7d8f4e,     // olive drab
  orange: 0xd98e32,    // desert orange
  red: 0xd23c2a,       // military red (danger)
  yellow: 0xe6c35c,    // amber
  dark: 0x1c1812,      // dark brown (menus boot)
  sky: 0xd8caa2,       // hazy desert sky
  floorGrid: 0xb3a077, // darker sand lines
  wallBase: 0xa5946f,  // adobe/mud walls
};

export const BOT_NAMES = [
  'VIPER', 'RAVEN', 'GHOST', 'TITAN', 'COBRA', 'HAWK', 'RECON', 'SARGE',
  'DIESEL', 'BRONCO', 'SABER', 'WOLF', 'MAVERICK', 'TOMBSTONE',
];

export type Difficulty = 'easy' | 'medium' | 'hard';

export const DIFFICULTY: Record<Difficulty, {
  spread: number; reaction: number; fireInterval: number; burst: number;
  moveSpeed: number; dmg: number; vision: number;
}> = {
  easy:   { spread: 0.075, reaction: 0.65, fireInterval: 0.24, burst: 3, moveSpeed: 4.4, dmg: 0.7, vision: 34 },
  medium: { spread: 0.042, reaction: 0.4,  fireInterval: 0.17, burst: 4, moveSpeed: 5.4, dmg: 1.0, vision: 46 },
  hard:   { spread: 0.02,  reaction: 0.22, fireInterval: 0.12, burst: 6, moveSpeed: 6.4, dmg: 1.3, vision: 60 },
};

export type Vec3Arr = [number, number, number];

// ---- Network protocol (PeerJS, host authoritative) ----
export type ClientMsg =
  | { t: 'hi'; name: string }
  | { t: 'st'; p: Vec3Arr; y: number; x: number; m: 0 | 1; s: 0 | 1; hp: number } // pos, yaw, pitch, moving, shooting
  | { t: 'hit'; tg: string; hs: 0 | 1; o: Vec3Arr; d: Vec3Arr }
  | { t: 'bye' };

export type SnapPlayer = { i: string; p: Vec3Arr; y: number; x: number; m: 0 | 1; s: 0 | 1; hp: number; n: string };
export type SnapBot = { i: string; p: Vec3Arr; y: number; hp: number; st: number };
export type HostMsg =
  | { t: 'init'; id: string; cfg: { bots: number; diff: Difficulty }; tm: number; sc: Record<string, [number, number]>; names: Record<string, string> }
  | { t: 'snap'; tm: number; pl: SnapPlayer[]; bt: SnapBot[]; sc: Record<string, [number, number]> }
  | { t: 'ev'; k: 'kill'; v: string; b: string; hs: boolean } // victim, by
  | { t: 'ev'; k: 'spawn'; i: string; p: Vec3Arr }
  | { t: 'ev'; k: 'dmg'; i: string; amt: number }
  | { t: 'ev'; k: 'end'; board: [string, string, number, number][] } // [id, name, kills, deaths]
  | { t: 'ev'; k: 'start'; cfg: { bots: number; diff: Difficulty } };

export const NET_PREFIX = 'ns3d-match-';

export function makeRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function fmtTime(sec: number): string {
  const m = Math.floor(Math.max(0, sec) / 60);
  const s = Math.floor(Math.max(0, sec) % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
