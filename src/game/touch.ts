// NEON STRIKE 3D - mobile touch controls: dynamic joystick, look drag, action buttons
// Detection order: URL param (?touch=1/0) > localStorage pref > auto (touch capability)

export const TOUCH_LOOK_SENS = 0.0042; // radians per screen px (thumb), multiplied by user sensitivity
const JOY_RADIUS = 56;                 // px, max knob travel
const TAP_MS = 200;                    // tap-on-look-zone fires a single shot
const TAP_MOVE = 14;                   // px of drift still counted as a tap

export type TouchMode = 'auto' | 'on' | 'off';
const STORE_KEY = 'ns_touch_mode';

export function touchModePref(): TouchMode {
  const v = localStorage.getItem(STORE_KEY);
  return v === 'on' || v === 'off' ? v : 'auto';
}
export function setTouchModePref(m: TouchMode) { localStorage.setItem(STORE_KEY, m); }

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
}

export interface TouchCallbacks {
  onPause(): void;
  onScoreboard(show: boolean): void;
}

export class TouchControls implements TouchInput {
  private root: HTMLElement;
  private joyEl: HTMLElement;
  private knobEl: HTMLElement;
  private fireBtn: HTMLElement;
  private moveZone: HTMLElement;
  private lookZone: HTMLElement;

  private joyId = -1;
  private joyCX = 0; private joyCY = 0;
  private lookId = -1;
  private lookLX = 0; private lookLY = 0;
  private lookMoved = 0;
  private lookT0 = 0;

  private fwdV = 0;
  private strafeV = 0;
  private fireHeld = false;
  private jumpQ = false;
  private reloadQ = false;
  private tapQ = false;

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
      <div class="ns-tbtn sb">LIST</div>
      <div class="ns-tbtn pause">II</div>
      <div class="ns-rotate"><div class="ns-rotate-icon"></div><div>ROTATE YOUR DEVICE<br /><span>landscape gives the best view</span></div></div>
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
    this.bindHold(this.fireBtn, () => { this.fireHeld = true; this.fireBtn.classList.add('on'); }, () => { this.fireHeld = false; this.fireBtn.classList.remove('on'); });
    this.bindHold(this.root.querySelector('.ns-tbtn.jump')!, () => { this.jumpQ = true; }, undefined);
    this.bindHold(this.root.querySelector('.ns-tbtn.reload')!, () => { this.reloadQ = true; }, undefined);
    this.bindHold(this.root.querySelector('.ns-tbtn.sb')!, () => this.cb.onScoreboard(true), () => this.cb.onScoreboard(false));
    const pauseBtn = this.root.querySelector('.ns-tbtn.pause')!;
    pauseBtn.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); this.cb.onPause(); }, { passive: false });

    // block iOS pinch/double-tap zoom & scroll while the game is mounted
    document.addEventListener('gesturestart', this.preventDefault);
    this.root.addEventListener('touchmove', this.preventDefault, { passive: false });
    this.root.addEventListener('contextmenu', this.preventDefault);
    this.root.addEventListener('dblclick', this.preventDefault);
  }

  private preventDefault = (e: Event) => e.preventDefault();

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
    this.joyCX = t.clientX; this.joyCY = t.clientY;
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
    this.lookLX = t.clientX; this.lookLY = t.clientY;
    this.lookMoved = 0;
    this.lookT0 = performance.now();
  };

  private onTouchMove = (e: TouchEvent) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === this.joyId) {
        e.preventDefault();
        let dx = t.clientX - this.joyCX;
        let dy = t.clientY - this.joyCY;
        const len = Math.hypot(dx, dy);
        if (len > JOY_RADIUS) { dx = (dx / len) * JOY_RADIUS; dy = (dy / len) * JOY_RADIUS; }
        this.knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
        this.strafeV = dx / JOY_RADIUS;
        this.fwdV = -dy / JOY_RADIUS;
      } else if (t.identifier === this.lookId) {
        e.preventDefault();
        const dx = t.clientX - this.lookLX;
        const dy = t.clientY - this.lookLY;
        this.lookLX = t.clientX; this.lookLY = t.clientY;
        this.lookMoved += Math.abs(dx) + Math.abs(dy);
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

  // ---------- visibility ----------
  setEnabled(v: boolean) {
    this.root.classList.toggle('ns-hidden', !v);
    if (!v) this.reset();
  }

  reset() {
    this.joyId = -1; this.lookId = -1;
    this.fwdV = 0; this.strafeV = 0;
    this.fireHeld = false;
    this.jumpQ = false; this.reloadQ = false; this.tapQ = false;
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
