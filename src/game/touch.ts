// DESERT STRIKE 3D - mobile touch controls: dynamic joystick, look drag,
// fire-button drag-aim, crouch/weapon buttons, forced-landscape support.
// Detection order: URL param (?touch=1/0) > localStorage pref > auto (touch capability)

export const TOUCH_LOOK_SENS = 0.0042; // radians per screen px (thumb), multiplied by user sensitivity
const FIRE_DRAG_SENS = 0.75;           // fire-drag look sensitivity factor vs normal look
const JOY_RADIUS = 56;                 // px, max knob travel
const TAP_MS = 200;                    // tap-on-look-zone fires a single shot
const TAP_MOVE = 14;                   // px of drift still counted as a tap

import { storeGet, storeSet } from './store';

export type TouchMode = 'auto' | 'on' | 'off';
const STORE_KEY = 'ns_touch_mode';

export function touchModePref(): TouchMode {
  const v = storeGet(STORE_KEY);
  return v === 'on' || v === 'off' ? v : 'auto';
}
export function setTouchModePref(m: TouchMode) { storeSet(STORE_KEY, m); }

export function detectTouch(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('touch');
    if (q === '1' || q === 'true' || q === 'yes') return true;
    if (q === '0' || q === 'false' || q === 'no') return false;
    const pref = touchModePref();
    if (pref === 'on') return true;
    if (pref === 'off') return false;
  } catch { /* private mode etc. */ }
  return ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
}

/** Minimal contract LocalPlayer consumes (implemented by TouchControls). */
export interface TouchInput {
  readonly fwd: number;   // -1..1, +1 = forward
  readonly strafe: number;// -1..1, +1 = right
  readonly fire: boolean; // fire button held
  popLook(): [number, number];     // accumulated look delta since last frame
  consumeJump(): boolean;
  consumeReload(): boolean;
  consumeTapFire(): boolean;
  consumeCrouchToggle(): boolean;
  consumeAimToggle(): boolean;
  consumeSwap(): boolean;
}

export interface TouchCallbacks {
  onPause(): void;
  onScoreboard(show: boolean): void;
  /** ROT button: flip which way the forced-landscape picture is rotated */
  onRotateFlip(): void;
}

export class TouchControls implements TouchInput {
  private root: HTMLElement;
  private joyEl: HTMLElement;
  private knobEl: HTMLElement;
  private fireBtn: HTMLElement;
  private moveZone: HTMLElement;
  private lookZone: HTMLElement;
  private rotBtn: HTMLElement;

  private joyId = -1;
  private joyCX = 0; private joyCY = 0;
  private lookId = -1;
  private lookLX = 0; private lookLY = 0;
  private lookMoved = 0;
  private lookT0 = 0;
  private fireDragId = -1;
  private fireDragLX = 0; private fireDragLY = 0;

  private fwdV = 0;
  private strafeV = 0;
  private fireHeld = false;
  private jumpQ = false;
  private reloadQ = false;
  private tapQ = false;
  private crouchQ = false;
  private swapQ = false;
  private aimQ = false;

  private lookAccX = 0;
  private lookAccY = 0;

  constructor(private parent: HTMLElement, private cb: TouchCallbacks) {
    this.root = document.createElement('div');
    this.root.className = 'ns-touch ns-hidden';
    this.root.innerHTML = `
      <div class="ns-touch-zone ns-zone-move"></div>
      <div class="ns-touch-zone ns-zone-look"></div>
      <div class="ns-joy"><div class="ns-joy-knob"></div></div>
      <div class="ns-tbtn fire">FIRE</div>
      <div class="ns-tbtn jump">JUMP</div>
      <div class="ns-tbtn reload">RLD</div>
      <div class="ns-tbtn crouch">CRCH</div>
      <div class="ns-tbtn aim">AIM</div>
      <div class="ns-tbtn sb">LIST</div>
      <div class="ns-tbtn pause">II</div>
      <div class="ns-tbtn swap ns-hidden">SWAP</div>
      <div class="ns-tbtn rot ns-hidden">ROT</div>
    `;
    parent.appendChild(this.root);
    this.moveZone = this.root.querySelector('.ns-zone-move')!;
    this.lookZone = this.root.querySelector('.ns-zone-look')!;
    this.joyEl = this.root.querySelector('.ns-joy')!;
    this.knobEl = this.root.querySelector('.ns-joy-knob')!;
    this.fireBtn = this.root.querySelector('.ns-tbtn.fire')!;

    // zones
    this.moveZone.addEventListener('touchstart', this.onJoyStart, { passive: false });
    this.lookZone.addEventListener('touchstart', this.onLookStart, { passive: false });
    window.addEventListener('touchmove', this.onTouchMove, { passive: false });
    window.addEventListener('touchend', this.onTouchEnd, { passive: false });
    window.addEventListener('touchcancel', this.onTouchEnd, { passive: false });

    // buttons
    this.bindHold(this.fireBtn,
      () => { this.fireHeld = true; this.fireBtn.classList.add('on'); },
      () => { this.fireHeld = false; this.fireBtn.classList.remove('on'); });
    this.bindHold(this.root.querySelector('.ns-tbtn.jump')!, () => { this.jumpQ = true; }, undefined);
    this.bindHold(this.root.querySelector('.ns-tbtn.reload')!, () => { this.reloadQ = true; }, undefined);
    this.bindHold(this.root.querySelector('.ns-tbtn.crouch')!, () => { this.crouchQ = true; }, undefined);
    this.bindHold(this.root.querySelector('.ns-tbtn.aim')!, () => { this.aimQ = true; }, undefined);
    this.bindHold(this.root.querySelector('.ns-tbtn.swap')!, () => { this.swapQ = true; }, undefined);
    this.bindHold(this.root.querySelector('.ns-tbtn.sb')!, () => this.cb.onScoreboard(true), () => this.cb.onScoreboard(false));
    const pauseBtn = this.root.querySelector('.ns-tbtn.pause')!;
    pauseBtn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); this.cb.onPause(); }, { passive: false });
    // ROT: flip the forced-landscape direction (for webviews/iframes where the
    // device tilt sensor is unavailable, e.g. games embedded in other apps)
    this.rotBtn = this.root.querySelector('.ns-tbtn.rot')!;
    this.rotBtn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); this.cb.onRotateFlip(); }, { passive: false });

    // fire-button drag also aims (PUBG-style): track its own touch id
    this.fireBtn.addEventListener('touchstart', (e) => {
      e.preventDefault(); e.stopPropagation();
      if (this.fireDragId !== -1) return;
      const t = e.changedTouches[0];
      this.fireDragId = t.identifier;
      const [mx, my] = this.mapXY(t.clientX, t.clientY);
      this.fireDragLX = mx; this.fireDragLY = my;
    }, { passive: false });

    // block iOS pinch/double-tap zoom & scroll while the game is mounted
    document.addEventListener('gesturestart', this.preventDefault);
    this.root.addEventListener('touchmove', this.preventDefault, { passive: false });
    this.root.addEventListener('contextmenu', this.preventDefault);
    this.root.addEventListener('dblclick', this.preventDefault);
  }

  private preventDefault = (e: Event) => e.preventDefault();

  /**
   * Active forced-landscape rotation (set by main from screen.orientation.angle
   * + device tilt). 0 = none, 90 = CSS rotate(90deg), -90 = rotate(-90deg).
   * Touches must be counter-rotated into game space to avoid inverted controls.
   */
  private rotation: 0 | 90 | -90 = 0;
  setForcedRotation(r: 0 | 90 | -90) { this.rotation = r; }

  /** show the ROT flip button only while forced-landscape is active */
  setRotVisible(v: boolean) { this.rotBtn.classList.toggle('ns-hidden', !v); }

  /**
   * Map screen (client) coords into the game's element space.
   * When the phone is portrait we render the whole game rotated 90°
   * (either direction), so touches must be counter-rotated accordingly.
   */
  private mapXY(cx: number, cy: number): [number, number] {
    // Inverse of the CSS forced-landscape transforms (transform-origin: left top):
    //   .ns-forced-landscape      = rotate(90deg) translateY(-100%)  -> game = (cy, innerWidth - cx)
    //   .ns-forced-landscape-flip = translateY(100vh) rotate(-90deg) -> game = (innerHeight - cy, cx)
    // NOTE: the +90 branch previously reused the -90 formula, which MIRRORED both
    // axes of every mapped touch (joystick + look) whenever the picture rotated
    // +90 — the case embedded webviews (Aippy etc.) always hit, because the device
    // tilt sensor is unavailable there and the default +90 rotation is used.
    if (this.rotation === 90) return [cy, window.innerWidth - cx];
    if (this.rotation === -90) return [window.innerHeight - cy, cx];
    return [cx, cy];
  }

  private bindHold(el: HTMLElement, down: () => void, up: (() => void) | undefined) {
    el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('on'); down(); }, { passive: false });
    const end = (e: Event) => { e.preventDefault(); el.classList.remove('on'); up?.(); };
    el.addEventListener('touchend', end, { passive: false });
    el.addEventListener('touchcancel', end, { passive: false });
  }

  // ---------- joystick (dynamic: appears where the thumb lands) ----------
  private onJoyStart = (e: TouchEvent) => {
    e.preventDefault();
    if (this.joyId !== -1) return;
    const t = e.changedTouches[0];
    this.joyId = t.identifier;
    const [mx, my] = this.mapXY(t.clientX, t.clientY);
    this.joyCX = mx; this.joyCY = my;
    this.joyEl.style.left = this.joyCX + 'px';
    this.joyEl.style.top = this.joyCY + 'px';
    this.joyEl.style.display = 'block';
    this.knobEl.style.transform = 'translate(0px, 0px)';
  };

  private onLookStart = (e: TouchEvent) => {
    e.preventDefault();
    if (this.lookId !== -1) return;
    const t = e.changedTouches[0];
    this.lookId = t.identifier;
    const [mx, my] = this.mapXY(t.clientX, t.clientY);
    this.lookLX = mx; this.lookLY = my;
    this.lookMoved = 0;
    this.lookT0 = performance.now();
  };

  private onTouchMove = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.joyId) {
        e.preventDefault();
        const [mx, my] = this.mapXY(t.clientX, t.clientY);
        let dx = mx - this.joyCX;
        let dy = my - this.joyCY;
        const len = Math.hypot(dx, dy);
        if (len > JOY_RADIUS) { dx = (dx / len) * JOY_RADIUS; dy = (dy / len) * JOY_RADIUS; }
        this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
        this.strafeV = dx / JOY_RADIUS;
        this.fwdV = -dy / JOY_RADIUS;
      } else if (t.identifier === this.lookId) {
        e.preventDefault();
        const [mx, my] = this.mapXY(t.clientX, t.clientY);
        const dx = mx - this.lookLX;
        const dy = my - this.lookLY;
        this.lookLX = mx; this.lookLY = my;
        this.lookMoved += Math.abs(dx) + Math.abs(dy);
        this.lookAccX += dx;
        this.lookAccY += dy;
      } else if (t.identifier === this.fireDragId) {
        e.preventDefault();
        // dragging on the FIRE button also turns the view
        const [mx, my] = this.mapXY(t.clientX, t.clientY);
        const dx = (mx - this.fireDragLX) * FIRE_DRAG_SENS;
        const dy = (my - this.fireDragLY) * FIRE_DRAG_SENS;
        this.fireDragLX = mx; this.fireDragLY = my;
        this.lookAccX += dx;
        this.lookAccY += dy;
      }
    }
  };

  private onTouchEnd = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.joyId) {
        this.joyId = -1;
        this.fwdV = 0; this.strafeV = 0;
        this.joyEl.style.display = 'none';
      } else if (t.identifier === this.lookId) {
        e.preventDefault();
        const dt = performance.now() - this.lookT0;
        if (dt < TAP_MS && this.lookMoved < TAP_MOVE) this.tapQ = true; // quick tap = single shot
        this.lookId = -1;
      } else if (t.identifier === this.fireDragId) {
        this.fireDragId = -1;
      }
    }
  };

  // ---------- state consumed by LocalPlayer ----------
  get fwd() { return this.fwdV; }
  get strafe() { return this.strafeV; }
  get fire() { return this.fireHeld; }

  popLook(): [number, number] {
    const out: [number, number] = [this.lookAccX, this.lookAccY];
    this.lookAccX = 0; this.lookAccY = 0;
    return out;
  }
  consumeJump() { const v = this.jumpQ; this.jumpQ = false; return v; }
  consumeReload() { const v = this.reloadQ; this.reloadQ = false; return v; }
  consumeTapFire() { const v = this.tapQ; this.tapQ = false; return v; }
  consumeCrouchToggle() { const v = this.crouchQ; this.crouchQ = false; return v; }
  consumeAimToggle() { const v = this.aimQ; this.aimQ = false; return v; }
  consumeSwap() { const v = this.swapQ; this.swapQ = false; return v; }

  /** reflect the player's aim state on the AIM button (toggle style) */
  setAimActive(v: boolean) {
    this.root.querySelector('.ns-tbtn.aim')?.classList.toggle('on', v);
  }

  /** contextual SWAP button (battle royale ground weapon pickup) */
  showSwap(v: boolean) {
    this.root.querySelector('.ns-tbtn.swap')?.classList.toggle('ns-hidden', !v);
  }

  // ---------- visibility ----------
  setEnabled(v: boolean) {
    this.root.classList.toggle('ns-hidden', !v);
    if (!v) this.reset();
  }

  reset() {
    this.joyId = -1; this.lookId = -1; this.fireDragId = -1;
    this.fwdV = 0; this.strafeV = 0;
    this.fireHeld = false;
    this.jumpQ = false; this.reloadQ = false; this.tapQ = false;
    this.crouchQ = false; this.swapQ = false; this.aimQ = false;
    this.lookAccX = 0; this.lookAccY = 0;
    this.joyEl.style.display = 'none';
    this.fireBtn.classList.remove('on');
    this.root.querySelectorAll('.ns-tbtn.on').forEach(b => b.classList.remove('on'));
  }

  destroy() {
    document.removeEventListener('gesturestart', this.preventDefault);
    this.root.remove();
  }
}
