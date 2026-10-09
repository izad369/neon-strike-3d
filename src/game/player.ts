// DESERT STRIKE 3D - local player: input (keyboard/mouse + touch), physics,
// shooting, weapon inventory (7 guns), crouch, aim down sights (ADS)
import * as THREE from 'three';
import { CFG, Vec3Arr } from './constants';
import { World } from './world';
import { ViewModel } from './viewmodel';
import { AudioFX } from './audio';
import { TouchInput, TOUCH_LOOK_SENS } from './touch';
import { WeaponSpec, WEAPONS, DEFAULT_WEAPON } from './weapons';

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
  alive = true;
  grounded = true;
  reloading = false;
  crouching = false;
  aiming = false;        // ADS held (mouse RMB) or toggled (touch AIM button)
  private aimAmt = 0;    // smoothed 0..1 blend used for fov/spread/speed/viewmodel
  // --- weapon inventory (carries all guns, arcade style) ---
  private mags: number[] = WEAPONS.map(w => w.magSize);
  private weaponIdx = DEFAULT_WEAPON;
  private reloadEnd = 0;
  private lastFire = 0;
  private lastRegen = 0;
  private lastStep = 0;
  private curEye = CFG.eyeHeight;
  onWeaponSwitch: ((spec: WeaponSpec, slot: number) => void) | null = null;
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
  get weaponIndex(): number { return this.weaponIdx; }
  get currentSpec(): WeaponSpec { return WEAPONS[this.weaponIdx]; }
  get ammo(): number { return this.mags[this.weaponIdx]; }

  switchWeapon(i: number, silent = false) {
    const idx = ((i % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    if (idx === this.weaponIdx) return;
    this.weaponIdx = idx;
    this.reloading = false; // cancel reload on swap
    this.lastFire = performance.now(); // brief raise delay
    this.vm.setWeapon(WEAPONS[idx]);
    if (!silent) this.audio.weaponSwitch();
    this.onWeaponSwitch?.(WEAPONS[idx], idx);
  }

  cycleWeapon(dir = 1) { this.switchWeapon(this.weaponIdx + dir); }

  /** refill every magazine (respawn / survival intermission) */
  refillAll() {
    this.mags = WEAPONS.map(w => w.magSize);
    this.reloading = false;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const k = normKey(e);
    if (k === 'Tab') e.preventDefault();
    this.keys.add(k);
    if (k === 'KeyR') this.tryReload();
    if (k === 'KeyC' && !e.repeat) this.toggleCrouch();
    if (k === 'KeyQ' && !e.repeat) this.cycleWeapon(1);
    const digit = /^(Digit|Numpad)([1-7])$/.exec(k);
    if (digit && !e.repeat) this.switchWeapon(parseInt(digit[2], 10) - 1);
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(normKey(e)); };
  private onWheel = (e: WheelEvent) => {
    if (!this.enabled || document.pointerLockElement === null) return;
    e.preventDefault();
    this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
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
    if (!this.alive || this.reloading || this.mags[this.weaponIdx] >= spec.magSize) return;
    this.reloading = true;
    this.reloadEnd = performance.now() + spec.reloadTime * 1000;
    this.audio.reload();
  }

  spawnAt(p: THREE.Vector3) {
    this.pos.copy(p); this.pos.y += 0.1;
    this.vel.set(0, 0, 0);
    this.hp = CFG.playerHp;
    this.alive = true;
    this.refillAll();
    this.crouching = false;
    this.setAim(false);
    this.aimAmt = 0;
    this.switchWeapon(DEFAULT_WEAPON, true);
    this.audio.spawnFx();
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
    this.hp -= amt;
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
      this.mags[this.weaponIdx] = this.currentSpec.magSize;
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
    if (this.touch && this.touch.consumeWeaponCycle()) this.cycleWeapon(1);
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

    const wasAir = !this.grounded;
    const res = this.world.moveBody(this.pos, this.vel, dt, CFG.playerRadius, this.bodyHeight);
    this.grounded = res.grounded;
    if (wasAir && this.grounded) { this.audio.land(); this.onLand?.(); }

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
    if (this.mags[this.weaponIdx] > 0) {
      this.lastFire = now;
      this.mags[this.weaponIdx]--;
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
      if (this.mags[this.weaponIdx] === 0) this.tryReload();
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
    this.hp -= amt;
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
