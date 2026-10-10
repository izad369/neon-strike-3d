// DESERT STRIKE 3D - local player: input (keyboard/mouse + touch), physics,
// shooting, 3-slot loadout (primary / secondary pistol / knife), crouch, ADS.
// Knives are melee + make you move faster (speedMul).
import * as THREE from 'three';
import { CFG, Vec3Arr } from './constants';
import { World } from './world';
import { ViewModel } from './viewmodel';
import { AudioFX } from './audio';
import { TouchInput, TOUCH_LOOK_SENS } from './touch';
import { WeaponSpec, WEAPONS, DEFAULT_PRIMARY, DEFAULT_SECONDARY, DEFAULT_KNIFE } from './weapons';

// Keyboard normalization: real browsers send e.code; synthetic/edge cases may only send e.key
const KEY_FALLBACK: Record<string, string> = {
  w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD',
  ' ': 'Space', r: 'KeyR', shift: 'ShiftLeft', tab: 'Tab', c: 'KeyC', ctrl: 'ControlLeft',
  arrowup: 'KeyW', arrowdown: 'KeyS', arrowleft: 'KeyA', arrowright: 'KeyD',
};
export function normKey(e: KeyboardEvent): string {
  if (e.code) return e.code;
  return KEY_FALLBACK[e.key.toLowerCase()] ?? e.key;
}

export interface PlayerInputState {
  yaw: number; pitch: number;
  moving: boolean; shooting: boolean;
}

export class LocalPlayer {
  pos = new THREE.Vector3(0, 0, 30);
  vel = new THREE.Vector3();
  yaw = Math.PI; pitch = 0;
  hp = CFG.playerHp;
  armor = 0;             // BR vest: absorbs 60% of incoming damage until depleted
  alive = true;
  grounded = true;
  reloading = false;
  crouching = false;
  aiming = false;        // ADS held (mouse RMB) or toggled (touch AIM button)
  private aimAmt = 0;    // smoothed 0..1 blend used for fov/spread/speed/viewmodel
  // --- 3-slot loadout: [0] primary gun, [1] secondary pistol, [2] knife ---
  // loadout[i] = index into WEAPONS; -1 = empty slot (primary starts empty in BR)
  private loadout: number[] = [DEFAULT_PRIMARY, DEFAULT_SECONDARY, DEFAULT_KNIFE];
  private mags: number[] = [0, 0, -1]; // per-slot ammo; knife = -1 (infinite)
  private slot = 0;
  private reloadEnd = 0;
  private lastFire = 0;
  private lastRegen = 0;
  private lastStep = 0;
  private curEye = CFG.eyeHeight;
  onWeaponSwitch: ((spec: WeaponSpec, slot: number) => void) | null = null;
  onSlotsChange: (() => void) | null = null;
  onCrouchChange: ((crouching: boolean) => void) | null = null;
  onAimChange: ((aiming: boolean) => void) | null = null;
  private keys = new Set<string>();
  mouseDown = false;
  sensitivity = 1;
  enabled = true; // controls active
  touch: TouchInput | null = null; // touch controls (mobile) — set by main
  vm: ViewModel;
  onShoot: ((origin: THREE.Vector3, dir: THREE.Vector3) => void) | null = null;
  onJump: (() => void) | null = null;
  onLand: (() => void) | null = null;
  private wasGrounded = true;
  parachute = false; // BR drop: terminal-velocity fall, cleared on landing

  constructor(private world: World, camera: THREE.PerspectiveCamera, private audio: AudioFX, private dom: HTMLElement) {
    this.vm = new ViewModel(camera);
    this.bindInput(dom);
  }

  private bindInput(dom: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    dom.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onContextMenu);
  }

  // ---------- weapons ----------
  get weaponIndex(): number { return this.loadout[this.slot]; }
  get currentSpec(): WeaponSpec { return WEAPONS[this.loadout[this.slot]] ?? WEAPONS[DEFAULT_PRIMARY]; }
  get ammo(): number { return this.mags[this.slot]; }
  get isKnife(): boolean { return this.currentSpec.cat === 'knife'; }
  /** names for the HUD slot chips (— when the primary slot is empty) */
  get slotNames(): [string, string, string] {
    return [0, 1, 2].map(i => this.loadout[i] < 0 ? '—' : WEAPONS[this.loadout[i]].short) as [string, string, string];
  }
  get activeSlot(): number { return this.slot; }

  /** select one of the 3 slots; empty slots are refused (soft click) */
  switchSlot(s: number, silent = false): boolean {
    const idx = ((s % 3) + 3) % 3;
    if (idx === this.slot) return true;
    if (this.loadout[idx] < 0) { this.audio.empty(); return false; } // nothing there yet (BR)
    this.slot = idx;
    this.reloading = false; // cancel reload on swap
    this.lastFire = performance.now(); // brief raise delay
    this.vm.setWeapon(WEAPONS[this.loadout[idx]]);
    if (!silent) this.audio.weaponSwitch();
    this.onWeaponSwitch?.(WEAPONS[this.loadout[idx]], idx);
    this.onSlotsChange?.();
    return true;
  }

  cycleSlot(dir = 1) {
    // cycle only over usable slots (skip an empty primary in BR)
    for (let n = 1; n <= 3; n++) {
      const s = ((this.slot + dir * n) % 3 + 3) % 3;
      if (this.loadout[s] >= 0) { this.switchSlot(s); return; }
    }
  }

  /** legacy single-index switch used by gun game — assigns by category and equips */
  switchWeapon(gunIdx: number, silent = false) {
    this.giveWeapon(gunIdx, silent);
  }

  /** BR pickup / gun-game: assign a gun to the slot of its category and equip it */
  giveWeapon(gunIdx: number, silent = false) {
    const i = ((gunIdx % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    const spec = WEAPONS[i];
    const target = spec.cat === 'secondary' ? 1 : 0; // knives never arrive here
    this.loadout[target] = i;
    this.mags[target] = spec.magSize;
    this.switchSlot(target, silent);
    this.onSlotsChange?.();
  }

  /** BR knife pickup: swap the knife slot (keeps the movement-speed upgrade fresh) */
  giveKnife(knifeIdx: number, silent = false) {
    const i = ((knifeIdx % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    this.loadout[2] = i;
    if (this.slot === 2) this.vm.setWeapon(WEAPONS[i]);
    else this.switchSlot(2, silent);
    this.onSlotsChange?.();
  }

  /** refill both gun magazines (respawn / survival intermission) */
  refillAll() {
    [0, 1].forEach(i => { if (this.loadout[i] >= 0) this.mags[i] = WEAPONS[this.loadout[i]].magSize; });
    this.mags[2] = -1;
    this.reloading = false;
    this.onSlotsChange?.();
  }

  /** refill only the current weapon's magazine (BR ammo box) */
  refillCurrent() {
    if (this.slot !== 2 && this.loadout[this.slot] >= 0) {
      this.mags[this.slot] = WEAPONS[this.loadout[this.slot]].magSize;
    }
    this.reloading = false;
  }

  heal(n: number) {
    this.hp = Math.min(CFG.playerHp, this.hp + n);
  }

  /** BR start: pistol + knife only — loot a primary gun from the ground */
  setBrLoadout() {
    this.loadout = [-1, DEFAULT_SECONDARY, DEFAULT_KNIFE];
    this.mags = [0, WEAPONS[DEFAULT_SECONDARY].magSize, -1];
    this.armor = 0;
    this.reloading = false;
    this.slot = 1;
    this.vm.setWeapon(WEAPONS[DEFAULT_SECONDARY]);
    this.onSlotsChange?.();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const k = normKey(e);
    if (k === 'Tab') e.preventDefault();
    this.keys.add(k);
    if (k === 'KeyR') this.tryReload();
    if (k === 'KeyC' && !e.repeat) this.toggleCrouch();
    if (k === 'KeyQ' && !e.repeat) this.cycleSlot(1);
    const digit = /^(Digit|Numpad)([1-3])$/.exec(k);
    if (digit && !e.repeat) this.switchSlot(parseInt(digit[2], 10) - 1);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(normKey(e)); };
  private onWheel = (e: WheelEvent) => {
    if (!this.enabled || document.pointerLockElement === null) return;
    e.preventDefault();
    this.cycleSlot(e.deltaY > 0 ? 1 : -1);
  };

  toggleCrouch() {
    this.crouching = !this.crouching;
    this.onCrouchChange?.(this.crouching);
  }
  setCrouch(v: boolean) {
    if (v !== this.crouching) { this.crouching = v; this.onCrouchChange?.(v); }
  }
  // ---------- aim down sights (ADS) ----------
  setAim(v: boolean) {
    v = v && this.alive;
    if (v !== this.aiming) { this.aiming = v; this.onAimChange?.(v); }
  }
  toggleAim() { this.setAim(!this.aiming); }
  /** smoothed aim blend 0..1 (drives fov zoom, spread, viewmodel pose) */
  get aimAmount(): number { return this.aimAmt; }
  get isAiming(): boolean { return this.aiming; }
  private onMouseDown = (e: MouseEvent) => {
    if (!this.enabled) return;
    if (e.button === 0) this.mouseDown = true;
    if (e.button === 2) this.setAim(true); // hold RMB to aim
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) this.mouseDown = false;
    if (e.button === 2) this.setAim(false);
  };
  private onContextMenu = (e: Event) => { if (this.enabled) e.preventDefault(); };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled || document.pointerLockElement === null) return;
    const s = 0.0021 * this.sensitivity * THREE.MathUtils.lerp(1, CFG.aimSensMul, this.aimAmt);
    this.yaw -= e.movementX * s;
    this.pitch -= e.movementY * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  };

  tryReload() {
    const spec = this.currentSpec;
    if (spec.cat === 'knife') return; // knives never reload
    if (!this.alive || this.reloading || this.mags[this.slot] >= spec.magSize) return;
    this.reloading = true;
    this.reloadEnd = performance.now() + spec.reloadTime * 1000;
    this.audio.reload();
  }

  spawnAt(p: THREE.Vector3) {
    this.pos.copy(p); this.pos.y += 0.1;
    this.vel.set(0, 0, 0);
    this.hp = CFG.playerHp;
    this.alive = true;
    this.loadout = [DEFAULT_PRIMARY, DEFAULT_SECONDARY, DEFAULT_KNIFE];
    this.refillAll();
    this.crouching = false;
    this.setAim(false);
    this.aimAmt = 0;
    this.slot = 0;
    this.vm.setWeapon(WEAPONS[DEFAULT_PRIMARY]);
    this.audio.spawnFx();
    this.onSlotsChange?.();
  }

  get eyePos(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + this.curEye, this.pos.z);
  }

  /** current body height for collision (crouch shrinks it) */
  get bodyHeight(): number { return this.crouching ? CFG.crouchHeight : CFG.playerHeight; }

  /** true while any fire source (mouse or touch button) is held */
  get firing(): boolean {
    return this.mouseDown || (this.touch?.fire ?? false);
  }

  inputState(): PlayerInputState {
    return { yaw: this.yaw, pitch: this.pitch, moving: this.isMoving, shooting: this.firing && this.alive };
  }

  netState(): { p: Vec3Arr; y: number; x: number; m: 0 | 1; s: 0 | 1; hp: number } {
    return {
      p: [round2(this.pos.x), round2(this.pos.y), round2(this.pos.z)],
      y: round2(this.yaw), x: round2(this.pitch),
      m: this.isMoving ? 1 : 0, s: this.firing && this.alive ? 1 : 0,
      hp: Math.max(0, Math.round(this.hp)),
    };
  }

  private get isMoving(): boolean {
    if (this.keys.has('KeyW') || this.keys.has('KeyA') || this.keys.has('KeyS') || this.keys.has('KeyD')) return true;
    if (this.touch && (Math.abs(this.touch.fwd) + Math.abs(this.touch.strafe)) > 0.2) return true;
    return false;
  }

  takeDamage(amt: number, now: number): boolean {
    if (!this.alive) return false;
    const dmg = this.absorb(amt);
    this.hp -= dmg;
    this.lastRegen = now;
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.audio.death();
      return true; // died
    }
    this.audio.hurt();
    return false;
  }

  /** vest: soak 60% of damage into armor while it lasts */
  private absorb(amt: number): number {
    if (this.armor <= 0) return amt;
    const soaked = Math.min(this.armor, amt * 0.6);
    this.armor -= soaked;
    return amt - soaked;
  }

  /** main per-frame update; returns fire event if a shot was fired this frame */
  update(dt: number, now: number): { fired: boolean } {
    const fired = { fired: false };
    if (!this.alive) {
      this.vm.setVisible(false);
      this.setAim(false);
      this.aimAmt = 0;
      return fired;
    }
    this.vm.setVisible(true && this.enabled !== false);

    // controls disabled (paused / dead on client): zero input, keep physics
    if (!this.enabled) {
      this.keys.clear();
      this.mouseDown = false;
      this.vel.x = 0; this.vel.z = 0;
      // drain stale touch input so nothing fires right after resume
      if (this.touch) { this.touch.popLook(); this.touch.consumeJump(); this.touch.consumeReload(); this.touch.consumeTapFire(); }
    }

    // reload finish
    if (this.reloading && performance.now() >= this.reloadEnd) {
      this.reloading = false;
      if (this.loadout[this.slot] >= 0) this.mags[this.slot] = this.currentSpec.magSize;
    }

    // touch look (accumulated thumb drag)
    if (this.touch) {
      const [ldx, ldy] = this.touch.popLook();
      const ts = TOUCH_LOOK_SENS * this.sensitivity * THREE.MathUtils.lerp(1, CFG.aimSensMul, this.aimAmt);
      this.yaw -= ldx * ts;
      this.pitch = THREE.MathUtils.clamp(this.pitch - ldy * ts, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    }

    // crouch: C toggles, CTRL holds, touch button toggles
    if (this.keys.has('ControlLeft') || this.keys.has('ControlRight')) this.setCrouch(true);
    else if (this.keys.has('KeyC')) { /* toggle handled on keydown */ }
    if (this.touch && this.touch.consumeCrouchToggle()) this.toggleCrouch();
    if (this.touch && this.touch.consumeWeaponCycle()) this.cycleSlot(1);
    if (this.touch && this.touch.consumeAimToggle()) this.toggleAim();

    // aim blend (ADS)
    this.aimAmt += ((this.aiming ? 1 : 0) - this.aimAmt) * Math.min(1, dt * CFG.aimLerp);

    // eye height lerp (stand <-> crouch)
    const targetEye = this.crouching ? CFG.crouchEye : CFG.eyeHeight;
    this.curEye += (targetEye - this.curEye) * Math.min(1, dt * CFG.eyeLerp);

    // movement — keyboard (digital) merged with touch stick (analog)
    const sprint = (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || (!!this.touch && this.touch.fwd > 0.92)) && !this.crouching;
    let speed = sprint ? CFG.sprintSpeed : CFG.walkSpeed;
    if (this.crouching) speed *= CFG.crouchSpeedMul;
    if (this.aimAmt > 0.01) speed *= THREE.MathUtils.lerp(1, CFG.aimSpeedMul, this.aimAmt); // ADS slows you down
    speed *= this.currentSpec.speedMul ?? 1; // knives make you faster (famous-shooter move)
    let fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    let strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    if (this.touch) { fwd += this.touch.fwd; strafe += this.touch.strafe; }
    fwd = THREE.MathUtils.clamp(fwd, -1, 1);
    strafe = THREE.MathUtils.clamp(strafe, -1, 1);
    const mag = Math.hypot(fwd, strafe);
    if (mag > 1) { fwd /= mag; strafe /= mag; }
    const dir = new THREE.Vector3(strafe, 0, -fwd);
    if (dir.lengthSq() > 0) dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.vel.x = dir.x * speed;
    this.vel.z = dir.z * speed;

    const jumpPressed = this.keys.has('Space') || (this.touch ? this.touch.consumeJump() : false);
    if (jumpPressed && this.grounded) {
      if (this.crouching) { this.setCrouch(false); } // stand up instead of jumping
      else {
        this.vel.y = CFG.jumpVel;
        this.grounded = false;
        this.audio.jump();
      }
    }
    if (this.touch && this.touch.consumeReload()) this.tryReload();
    this.vel.y -= CFG.gravity * dt;
    // BR parachute: freefall high up, gentle descent near the ground
    if (this.parachute && !this.grounded) {
      const cap = this.pos.y > 45 ? -26 : -8;
      if (this.vel.y < cap) this.vel.y = cap;
    }

    const wasAir = !this.grounded;
    const res = this.world.moveBody(this.pos, this.vel, dt, CFG.playerRadius, this.bodyHeight);
    this.grounded = res.grounded;
    if (wasAir && this.grounded) { if (this.parachute) { this.parachute = false; this.audio.land(); } this.audio.land(); this.onLand?.(); }

    // footsteps
    if (this.grounded && (Math.abs(this.vel.x) + Math.abs(this.vel.z)) > 2) {
      if (now - this.lastStep > (sprint ? 300 : this.crouching ? 620 : 400)) { this.lastStep = now; this.audio.step(); }
    }

    // health regen
    if (this.hp < CFG.playerHp && now - this.lastRegen > CFG.regenDelay * 1000) {
      this.hp = Math.min(CFG.playerHp, this.hp + CFG.regenRate * dt);
    }

    // shooting — held fire (mouse / touch button / fire-drag) or a quick tap on the look zone
    if (this.firing) this.tryShoot(now, fired);
    if (this.touch && this.touch.consumeTapFire()) this.tryShoot(now, fired);

    this.vm.update(dt, this.isMoving, this.pitch, this.yaw, this.reloading, this.crouching, this.aimAmt);
    return fired;
  }

  private tryShoot(now: number, fired: { fired: boolean }) {
    const spec = this.currentSpec;
    if (this.reloading || now - this.lastFire < spec.fireInterval * 1000) return;
    // knives: silent melee swing — no ammo, short reach, always ready
    if (spec.cat === 'knife') {
      this.lastFire = now;
      fired.fired = true;
      this.vm.fire();
      this.audio.knife();
      const origin = this.eyePos;
      const dirShot = new THREE.Vector3(
        -Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch)
      );
      this.onShoot?.(origin, dirShot);
      return;
    }
    if (this.mags[this.slot] > 0) {
      this.lastFire = now;
      this.mags[this.slot]--;
      fired.fired = true;
      this.vm.fire();
      this.audio.shoot();
      const origin = this.eyePos;
      // dispersion: base + movement penalty, reduced when crouched / aiming
      let spread = spec.spread + (this.isMoving ? spec.moveSpread : 0);
      if (this.crouching) spread *= CFG.crouchSpreadMul;
      if (this.aimAmt > 0.01) spread *= THREE.MathUtils.lerp(1, CFG.aimSpreadMul, this.aimAmt);
      const shots = spec.pellets;
      for (let p = 0; p < shots; p++) {
        const dirShot = new THREE.Vector3(
          -Math.sin(this.yaw) * Math.cos(this.pitch),
          Math.sin(this.pitch),
          -Math.cos(this.yaw) * Math.cos(this.pitch)
        );
        if (spread > 0) {
          dirShot.x += (Math.random() - 0.5) * spread * 2;
          dirShot.y += (Math.random() - 0.5) * spread * 2;
          dirShot.z += (Math.random() - 0.5) * spread * 2;
          dirShot.normalize();
        }
        this.onShoot?.(origin, dirShot);
      }
      if (this.mags[this.slot] === 0) this.tryReload();
    } else {
      this.audio.empty();
      this.lastFire = now;
      this.tryReload();
    }
  }

  syncCamera(camera: THREE.PerspectiveCamera) {
    camera.position.copy(this.eyePos);
    camera.rotation.set(0, 0, 0);
    camera.rotateY(this.yaw);
    camera.rotateX(this.pitch);
  }

  applyServerDamage(amt: number): boolean {
    if (!this.alive) return false;
    this.hp -= this.absorb(amt);
    this.lastRegen = performance.now();
    if (this.hp <= 0) { this.hp = 0; this.alive = false; this.audio.death(); return true; }
    this.audio.hurt();
    return false;
  }

  dispose() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    document.removeEventListener('mousemove', this.onMouseMove);
    this.dom.removeEventListener('contextmenu', this.onContextMenu);
    this.vm.dispose();
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
