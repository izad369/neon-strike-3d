// DESERT STRIKE 3D - weapon registry: 7 guns with distinct handling
// All stats are arcade-tuned. Player carries every weapon and can swap freely.

export interface WeaponSpec {
  id: string;
  name: string;
  auto: boolean;          // hold-to-fire (semi weapons still repeat while held, slower)
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
  // --- viewmodel shape hints ---
  bodyLen: number;        // receiver length
  barrelLen: number;
  barrelW: number;
  stock: boolean;         // has shoulder stock
  scope: boolean;         // scope tube on top
  drum: boolean;          // box/drum magazine
  wood: boolean;          // wooden furniture (DMR)
}

export const WEAPONS: WeaponSpec[] = [
  {
    id: 'pistol', name: 'M9 SIDEARM', auto: false,
    damage: 16, headshotMul: 2, fireInterval: 0.17, magSize: 12, reloadTime: 1.15,
    spread: 0.009, moveSpread: 0.012, range: 90, pellets: 1, recoil: 0.45,
    bodyLen: 0.26, barrelLen: 0.12, barrelW: 0.020, stock: false, scope: false, drum: false, wood: false,
  },
  {
    id: 'smg', name: 'MP5 SMG', auto: true,
    damage: 9, headshotMul: 2, fireInterval: 0.075, magSize: 32, reloadTime: 1.4,
    spread: 0.014, moveSpread: 0.012, range: 75, pellets: 1, recoil: 0.38,
    bodyLen: 0.36, barrelLen: 0.18, barrelW: 0.022, stock: true, scope: false, drum: false, wood: false,
  },
  {
    id: 'shotgun', name: 'M870 SHOTGUN', auto: false,
    damage: 9, headshotMul: 1.6, fireInterval: 0.82, magSize: 6, reloadTime: 2.4,
    spread: 0.05, moveSpread: 0.012, range: 32, pellets: 8, recoil: 1.05,
    bodyLen: 0.44, barrelLen: 0.34, barrelW: 0.030, stock: true, scope: false, drum: false, wood: true,
  },
  {
    id: 'rifle', name: 'M4A1 RIFLE', auto: true,
    damage: 12, headshotMul: 2, fireInterval: 0.105, magSize: 30, reloadTime: 1.5,
    spread: 0.009, moveSpread: 0.013, range: 120, pellets: 1, recoil: 0.52,
    bodyLen: 0.5, barrelLen: 0.32, barrelW: 0.024, stock: true, scope: false, drum: false, wood: false,
  },
  {
    id: 'dmr', name: 'MK14 DMR', auto: false,
    damage: 34, headshotMul: 2, fireInterval: 0.34, magSize: 12, reloadTime: 2.0,
    spread: 0.004, moveSpread: 0.02, range: 170, pellets: 1, recoil: 0.85,
    bodyLen: 0.6, barrelLen: 0.4, barrelW: 0.024, stock: true, scope: true, drum: false, wood: true,
  },
  {
    id: 'lmg', name: 'M249 LMG', auto: true,
    damage: 11, headshotMul: 2, fireInterval: 0.088, magSize: 80, reloadTime: 3.4,
    spread: 0.02, moveSpread: 0.02, range: 130, pellets: 1, recoil: 0.6,
    bodyLen: 0.56, barrelLen: 0.4, barrelW: 0.028, stock: true, scope: false, drum: true, wood: false,
  },
  {
    id: 'sniper', name: 'AWM SNIPER', auto: false,
    damage: 82, headshotMul: 2, fireInterval: 1.3, magSize: 5, reloadTime: 2.7,
    spread: 0.0012, moveSpread: 0.03, range: 250, pellets: 1, recoil: 1.25,
    bodyLen: 0.66, barrelLen: 0.5, barrelW: 0.026, stock: true, scope: true, drum: false, wood: false,
  },
];

export const DEFAULT_WEAPON = 3; // M4A1

/** weapon ladder for GUN GAME mode (index into WEAPONS) */
export const GUN_GAME_LADDER = [0, 1, 2, 3, 4, 5, 6];

export function weaponBySlot(i: number): WeaponSpec {
  return WEAPONS[((i % WEAPONS.length) + WEAPONS.length) % WEAPONS.length];
}
