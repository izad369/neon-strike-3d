// NEON STRIKE 3D - in-game HUD (DOM overlay)
import { esc } from './menus-utils';

export class HUD {
  root: HTMLElement;
  private hpFill!: HTMLElement;
  private hpNum!: HTMLElement;
  private ammoNum!: HTMLElement;
  private ammoSub!: HTMLElement;
  private timeEl!: HTMLElement;
  private modeEl!: HTMLElement;
  private kdEl!: HTMLElement;
  private roomEl!: HTMLElement;
  private feedEl!: HTMLElement;
  private hitmarkerEl!: HTMLElement;
  private vignetteEl!: HTMLElement;
  private respawnEl!: HTMLElement;
  private respawnCountEl!: HTMLElement;
  private sbEl!: HTMLElement;
  private sbBody!: HTMLElement;
  private hintEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private weaponNameEl!: HTMLElement;
  private armorChipEl!: HTMLElement;
  private zoneWarnEl!: HTMLElement;
  private respawnLabelEl!: HTMLElement;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private vignetteTimer: ReturnType<typeof setTimeout> | null = null;
  private hmTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'ns-hud ns-hidden';
    this.root.innerHTML = `
      <div class="ns-crosshair"><div class="ns-crosshair-dot"></div></div>
      <div class="ns-scope ns-hidden"><div class="ns-scope-mask"></div><div class="ns-scope-line h"></div><div class="ns-scope-line v"></div></div>
      <div class="ns-vignette"></div>
      <div class="ns-timer"><div class="ns-timer-time">5:00</div><div class="ns-timer-mode">Deathmatch</div></div>
      <div class="ns-kd"><b>0</b> K &nbsp;/&nbsp; 0 D</div>
      <div class="ns-room"></div>
      <div class="ns-feed"></div>
      <div class="ns-hitmarker"><span></span><span></span><span></span><span></span></div>
      <div class="ns-hp-wrap">
        <div class="ns-hp-label"><span>HEALTH</span><span class="ns-hp-right"><span class="ns-armor-chip ns-hidden">VEST 0</span><span class="ns-hp-num">100</span></span></div>
        <div class="ns-hp-bar"><div class="ns-hp-fill"></div></div>
      </div>
      <div class="ns-ammo">
        <div class="ns-ammo-num">30</div>
        <div class="ns-ammo-sub"><span class="ns-ammo-mag">RIFLE</span> &bull; <span class="ns-ammo-state">READY</span></div>
      </div>
      <div class="ns-toast ns-hidden"></div>
      <div class="ns-crouch-ind">CROUCHED</div>
      <div class="ns-zone-warn ns-hidden">⚠ OUTSIDE THE ZONE — GET BACK!</div>
      <div class="ns-respawn ns-hidden"><h2>ELIMINATED</h2><p><span class="ns-respawn-label">Respawning in</span> <span class="ns-respawn-count">3</span>...</p></div>
      <div class="ns-scoreboard ns-hidden"><h3>SCOREBOARD</h3><div class="ns-sb-body"></div></div>
      <div class="ns-hint">ESC — pause &nbsp;|&nbsp; TAB — scoreboard &nbsp;|&nbsp; RMB — aim</div>
    `;
    parent.appendChild(this.root);
    const q = <T extends HTMLElement>(s: string) => this.root.querySelector(s) as T;
    this.hpFill = q('.ns-hp-fill'); this.hpNum = q('.ns-hp-num');
    this.ammoNum = q('.ns-ammo-num'); this.ammoSub = q('.ns-ammo-state');
    this.timeEl = q('.ns-timer-time'); this.modeEl = q('.ns-timer-mode');
    this.kdEl = q('.ns-kd'); this.roomEl = q('.ns-room');
    this.feedEl = q('.ns-feed'); this.hitmarkerEl = q('.ns-hitmarker');
    this.vignetteEl = q('.ns-vignette');
    this.respawnEl = q('.ns-respawn'); this.respawnCountEl = q('.ns-respawn-count');
    this.sbEl = q('.ns-scoreboard'); this.sbBody = q('.ns-sb-body');
    this.hintEl = q('.ns-hint');
    this.toastEl = q('.ns-toast');
    this.weaponNameEl = q('.ns-ammo-mag');
    this.armorChipEl = q('.ns-armor-chip');
    this.zoneWarnEl = q('.ns-zone-warn');
    this.respawnLabelEl = q('.ns-respawn-label');
  }

  show(v: boolean) { this.root.classList.toggle('ns-hidden', !v); }

  setHp(hp: number, armor = 0) {
    const pct = Math.max(0, Math.min(100, hp));
    this.hpFill.style.width = pct + '%';
    this.hpFill.classList.toggle('low', pct < 35);
    this.hpNum.textContent = String(Math.round(pct));
    this.armorChipEl.classList.toggle('ns-hidden', armor <= 0);
    if (armor > 0) this.armorChipEl.textContent = `VEST ${Math.round(armor)}`;
  }
  setAmmo(cur: number, reloading: boolean) {
    this.ammoNum.textContent = String(cur);
    this.ammoNum.classList.toggle('empty', cur === 0 && !reloading);
    this.ammoSub.textContent = reloading ? 'RELOADING' : cur === 0 ? 'EMPTY' : 'READY';
    this.ammoSub.className = 'ns-ammo-state' + (reloading ? ' rel' : '');
  }
  setWeaponName(name: string) { this.weaponNameEl.textContent = name; }

  /** center-screen fading toast: weapon switch, wave banner, gun-game progress */
  toast(text: string, ms = 1400) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('ns-hidden');
    this.toastEl.classList.remove('pop');
    void this.toastEl.offsetWidth; // restart animation
    this.toastEl.classList.add('pop');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.add('ns-hidden'), ms);
  }

  setCrouchIndicator(on: boolean) {
    this.root.querySelector('.ns-crouch-ind')?.classList.toggle('show', on);
  }
  /** sniper scope overlay (full ADS with scoped weapons) — also hides the crosshair */
  setScope(on: boolean) {
    this.root.querySelector('.ns-scope')?.classList.toggle('ns-hidden', !on);
    this.root.classList.toggle('scoped', on);
  }
  setTimer(t: string, mode: string) { this.timeEl.textContent = t; this.modeEl.textContent = mode; }
  setKD(k: number, d: number) { this.kdEl.innerHTML = `<b>${k}</b> K &nbsp;/&nbsp; ${d} D`; }
  setRoom(text: string) { this.roomEl.textContent = text; this.roomEl.style.display = text ? '' : 'none'; }
  setHint(text: string) { this.hintEl.textContent = text; }

  feed(killer: string, victim: string, hs: boolean, involvingMe: boolean) {
    const item = document.createElement('div');
    item.className = 'ns-feed-item' + (hs ? ' hs' : '');
    item.innerHTML = `<b>${esc(killer)}</b> ${hs ? '&#9733;' : '&#9656;'} <span class="vic">${esc(victim)}</span>`;
    this.feedEl.prepend(item);
    if (involvingMe) item.style.borderColor = hs ? '#e08a2e' : '#9fb86e';
    while (this.feedEl.children.length > 5) this.feedEl.lastChild?.remove();
    setTimeout(() => { item.style.opacity = '0'; item.style.transition = 'opacity 0.4s'; }, 4200);
    setTimeout(() => item.remove(), 4800);
  }

  hitmarker(hs: boolean) {
    this.hitmarkerEl.classList.remove('show');
    void this.hitmarkerEl.offsetWidth; // restart animation
    this.hitmarkerEl.classList.toggle('hs', hs);
    this.hitmarkerEl.classList.add('show');
    if (this.hmTimer) clearTimeout(this.hmTimer);
    this.hmTimer = setTimeout(() => this.hitmarkerEl.classList.remove('show'), 250);
  }

  damageFlash() {
    this.vignetteEl.style.opacity = '1';
    if (this.vignetteTimer) clearTimeout(this.vignetteTimer);
    this.vignetteTimer = setTimeout(() => { this.vignetteEl.style.opacity = '0'; }, 220);
  }

  showRespawn(show: boolean, seconds = 0, label?: string) {
    this.respawnEl.classList.toggle('ns-hidden', !show);
    if (!show) return;
    this.respawnLabelEl.textContent = label ?? 'Respawning in';
    if (!label) this.respawnCountEl.textContent = String(Math.ceil(seconds));
    else this.respawnCountEl.textContent = '';
  }

  /** flashing OUTSIDE ZONE banner (battle royale) */
  setZoneWarn(on: boolean) {
    this.zoneWarnEl.classList.toggle('ns-hidden', !on);
    this.zoneWarnEl.classList.toggle('show', on);
  }

  scoreboard(show: boolean, rows: { name: string; k: number; d: number }[], myName: string) {
    this.sbEl.classList.toggle('ns-hidden', !show);
    if (!show) return;
    const sorted = [...rows].sort((a, b) => b.k - a.k);
    this.sbBody.innerHTML = `<div class="ns-sb-row head"><span>Player</span><span>Kills</span><span>Deaths</span></div>`;
    for (const r of sorted) {
      const div = document.createElement('div');
      div.className = 'ns-sb-row' + (r.name === myName ? ' me' : '');
      div.innerHTML = `<span>${esc(r.name)}</span><span>${r.k}</span><span>${r.d}</span>`;
      this.sbBody.appendChild(div);
    }
  }
}
