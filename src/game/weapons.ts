// DESERT STRIKE 3D - weapon registry: 17 guns + 5 knives.
// Loadout = 3 slots: [0] primary gun, [1] secondary (pistol), [2] knife.
// All stats are arcade-tuned. Holding a knife makes you faster (speedMul).

export type WeaponCat = 'primary' | 'secondary' | 'knife';

export interface WeaponSpec {
  id: string;
  name: string;
  short: string;          // compact HUD/slot name
  cat: WeaponCat;
  auto: boolean;          // hold-to-fire (semi weapons still repeat while held, slower)
  damage: number;         // per bullet (shotgun: per pellet)
  headshotMul: number;
  fireInterval: number;   // seconds between shots
  magSize: number;        // knives: 0 (never runs out)
  reloadTime: number;     // seconds
  spread: number;         // base aim dispersion (stationary, standing)
  moveSpread: number;     // extra dispersion while moving
  range: number;          // raycast distance (knives: melee reach)
  pellets: number;        // shotgun = 8, others 1
  recoil: number;         // viewmodel kick scale
  speedMul?: number;      // move-speed multiplier while held (knife = ~1.2)
  // --- viewmodel shape hints ---
  bodyLen: number;        // receiver length
  barrelLen: number;
  barrelW: number;
  stock: boolean;         // has shoulder stock
  scope: boolean;         // scope tube on top
  drum: boolean;          // box/drum magazine
  wood: boolean;          // wooden furniture (DMR)
  bladeLen?: number;      // knives: blade length
  bladeW?: number;        // knives: blade width
  bladeColor?: number;    // knives: blade tint
  zoom?: number;          // ADS (aim) FOV divider — higher = stronger zoom
}

const G = (s: Partial<WeaponSpec> & { id: string; name: string; short: string; cat: WeaponCat }): WeaponSpec => ({
  auto: false, damage: 12, headshotMul: 2, fireInterval: 0.12, magSize: 30,
  reloadTime: 1.5, spread: 0.01, moveSpread: 0.012, range: 120, pellets: 1, recoil: 0.5,
  bodyLen: 0.5, barrelLen: 0.3, barrelW: 0.024, stock: true, scope: false, drum: false, wood: false,
  ...s,
});

const K = (s: Partial<WeaponSpec> & { id: string; name: string; short: string; bladeLen: number }): WeaponSpec => ({
  ...G({ ...s, cat: 'knife' }), auto: true, magSize: 0, damage: 30, headshotMul: 1,
  fireInterval: 0.45, reloadTime: 0, spread: 0, moveSpread: 0, range: 2.6, pellets: 1, recoil: 0.3,
  bodyLen: 0.16, barrelLen: 0, barrelW: 0, stock: false, scope: false, drum: false, wood: false,
  speedMul: 1.18, bladeW: 0.045, bladeColor: 0xb8c2c8, zoom: 1,
});

export const WEAPONS: WeaponSpec[] = [
  // ---------------- SECONDARY (pistols) ----------------
  G({
    id: 'pistol', name: 'M9 SIDEARM', short: 'M9', cat: 'secondary',
    damage: 16, fireInterval: 0.17, magSize: 12, reloadTime: 1.15,
    spread: 0.009, range: 90, recoil: 0.45,
    bodyLen: 0.26, barrelLen: 0.12, barrelW: 0.020, stock: false, zoom: 1.15,
  }),
  G({
    id: 'glock', name: 'GLOCK-18', short: 'G18', cat: 'secondary', auto: true,
    damage: 9, fireInterval: 0.062, magSize: 20, reloadTime: 1.3,
    spread: 0.016, moveSpread: 0.014, range: 70, recoil: 0.32,
    bodyLen: 0.24, barrelLen: 0.10, barrelW: 0.018, stock: false, zoom: 1.15,
  }),
  G({
    id: 'deagle', name: 'DESERT EAGLE', short: 'DEAGLE', cat: 'secondary',
    damage: 42, fireInterval: 0.42, magSize: 7, reloadTime: 1.7,
    spread: 0.007, moveSpread: 0.02, range: 110, recoil: 1.15,
    bodyLen: 0.30, barrelLen: 0.15, barrelW: 0.024, stock: false, zoom: 1.2,
  }),
  // ---------------- PRIMARY ----------------
  G({
    id: 'smg', name: 'MP5 SMG', short: 'MP5', cat: 'primary', auto: true,
    damage: 9, fireInterval: 0.075, magSize: 32, reloadTime: 1.4,
    spread: 0.014, moveSpread: 0.012, range: 75, recoil: 0.38,
    bodyLen: 0.36, barrelLen: 0.18, barrelW: 0.022, zoom: 1.2,
  }),
  G({
    id: 'ump', name: 'UMP-45', short: 'UMP', cat: 'primary', auto: true,
    damage: 13, fireInterval: 0.092, magSize: 25, reloadTime: 1.55,
    spread: 0.013, moveSpread: 0.013, range: 85, recoil: 0.44,
    bodyLen: 0.38, barrelLen: 0.16, barrelW: 0.026, zoom: 1.2,
  }),
  G({
    id: 'vector', name: 'VECTOR', short: 'VECTOR', cat: 'primary', auto: true,
    damage: 7, fireInterval: 0.05, magSize: 33, reloadTime: 1.35,
    spread: 0.012, moveSpread: 0.011, range: 70, recoil: 0.26,
    bodyLen: 0.34, barrelLen: 0.14, barrelW: 0.02, zoom: 1.18,
  }),
  G({
    id: 'shotgun', name: 'M870 SHOTGUN', short: 'M870', cat: 'primary',
    damage: 9, headshotMul: 1.6, fireInterval: 0.82, magSize: 6, reloadTime: 2.4,
    spread: 0.05, moveSpread: 0.012, range: 32, pellets: 8, recoil: 1.05,
    bodyLen: 0.44, barrelLen: 0.34, barrelW: 0.030, wood: true, zoom: 1.15,
  }),
  G({
    id: 'm1014', name: 'M1014 AUTO-SG', short: 'M1014', cat: 'primary', auto: true,
    damage: 7, headshotMul: 1.6, fireInterval: 0.38, magSize: 8, reloadTime: 2.9,
    spread: 0.055, moveSpread: 0.014, range: 30, pellets: 8, recoil: 0.9,
    bodyLen: 0.46, barrelLen: 0.32, barrelW: 0.030, zoom: 1.15,
  }),
  G({
    id: 'rifle', name: 'M4A1 RIFLE', short: 'M4A1', cat: 'primary', auto: true,
    damage: 12, fireInterval: 0.105, magSize: 30, reloadTime: 1.5,
    spread: 0.009, moveSpread: 0.013, range: 120, recoil: 0.52,
    bodyLen: 0.5, barrelLen: 0.32, zoom: 1.3,
  }),
  G({
    id: 'ak47', name: 'AK-47', short: 'AK-47', cat: 'primary', auto: true,
    damage: 16, fireInterval: 0.115, magSize: 30, reloadTime: 1.7,
    spread: 0.012, moveSpread: 0.017, range: 125, recoil: 0.78,
    bodyLen: 0.52, barrelLen: 0.34, wood: true, zoom: 1.3,
  }),
  G({
    id: 'scar', name: 'SCAR-H', short: 'SCAR-H', cat: 'primary', auto: true,
    damage: 18, fireInterval: 0.13, magSize: 25, reloadTime: 1.8,
    spread: 0.008, moveSpread: 0.015, range: 135, recoil: 0.72,
    bodyLen: 0.54, barrelLen: 0.36, zoom: 1.35,
  }),
  G({
    id: 'dmr', name: 'MK14 DMR', short: 'MK14', cat: 'primary',
    damage: 34, fireInterval: 0.34, magSize: 12, reloadTime: 2.0,
    spread: 0.004, moveSpread: 0.02, range: 170, recoil: 0.85,
    bodyLen: 0.6, barrelLen: 0.4, scope: true, wood: true, zoom: 2.4,
  }),
  G({
    id: 'svd', name: 'SVD DRAGUNOV', short: 'SVD', cat: 'primary',
    damage: 38, fireInterval: 0.42, magSize: 10, reloadTime: 2.2,
    spread: 0.0045, moveSpread: 0.022, range: 180, recoil: 0.95,
    bodyLen: 0.64, barrelLen: 0.46, scope: true, wood: true, zoom: 2.8,
  }),
  G({
    id: 'lmg', name: 'M249 LMG', short: 'M249', cat: 'primary', auto: true,
    damage: 11, fireInterval: 0.088, magSize: 80, reloadTime: 3.4,
    spread: 0.02, moveSpread: 0.02, range: 130, recoil: 0.6,
    bodyLen: 0.56, barrelLen: 0.4, barrelW: 0.028, drum: true, zoom: 1.25,
  }),
  G({
    id: 'rpk', name: 'RPK-74', short: 'RPK', cat: 'primary', auto: true,
    damage: 14, fireInterval: 0.105, magSize: 60, reloadTime: 3.0,
    spread: 0.018, moveSpread: 0.021, range: 135, recoil: 0.66,
    bodyLen: 0.58, barrelLen: 0.44, drum: true, wood: true, zoom: 1.25,
  }),
  G({
    id: 'kar98', name: 'KAR98K', short: 'KAR98', cat: 'primary',
    damage: 68, fireInterval: 1.15, magSize: 5, reloadTime: 2.5,
    spread: 0.0016, moveSpread: 0.03, range: 230, recoil: 1.1,
    bodyLen: 0.62, barrelLen: 0.48, wood: true, zoom: 3.6,
  }),
  G({
    id: 'sniper', name: 'AWM SNIPER', short: 'AWM', cat: 'primary',
    damage: 82, fireInterval: 1.3, magSize: 5, reloadTime: 2.7,
    spread: 0.0012, moveSpread: 0.03, range: 250, recoil: 1.25,
    bodyLen: 0.66, barrelLen: 0.5, barrelW: 0.026, scope: true, zoom: 4.5,
  }),
  // ---------------- KNIVES (faster movement while held) ----------------
  K({ id: 'knife', name: 'TACTICAL KNIFE', short: 'KNIFE', bladeLen: 0.26, damage: 30, fireInterval: 0.42, speedMul: 1.2 }),
  K({ id: 'karambit', name: 'KARAMBIT', short: 'KARAMBIT', bladeLen: 0.17, bladeW: 0.05, bladeColor: 0x7fa8b8, damage: 38, fireInterval: 0.36, range: 2.2, speedMul: 1.24 }),
  K({ id: 'bowie', name: 'BOWIE KNIFE', short: 'BOWIE', bladeLen: 0.34, bladeW: 0.06, bladeColor: 0xc8b090, damage: 55, fireInterval: 0.62, range: 3.0, speedMul: 1.14 }),
  K({ id: 'machete', name: 'MACHETE', short: 'MACHETE', bladeLen: 0.44, bladeW: 0.07, bladeColor: 0xa8b0a0, damage: 62, fireInterval: 0.7, range: 3.2, speedMul: 1.12 }),
  K({ id: 'butterfly', name: 'BUTTERFLY KNIFE', short: 'BFLY', bladeLen: 0.22, bladeW: 0.04, bladeColor: 0xd0c8e0, damage: 34, fireInterval: 0.32, speedMul: 1.26 }),
];

export const DEFAULT_PRIMARY = findWeapon('rifle');   // M4A1
export const DEFAULT_SECONDARY = findWeapon('pistol'); // M9
export const DEFAULT_KNIFE = findWeapon('knife');      // tactical knife
export const DEFAULT_WEAPON = DEFAULT_PRIMARY; // legacy

/** gun ladder for GUN GAME mode (10 kills, one weapon each) */
export const GUN_GAME_LADDER = ['pistol', 'smg', 'ump', 'shotgun', 'rifle', 'ak47', 'scar', 'dmr', 'lmg', 'sniper'].map(findWeapon);

/** BR loot gun indexes (LootKind w1..w12 -> these WEAPONS indexes) */
export const LOOT_GUNS = ['pistol', 'smg', 'shotgun', 'rifle', 'ak47', 'lmg', 'sniper', 'scar', 'ump', 'svd', 'm1014', 'deagle'].map(findWeapon);
/** BR knife loot (LootKind k1..k5 -> these WEAPONS indexes) */
export const LOOT_KNIVES = ['knife', 'karambit', 'bowie', 'machete', 'butterfly'].map(findWeapon);

export function weaponBySlot(i: number): WeaponSpec {
  return WEAPONS[((i % WEAPONS.length) + WEAPONS.length) % WEAPONS.length];
}

export function findWeapon(id: string): number {
  const i = WEAPONS.findIndex(w => w.id === id);
  return i < 0 ? DEFAULT_PRIMARY : i;
}
