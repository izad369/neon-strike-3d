// NEON STRIKE 3D - local player: input (keyboard/mouse + touch), physics, shooting
import * as THREE from 'three';
import { CFG, Vec3Arr } from './constants';
import { World } from './world';
import { ViewModel } from './viewmodel';
import { AudioFX } from './audio';
import { TouchInput, TOUCH_LOOK_SENS } from './touch';

// Keyboard normalization: real browsers send e.code; synthetic/edge cases may only send e.key
const KEY_FALLBACK: Record<string, string> = {
  w: 'KeyW', a: 'KeyA', s: 'KeyS', d: 'KeyD',
  ' ': 'Space', r: 'KeyR', shift: 'ShiftLeft', tab: 'Tab',
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
  ammo = CFG.magSize;
  reloading = false;
  private reloadEnd = 0;
  private lastFire = 0;
  private lastRegen = 0;
  private lastStep = 0;
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

  constructor(private world: World, camera: THREE.PerspectiveCamera, private audio: AudioFX, dom: HTMLElement) {
    this.vm = new ViewModel(camera);
    this.bindInput(dom);
  }

  private bindInput(dom: HTMLElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    dom.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('mousemove', this.onMouseMove);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled) return;
    const k = normKey(e);
    if (k === 'Tab') e.preventDefault();
    this.keys.add(k);
    if (k === 'KeyR') this.tryReload();
  };
  private onKeyUp = (e: KeyboardEvent) => { this.keys.delete(normKey(e)); };
  private onMouseDown = (e: MouseEvent) => { if (this.enabled && e.button === 0) this.mouseDown = true; };
  private onMouseUp = () => { this.mouseDown = false; };
  private onMouseMove = (e: MouseEvent) => {
    if (!this.enabled || document.pointerLockElement === null) return;
    const s = 0.0021 * this.sensitivity;
    this.yaw -= e.movementX * s;
    this.pitch -= e.movementY * s;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
  };

  tryReload() {
    if (!this.alive || this.reloading || this.ammo >= CFG.magSize) return;
    this.reloading = true;
    this.reloadEnd = performance.now() + CFG.reloadTime * 1000;
    this.audio.reload();
  }

  spawnAt(p: THREE.Vector3) {
    this.pos.copy(p); this.pos.y += 0.1;
    this.vel.set(0, 0, 0);
    this.hp = CFG.playerHp;
    this.alive = true;
    this.ammo = CFG.magSize;
    this.reloading = false;
    this.audio.spawnFx();
  }

  get eyePos(): THREE.Vector3 {
    return new THREE.Vector3(this.pos.x, this.pos.y + CFG.eyeHeight, this.pos.z);
  }

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
      this.ammo = CFG.magSize;
    }

    // touch look (accumulated thumb drag)
    if (this.touch) {
      const [ldx, ldy] = this.touch.popLook();
      const ts = TOUCH_LOOK_SENS * this.sensitivity;
      this.yaw -= ldx * ts;
      this.pitch = THREE.MathUtils.clamp(this.pitch - ldy * ts, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    }

    // movement — keyboard (digital) merged with touch stick (analog)
    const sprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') || (!!this.touch && this.touch.fwd > 0.92);
    const speed = sprint ? CFG.sprintSpeed : CFG.walkSpeed;
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
      this.vel.y = CFG.jumpVel;
      this.grounded = false;
      this.audio.jump();
    }
    if (this.touch && this.touch.consumeReload()) this.tryReload();
    this.vel.y -= CFG.gravity * dt;

    const wasAir = !this.grounded;
    const res = this.world.moveBody(this.pos, this.vel, dt, CFG.playerRadius, CFG.playerHeight);
    this.grounded = res.grounded;
    if (wasAir && this.grounded) { this.audio.land(); this.onLand?.(); }

    // footsteps
    if (this.grounded && (Math.abs(this.vel.x) + Math.abs(this.vel.z)) > 2) {
      if (now - this.lastStep > (sprint ? 300 : 400)) { this.lastStep = now; this.audio.step(); }
    }

    // health regen
    if (this.hp < CFG.playerHp && now - this.lastRegen > CFG.regenDelay * 1000) {
      this.hp = Math.min(CFG.playerHp, this.hp + CFG.regenRate * dt);
    }

    // shooting — held fire (mouse / touch button) or a quick tap on the look zone
    if (this.firing) this.tryShoot(now, fired);
    if (this.touch && this.touch.consumeTapFire()) this.tryShoot(now, fired);

    this.vm.update(dt, this.isMoving, this.pitch, this.yaw, this.reloading);
    return fired;
  }

  private tryShoot(now: number, fired: { fired: boolean }) {
    if (this.reloading || now - this.lastFire < CFG.fireInterval * 1000) return;
    if (this.ammo > 0) {
      this.lastFire = now;
      this.ammo--;
      fired.fired = true;
      this.vm.fire();
      this.audio.shoot();
      const origin = this.eyePos;
      const dirShot = new THREE.Vector3(
        -Math.sin(this.yaw) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        -Math.cos(this.yaw) * Math.cos(this.pitch)
      );
      // hip spread when moving
      if (this.isMoving) {
        dirShot.x += (Math.random() - 0.5) * 0.018;
        dirShot.y += (Math.random() - 0.5) * 0.018;
        dirShot.z += (Math.random() - 0.5) * 0.018;
        dirShot.normalize();
      }
      this.onShoot?.(origin, dirShot);
      if (this.ammo === 0) this.tryReload();
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
    document.removeEventListener('mousemove', this.onMouseMove);
    this.vm.dispose();
  }
}

function round2(n: number): number { return Math.round(n * 100) / 100; }
