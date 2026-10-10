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
  gunGameTime: 420,     // 7 minutes (10-kill ladder)
  // duel
  duelRounds: 3,        // first to 3 round wins
  duelRespawn: 2.2,     // seconds between duel rounds
  // battle royale
  brArena: 170,         // warzone map size
  brAllies: 2,          // allied bots on player's squad
  brEnemySquads: 4,     // enemy squads
  brSquadSize: 3,       // bots per enemy squad
  brPlaneY: 130,        // plane altitude
  brZoneStart: 82,      // initial zone radius
  brZoneMin: 12,        // final zone radius
  brZonePhaseSec: 55,   // seconds per shrink phase
  brZoneHoldSec: 20,    // hold between phases
  brLootCount: 150,     // loot spawns on the warzone map (far more items than any other mode)
  brDmgBase: 5,         // zone dps at phase 0
};

/** offline game modes (online play is always deathmatch) */
export type GameMode = 'dm' | 'tdm' | 'survival' | 'gun' | 'duel' | 'br';
export const MODE_LABEL: Record<GameMode, string> = {
  dm: 'DEATHMATCH',
  tdm: 'TEAM DEATHMATCH',
  survival: 'SURVIVAL',
  gun: 'GUN GAME',
  duel: 'DUEL',
  br: 'BATTLE ROYALE',
};

/** playable maps (battle royale always uses 'warzone') */
export type MapId = 'outpost' | 'urban' | 'oasis';
export const MAP_LABEL: Record<MapId, string> = {
  outpost: 'DESERT OUTPOST',
  urban: 'URBAN BLOCKS',
  oasis: 'DRY OASIS',
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

/** safe-zone circle (battle royale) — bots & clients receive a subset of this */
export type ZoneInfo = { cx: number; cz: number; r: number; phase: number };

/** loot entry sent to clients at match init: [id, kind, x, y, z] */
export type LootInit = [number, LootKind, number, number, number];

// ---- Network protocol (PeerJS, host authoritative) ----
export type ClientMsg =
  | { t: 'hi'; name: string }
  | { t: 'st'; p: Vec3Arr; y: number; x: number; m: 0 | 1; s: 0 | 1; hp: number } // pos, yaw, pitch, moving, shooting
  | { t: 'hit'; tg: string; hs: 0 | 1; o: Vec3Arr; d: Vec3Arr }
  | { t: 'loot'; i: number } // BR: client picked up loot id
  | { t: 'bye' };

export type SnapPlayer = { i: string; p: Vec3Arr; y: number; x: number; m: 0 | 1; s: 0 | 1; hp: number; n: string };
export type SnapBot = { i: string; p: Vec3Arr; y: number; hp: number; st: number };
export type HostMsg =
  | { t: 'init'; id: string; cfg: { bots: number; diff: Difficulty; mode?: GameMode; map?: MapId; loot?: LootInit[] }; tm: number; sc: Record<string, [number, number]>; names: Record<string, string> }
  | { t: 'snap'; tm: number; pl: SnapPlayer[]; bt: SnapBot[]; sc: Record<string, [number, number]>; zn?: [number, number, number, number] } // cx,cz,r,phase
  | { t: 'ev'; k: 'kill'; v: string; b: string; hs: boolean } // victim, by
  | { t: 'ev'; k: 'spawn'; i: string; p: Vec3Arr }
  | { t: 'ev'; k: 'dmg'; i: string; amt: number }
  | { t: 'ev'; k: 'loot'; i: number } // BR: loot id was taken
  | { t: 'ev'; k: 'end'; board: [string, string, number, number][] } // [id, name, kills, deaths]
  | { t: 'ev'; k: 'start'; cfg: { bots: number; diff: Difficulty; mode?: GameMode; map?: MapId } };

/** BR loot kinds: weapon slots w1..w12 (see LOOT_GUNS in weapons.ts), knives k1..k5 (LOOT_KNIVES) plus supplies */
export type LootKind = 'w1' | 'w2' | 'w3' | 'w4' | 'w5' | 'w6' | 'w7' | 'w8' | 'w9' | 'w10' | 'w11' | 'w12'
  | 'k1' | 'k2' | 'k3' | 'k4' | 'k5' | 'ammo' | 'med' | 'vest';

export const LOOT_LABEL: Record<LootKind, string> = {
  w1: 'M9 SIDEARM', w2: 'MP5 SMG', w3: 'M870 SHOTGUN', w4: 'M4A1 RIFLE',
  w5: 'AK-47', w6: 'M249 LMG', w7: 'AWM SNIPER', w8: 'SCAR-H',
  w9: 'UMP-45', w10: 'SVD DRAGUNOV', w11: 'M1014 AUTO-SG', w12: 'DESERT EAGLE',
  k1: 'TACTICAL KNIFE', k2: 'KARAMBIT', k3: 'BOWIE KNIFE', k4: 'MACHETE', k5: 'BUTTERFLY KNIFE',
  ammo: 'AMMO BOX', med: 'MEDKIT +50', vest: 'ARMOR VEST',
};

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
