// DESERT STRIKE 3D - weapon registry: 13 guns + 4 melee weapons
// Slots: player carries a 3-slot loadout (knife / primary / backup).
// All stats are arcade-tuned. Melee weapons grant a movement speed boost.

export interface WeaponSpec {
  id: string;
  name: string;
  auto: boolean;          // hold-to-fire (semi weapons still repeat while held, slower)
  melee?: boolean;        // knife/machete: short-range swing, no ammo
  damage: number;         // per bullet (shotgun: per pellet)
  headshotMul: number;
  fireInterval: number;   // seconds between shots
  magSize: number;
  reloadTime: number;     // seconds
  spread: number;         // base aim dispersion (stationary, standing)
  moveSpread: number;     // extra dispersion while moving
  range: number;          // raycast distance
  pellets: number;        // shotgun = 8, others 1
  recoil: number;         // viewmodel kick scale
  speedBoost?: number;    // movement multiplier while this weapon is held (melee)
  // --- viewmodel shape hints ---
  bodyLen: number;        // receiver length
  barrelLen: number;
  barrelW: number;
  stock: boolean;         // has shoulder stock
  scope: boolean;         // scope tube on top
  drum: boolean;          // box/drum magazine
  wood: boolean;          // wooden furniture (DMR)
  zoom?: number;          // ADS (aim) FOV divider — higher = stronger zoom
}

// ---- melee (slots 0-3) ----
const KNIVES: WeaponSpec[] = [
  {
    id: 'knife', name: 'COMBAT KNIFE', auto: false, melee: true,
    damage: 55, headshotMul: 1.6, fireInterval: 0.42, magSize: 0, reloadTime: 0,
    spread: 0, moveSpread: 0, range: 2.4, pellets: 1, recoil: 0.5, speedBoost: 1.24,
    bodyLen: 0.16, barrelLen: 0, barrelW: 0, stock: false, scope: false, drum: false, wood: false, zoom: 1.1,
  },
  {
    id: 'karambit', name: 'KARAMBIT', auto: false, melee: true,
    damage: 44, headshotMul: 1.6, fireInterval: 0.3, magSize: 0, reloadTime: 0,
    spread: 0, moveSpread: 0, range: 2.1, pellets: 1, recoil: 0.4, speedBoost: 1.3,
    bodyLen: 0.13, barrelLen: 0, barrelW: 0, stock: false, scope: false, drum: false, wood: false, zoom: 1.1,
  },
  {
    id: 'machete', name: 'MACHETE', auto: false, melee: true,
    damage: 74, headshotMul: 1.5, fireInterval: 0.66, magSize: 0, reloadTime: 0,
    spread: 0, moveSpread: 0, range: 2.7, pellets: 1, recoil: 0.7, speedBoost: 1.16,
    bodyLen: 0.24, barrelLen: 0, barrelW: 0, stock: false, scope: false, drum: false, wood: false, zoom: 1.1,
  },
  {
    id: 'katana', name: 'KATANA', auto: false, melee: true,
    damage: 92, headshotMul: 1.5, fireInterval: 0.85, magSize: 0, reloadTime: 0,
    spread: 0, moveSpread: 0, range: 3.0, pellets: 1, recoil: 0.85, speedBoost: 1.12,
    bodyLen: 0.3, barrelLen: 0, barrelW: 0, stock: false, scope: false, drum: false, wood: true, zoom: 1.1,
  },
];

// ---- guns (slots 4-16) ----
const GUNS: WeaponSpec[] = [
  {
    id: 'pistol', name: 'M9 SIDEARM', auto: false,
    damage: 16, headshotMul: 2, fireInterval: 0.17, magSize: 12, reloadTime: 1.15,
    spread: 0.009, moveSpread: 0.012, range: 90, pellets: 1, recoil: 0.45,
    bodyLen: 0.26, barrelLen: 0.12, barrelW: 0.020, stock: false, scope: false, drum: false, wood: false, zoom: 1.15,
  },
  {
    id: 'deagle', name: 'DESERT EAGLE', auto: false,
    damage: 38, headshotMul: 2, fireInterval: 0.42, magSize: 7, reloadTime: 1.6,
    spread: 0.006, moveSpread: 0.02, range: 110, pellets: 1, recoil: 1.0,
    bodyLen: 0.3, barrelLen: 0.16, barrelW: 0.024, stock: false, scope: false, drum: false, wood: false, zoom: 1.2,
  },
  {
    id: 'mp5', name: 'MP5 SMG', auto: true,
    damage: 9, headshotMul: 2, fireInterval: 0.075, magSize: 32, reloadTime: 1.4,
    spread: 0.014, moveSpread: 0.012, range: 75, pellets: 1, recoil: 0.38,
    bodyLen: 0.36, barrelLen: 0.18, barrelW: 0.022, stock: true, scope: false, drum: false, wood: false, zoom: 1.2,
  },
  {
    id: 'ump', name: 'UMP-45 SMG', auto: true,
    damage: 12, headshotMul: 2, fireInterval: 0.098, magSize: 25, reloadTime: 1.55,
    spread: 0.013, moveSpread: 0.011, range: 85, pellets: 1, recoil: 0.44,
    bodyLen: 0.38, barrelLen: 0.2, barrelW: 0.024, stock: true, scope: false, drum: false, wood: false, zoom: 1.22,
  },
  {
    id: 'vector', name: 'VECTOR SMG', auto: true,
    damage: 8, headshotMul: 2, fireInterval: 0.052, magSize: 33, reloadTime: 1.3,
    spread: 0.016, moveSpread: 0.012, range: 70, pellets: 1, recoil: 0.3,
    bodyLen: 0.34, barrelLen: 0.15, barrelW: 0.022, stock: true, scope: false, drum: false, wood: false, zoom: 1.18,
  },
  {
    id: 'shotgun', name: 'M870 SHOTGUN', auto: false,
    damage: 9, headshotMul: 1.6, fireInterval: 0.82, magSize: 6, reloadTime: 2.4,
    spread: 0.05, moveSpread: 0.012, range: 32, pellets: 8, recoil: 1.05,
    bodyLen: 0.44, barrelLen: 0.34, barrelW: 0.030, stock: true, scope: false, drum: false, wood: true, zoom: 1.15,
  },
  {
    id: 'rifle', name: 'M4A1 RIFLE', auto: true,
    damage: 12, headshotMul: 2, fireInterval: 0.105, magSize: 30, reloadTime: 1.5,
    spread: 0.009, moveSpread: 0.013, range: 120, pellets: 1, recoil: 0.52,
    bodyLen: 0.5, barrelLen: 0.32, barrelW: 0.024, stock: true, scope: false, drum: false, wood: false, zoom: 1.3,
  },
  {
    id: 'ak', name: 'AK-47 RIFLE', auto: true,
    damage: 15, headshotMul: 2, fireInterval: 0.118, magSize: 30, reloadTime: 1.7,
    spread: 0.012, moveSpread: 0.017, range: 125, pellets: 1, recoil: 0.78,
    bodyLen: 0.52, barrelLen: 0.34, barrelW: 0.026, stock: true, scope: false, drum: false, wood: true, zoom: 1.28,
  },
  {
    id: 'famas', name: 'FAMAS RIFLE', auto: true,
    damage: 13, headshotMul: 2, fireInterval: 0.088, magSize: 24, reloadTime: 1.6,
    spread: 0.010, moveSpread: 0.015, range: 120, pellets: 1, recoil: 0.58,
    bodyLen: 0.48, barrelLen: 0.3, barrelW: 0.024, stock: true, scope: false, drum: false, wood: false, zoom: 1.3,
  },
  {
    id: 'dmr', name: 'MK14 DMR', auto: false,
    damage: 34, headshotMul: 2, fireInterval: 0.34, magSize: 12, reloadTime: 2.0,
    spread: 0.004, moveSpread: 0.02, range: 170, pellets: 1, recoil: 0.85,
    bodyLen: 0.6, barrelLen: 0.4, barrelW: 0.024, stock: true, scope: true, drum: false, wood: true, zoom: 2.4,
  },
  {
    id: 'lmg', name: 'M249 LMG', auto: true,
    damage: 11, headshotMul: 2, fireInterval: 0.088, magSize: 80, reloadTime: 3.4,
    spread: 0.02, moveSpread: 0.02, range: 130, pellets: 1, recoil: 0.6,
    bodyLen: 0.56, barrelLen: 0.4, barrelW: 0.028, stock: true, scope: false, drum: true, wood: false, zoom: 1.25,
  },
  {
    id: 'kar98', name: 'KAR98K SNIPER', auto: false,
    damage: 68, headshotMul: 2.2, fireInterval: 1.15, magSize: 5, reloadTime: 2.4,
    spread: 0.002, moveSpread: 0.03, range: 220, pellets: 1, recoil: 1.1,
    bodyLen: 0.62, barrelLen: 0.46, barrelW: 0.024, stock: true, scope: false, drum: false, wood: true, zoom: 3.0,
  },
  {
    id: 'sniper', name: 'AWM SNIPER', auto: false,
    damage: 82, headshotMul: 2, fireInterval: 1.3, magSize: 5, reloadTime: 2.7,
    spread: 0.0012, moveSpread: 0.03, range: 250, pellets: 1, recoil: 1.25,
    bodyLen: 0.66, barrelLen: 0.5, barrelW: 0.026, stock: true, scope: true, drum: false, wood: false, zoom: 4.5,
  },
];

export const WEAPONS: WeaponSpec[] = [...KNIVES, ...GUNS];

/** weapon ids by role for the loadout picker */
export const KNIFE_INDEXES = KNIVES.map((_, i) => i);
export const PRIMARY_INDEXES = GUNS.map((_, i) => KNIVES.length + i);
export const BACKUP_INDEXES = [4, 5, 6, 7, 8]; // pistols + SMGs (gun indexes in WEAPONS)

export const DEFAULT_KNIFE = 0;                       // COMBAT KNIFE
export const DEFAULT_PRIMARY = 10;                      // M4A1 (first gun index is 4)
export const DEFAULT_BACKUP = 4;                      // M9

/** index into WEAPONS the player starts with */
export const DEFAULT_WEAPON = DEFAULT_PRIMARY;

/** weapon ladder for GUN GAME mode (all 13 guns, index into WEAPONS) */
export const GUN_GAME_LADDER = PRIMARY_INDEXES;

/** guns that spawn as battle-royale ground loot (w1..w13 -> these indexes) */
export const BR_LOOT_GUNS = [
  4,  // M9
  6,  // MP5
  7,  // UMP-45
  8,  // VECTOR
  9,  // M870
  10, // M4A1
  11, // AK-47
  12, // FAMAS
  13, // MK14 DMR
  14, // M249 LMG
  15, // KAR98K
  16, // AWM
  5,  // DESERT EAGLE
];

export function weaponBySlot(i: number): WeaponSpec {
  return WEAPONS[((i % WEAPONS.length) + WEAPONS.length) % WEAPONS.length];
}

export function isMelee(i: number): boolean {
  return !!WEAPONS[i]?.melee;
}
