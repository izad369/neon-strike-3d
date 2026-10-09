// DESERT STRIKE 3D - main orchestrator: game states, modes (offline / host / client),
// offline game modes (DM / TDM / Survival / Gun Game), forced-landscape layout
import * as THREE from 'three';
import { CFG, fmtTime, Difficulty, ClientMsg, HostMsg, SnapBot, SnapPlayer, GameMode, MODE_LABEL } from './constants';
import { World } from './world';
import { AudioFX } from './audio';
import { Effects } from './effects';
import { LocalPlayer } from './player';
import { Bot, BotTarget, BotShot } from './bot';
import { RemotePlayer } from './remote';
import { HUD } from './hudbar';
import { Menus } from './menus';
import { NetHost, NetClient } from './net';
import { injectStyles } from './hud';
import { normKey } from './player';
import { TouchControls, detectTouch } from './touch';
import { loadSoldier } from './assets';
import { playerColor } from './avatar';
import { WEAPONS, GUN_GAME_LADDER } from './weapons';

type Mode = 'offline' | 'host' | 'client';
type State = 'menu' | 'lobby' | 'playing' | 'end';

interface ScoreEntry { k: number; d: number }

class Game {
  private world: World;
  private audio = new AudioFX();
  private fx: Effects;
  private hud: HUD;
  private menus: Menus;
  private player: LocalPlayer;
  private raf = 0;
  private clock = new THREE.Clock();
  private disposed = false;

  private mode: Mode | null = null;
  private state: State = 'menu';
  private paused = false;
  private expectUnlock = false;

  private host: NetHost | null = null;
  private client: NetClient | null = null;
  private myId = '1';
  private nextPeerNum = 2;
  private touch: TouchControls;
  private touchActive = false;
  private rotMq: MediaQueryList | null = null;

  private bots = new Map<string, Bot>();            // offline/host: full AI bots
  private botViews = new Map<string, RemotePlayer>(); // client: bot visuals
  private remotes = new Map<string, RemotePlayer>();  // other humans
  private scores = new Map<string, ScoreEntry>();
  private names = new Map<string, string>();
  private matchTime = CFG.matchTime;
  private diff: Difficulty = 'medium';
  private gameMode: GameMode = 'dm';
  // TDM: id -> team (0 = player's allies, 1 = enemies)
  private teams = new Map<string, number>();
  // survival wave state
  private survWave = 0;
  private survPending = 0;      // bots left to spawn for the current wave
  private survIntermission = 0; // timestamp when the next wave spawns
  private survElapsed = 0;
  private survEnding = false;
  private lastWaveAlive = 0;

  private lastSnapSent = 0;
  private lastInputSent = 0;
  private respawnDeadline = 0;
  private hostRespawns = new Map<string, number>();
  private prevShootFlags = new Map<string, boolean>();

  constructor(private root: HTMLElement) {
    // touch detection first — it tunes the renderer for mobile GPUs
    this.touchActive = detectTouch();
    if (this.touchActive) this.root.classList.add('ns-touch-mode');
    this.world = new World(root, { mobile: this.touchActive });
    this.world.scene.add(this.world.camera);
    this.fx = new Effects(this.world.scene);
    this.hud = new HUD(root);
    this.touch = new TouchControls(root, {
      onPause: () => { if (this.state === 'playing' && !this.paused && !this.menus.isVisible()) this.pauseGame(); },
      onScoreboard: (show) => this.showScoreboard(show),
    });
    this.menus = new Menus(root, {
      onStartOffline: (name, bots, diff, mode) => this.startOffline(name, bots, diff, mode),
      onHost: (name, bots, diff) => this.startHost(name, bots, diff),
      onJoin: (name, code) => this.joinMatch(name, code),
      onResume: () => this.resume(),
      onLeaveToMenu: () => this.leaveToMenu(),
      onRestartMatch: () => this.restartMatch(),
      onTouchMode: () => this.applyTouchMode(),
    });
    this.menus.loadName();
    this.menus.initTouchSeg();
    this.player = new LocalPlayer(this.world, this.world.camera, this.audio, root);
    this.player.onShoot = (o, d) => this.onLocalShoot(o, d);
    this.player.touch = this.touch;
    this.player.onWeaponSwitch = (spec, slot) => {
      this.hud.setWeaponName(spec.name);
      this.hud.toast(`${spec.name}  [${slot + 1}/7]`);
    };
    this.player.onCrouchChange = (c) => this.hud.setCrouchIndicator(c);

    window.addEventListener('resize', this.onResize);
    document.addEventListener('pointerlockchange', this.onPointerLock);
    window.addEventListener('keydown', this.onKeydown);
    window.addEventListener('keyup', this.onKeyup);
    this.world.renderer.domElement.addEventListener('click', this.onCanvasClick);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('ns-lobby-start', this.onLobbyStart as EventListener);
    // re-layout on rotation (game keeps rendering landscape via forced rotation)
    this.rotMq = window.matchMedia('(orientation: portrait)');
    this.rotMq.addEventListener?.('change', this.onOrientationChange);
    window.visualViewport?.addEventListener?.('resize', this.onResize);

    this.hud.setWeaponName(WEAPONS[this.player.weaponIndex].name);
    this.menus.show('main');
    this.renderLoop();
  }

  // ================= mode setup =================

  private resetWorldEntities() {
    for (const b of this.bots.values()) this.world.scene.remove(b.group);
    this.bots.clear();
    for (const r of this.botViews.values()) this.world.scene.remove(r.group);
    this.botViews.clear();
    for (const r of this.remotes.values()) this.world.scene.remove(r.group);
    this.remotes.clear();
    this.scores.clear();
    this.names.clear();
    this.teams.clear();
    this.hostRespawns.clear();
    this.prevShootFlags.clear();
    this.fx.clear();
  }

  private setupLocal(name: string) {
    this.scores.set(this.myId, { k: 0, d: 0 });
    this.names.set(this.myId, name);
    this.menus.saveName();
    this.player.spawnAt(this.world.pickSpawn([new THREE.Vector3(0, 0, 0)]));
    this.player.sensitivity = parseInt(this.menus.sensSlider.value, 10) / 100 || 1;
  }

  /** touch UI + immersive mode (fullscreen / landscape lock) when a match starts */
  private enterTouchUI() {
    if (this.touchActive) {
      this.tryImmersive();
      this.touch.setEnabled(true);
      this.hud.setHint('');
    } else {
      this.hud.setHint('ESC — pause  |  TAB — scoreboard');
    }
    this.requestLock();
  }

  /** best-effort fullscreen + landscape lock (Android; iOS Safari ignores gracefully) */
  private tryImmersive() {
    try {
      const el = document.documentElement as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> };
      if (!document.fullscreenElement) {
        const p = el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.();
        p?.catch(() => { /* user or browser refused — fine */ });
      }
    } catch { /* unsupported */ }
    try {
      const so = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      so?.lock?.('landscape')?.catch(() => { /* unsupported */ });
    } catch { /* unsupported */ }
  }

  /** touch mode changed from the pause menu — re-evaluate and apply live */
  private applyTouchMode() {
    const active = detectTouch();
    if (active === this.touchActive) { if (this.state === 'playing' && !this.paused) this.touch.setEnabled(active); return; }
    this.touchActive = active;
    this.root.classList.toggle('ns-touch-mode', active);
    if (this.state === 'playing' && !this.paused) this.touch.setEnabled(active);
  }

  /**
   * Layout: on touch devices in portrait the whole game is rendered rotated
   * 90° (forced landscape) instead of pausing — plus a gentle rotate hint.
   */
  private applyLayout() {
    const vv = window.visualViewport;
    const vw = Math.round(vv?.width ?? window.innerWidth);
    const vh = Math.round(vv?.height ?? window.innerHeight);
    const portrait = vh > vw;
    const force = this.touchActive && portrait;
    this.root.classList.toggle('ns-forced-landscape', force);
    this.world.resize(force ? vh : vw, force ? vw : vh);
  }

  private onOrientationChange = () => {
    this.applyLayout();
    if (this.touchActive && this.state === 'playing') this.touch.showRotateHint(true);
  };

  private enterMatch() {
    this.state = 'playing';
    this.paused = false;
    this.menus.show(null);
    this.hud.show(true);
    this.hud.setRoom(this.mode === 'host' ? `ROOM ${this.host?.code ?? ''}` : this.mode === 'client' ? `ROOM ${this.clientRoom}` : '');
    this.hud.setWeaponName(WEAPONS[this.player.weaponIndex].name);
    this.enterTouchUI();
    this.applyLayout();
    if (this.touchActive && this.isPortrait()) this.touch.showRotateHint(true);
  }

  private isPortrait(): boolean {
    return (window.visualViewport?.height ?? window.innerHeight) > (window.visualViewport?.width ?? window.innerWidth);
  }

  private startOffline(name: string, botCount: number, diff: Difficulty, mode: GameMode) {
    this.audio.resume();
    this.cleanupNet();
    this.resetWorldEntities();
    this.mode = 'offline';
    this.myId = '1';
    this.diff = diff;
    this.gameMode = mode;
    this.setupLocal(name);
    this.initModeState(botCount);
    this.hud.setKD(0, 0);
    this.enterMatch();
  }

  /** mode-specific setup, shared by startOffline and restartMatch */
  private initModeState(botCount: number) {
    this.offlineBotCount = botCount;
    this.teams.clear();
    this.survWave = 0; this.survPending = 0; this.survIntermission = 0;
    this.survElapsed = 0; this.survEnding = false; this.lastWaveAlive = 0;
    if (this.gameMode === 'tdm') {
      this.teams.set(this.myId, 0);
      // half of the bots are allies, the rest enemies
      const allies = Math.floor(botCount / 2);
      for (let i = 0; i < botCount; i++) this.addBot(this.diff, { team: i < allies ? 0 : 1, idx: i });
      this.matchTime = CFG.matchTime;
    } else if (this.gameMode === 'survival') {
      this.matchTime = 9999 * 60; // counts up; HUD shows wave info
      this.survIntermission = performance.now() + 3200;
      this.hud.toast('SURVIVAL — GET READY', 2600);
    } else if (this.gameMode === 'gun') {
      this.matchTime = CFG.gunGameTime;
      for (let i = 0; i < 5; i++) this.addBot(this.diff, { idx: i });
      this.player.switchWeapon(GUN_GAME_LADDER[0], true);
    } else {
      this.matchTime = CFG.matchTime;
      for (let i = 0; i < botCount; i++) this.addBot(this.diff, { idx: i });
    }
  }

  private addBot(diff: Difficulty, opts?: { team?: number; idx?: number; hpScale?: number; dmgScale?: number; noRespawn?: boolean }) {
    const idx = opts?.idx ?? this.bots.size;
    const id = 'b' + (this.bots.size + 1);
    const name = this.menus.botNameFor(idx);
    // TDM: team colors (olive allies / red enemies). DM: per-bot marker palette.
    const color = opts?.team !== undefined
      ? (opts.team === 0 ? 0x7d8f4e : 0xb0432a)
      : botColor(id);
    const bot = new Bot(name, color, diff, this.world, this.audio, shot => this.onBotShot(shot), {
      team: opts?.team ?? -1,
      hpScale: opts?.hpScale,
      dmgScale: opts?.dmgScale,
      noRespawn: opts?.noRespawn,
    });
    bot.spawnAt(this.world.pickSpawn(this.alivePositions()));
    this.world.scene.add(bot.group);
    this.bots.set(id, bot);
    this.scores.set(id, { k: 0, d: 0 });
    this.names.set(id, name);
    if (opts?.team !== undefined) this.teams.set(id, opts.team);
    return bot;
  }

  /** spawn the next survival wave (bigger + meaner every wave) */
  private spawnSurvivalWave() {
    // clean up previous wave corpses (survival bots never respawn)
    const dead: string[] = [];
    this.bots.forEach((b, id) => { if (!b.alive) dead.push(id); });
    for (const id of dead) {
      this.world.scene.remove(this.bots.get(id)!.group);
      this.bots.delete(id);
    }
    this.survWave++;
    const n = CFG.survivalStartBots + (this.survWave - 1) * CFG.survivalPerWave;
    const batch = Math.min(n, CFG.survivalMaxAlive);
    this.survPending = n - batch;
    const hpScale = Math.min(2.2, 1 + 0.12 * (this.survWave - 1));
    const dmgScale = Math.min(2.2, 1 + 0.09 * (this.survWave - 1));
    for (let i = 0; i < batch; i++) {
      const bot = this.addBot(this.diff, {
        idx: this.bots.size,
        hpScale, dmgScale, noRespawn: true,
        team: this.gameMode === 'tdm' ? 1 : undefined,
      });
      bot.spawnAt(this.world.pickSpawn(this.alivePositions()));
    }
    this.lastWaveAlive = batch;
    this.hud.toast(`WAVE ${this.survWave}`, 2000);
    this.audio.waveStart();
    // fresh magazines each wave
    this.player.refillAll();
    this.player.hp = Math.min(CFG.playerHp, this.player.hp + 30);
  }

  // ---- host (online) ----
  private clientRoom = '';

  private startHost(name: string, botCount: number, diff: Difficulty) {
    this.audio.resume();
    this.cleanupNet();
    this.resetWorldEntities();
    this.mode = 'host';
    this.myId = '1';
    this.diff = diff;
    this.gameMode = 'dm'; // online stays deathmatch
    this.setupLocal(name);
    this.initModeState(botCount);
    this.menus.show('lobby');
    this.menus.setLobby('.....', 1);
    this.menus.setLobbyNote('Creating room...');
    this.state = 'lobby';
    this.host = new NetHost({
      onOpen: (code) => {
        this.menus.setLobby(code, 1 + this.host!.conns.length);
        this.menus.setLobbyNote('Waiting for players... press Start when ready.');
        this.audio.ui();
      },
      onPeerJoin: (conn) => {
        this.menus.setLobby(this.host!.code, 1 + this.host!.conns.length);
        this.menus.setLobbyNote('Player connected! Waiting for host to start.');
        this.audio.ui();
      },
      onPeerLeave: (conn) => {
        const id = this.connId(conn);
        if (id) this.removeRemote(id);
        this.menus.setLobby(this.host!.code, 1 + this.host!.conns.length);
      },
      onMsg: (conn, msg) => this.onHostMsg(conn, msg),
      onError: (err) => { this.menus.setLobbyNote('⚠ ' + err); },
    });
    this.host.start();
  }

  private connIds = new Map<unknown, string>();
  private connId(conn: unknown): string | null {
    for (const [k, v] of this.connIds) if (k === conn) return v;
    return null;
  }

  private onHostMsg(conn: unknown, msg: ClientMsg) {
    if (msg.t === 'hi') {
      const id = String(this.nextPeerNum++);
      this.connIds.set(conn, id);
      const rp = new RemotePlayer(id, msg.name);
      rp.hp = 100; rp.alive = true;
      this.world.scene.add(rp.group);
      this.remotes.set(id, rp);
      this.scores.set(id, { k: 0, d: 0 });
      this.names.set(id, msg.name);
      const namesObj: Record<string, string> = {};
      this.names.forEach((n, i) => { namesObj[i] = n; });
      const scObj: Record<string, [number, number]> = {};
      this.scores.forEach((s, i) => { scObj[i] = [s.k, s.d]; });
      this.host!.send(conn as never, {
        t: 'init', id, cfg: { bots: this.bots.size, diff: this.diff },
        tm: this.state === 'playing' ? this.matchTime : CFG.matchTime, sc: scObj, names: namesObj,
      } as HostMsg);
      if (this.state === 'playing') {
        const p = this.world.pickSpawn(this.alivePositions());
        this.host!.send(conn as never, { t: 'ev', k: 'spawn', i: id, p: [p.x, p.y, p.z] } as HostMsg);
      }
      return;
    }
    const id = this.connId(conn);
    if (!id) return;
    const rp = this.remotes.get(id);
    if (msg.t === 'st' && rp) {
      rp.applySnap({ i: id, p: msg.p, y: msg.y, x: msg.x, m: msg.m, s: msg.s, hp: msg.hp, n: this.names.get(id) ?? 'PLAYER' }, performance.now());
      if (msg.hp <= 0 && rp.alive) { /* host will handle via damage application path */ }
      if (msg.s === 1 && this.prevShootFlags.get(id) !== true) {
        this.audio.remoteShoot();
        this.fx.tracer(new THREE.Vector3(msg.p[0], msg.p[1] + 1.1, msg.p[2]),
          new THREE.Vector3(msg.p[0] - Math.sin(msg.y) * 30, msg.p[1] + 1.1 + Math.sin(msg.x) * 30, msg.p[2] - Math.cos(msg.y) * 30));
      }
      this.prevShootFlags.set(id, msg.s === 1);
    } else if (msg.t === 'hit') {
      this.applyClientHit(id, msg.tg, msg.hs === 1, new THREE.Vector3(...msg.o), new THREE.Vector3(...msg.d));
    } else if (msg.t === 'bye') {
      this.removeRemote(id);
    }
  }

  private removeRemote(id: string) {
    const rp = this.remotes.get(id);
    if (rp) { this.world.scene.remove(rp.group); this.remotes.delete(id); }
    this.connIds.forEach((v, k) => { if (v === id) this.connIds.delete(k); });
  }

  private applyClientHit(attackerId: string, targetId: string, hs: boolean, o: THREE.Vector3, d: THREE.Vector3) {
    if (this.state !== 'playing') return;
    const attackerName = this.names.get(attackerId) ?? attackerId;
    const bot = this.bots.get(targetId);
    const rp = this.remotes.get(targetId);
    const local = targetId === this.myId;
    const dmg = CFG.damage * (hs ? CFG.headshotMul : 1);
    if (bot && bot.alive) {
      this.fx.tracer(o, o.clone().add(d.clone().multiplyScalar(CFG.range)), 0xffe9a0);
      const died = bot.takeDamage(dmg, performance.now(), o);
      this.afterDamage(targetId, attackerId, attackerName, hs, died);
    } else if (rp && rp.alive && targetId !== attackerId) {
      this.fx.tracer(o, o.clone().add(d.clone().multiplyScalar(CFG.range)), 0xffe9a0);
      const newHp = Math.max(0, rp.hp - dmg);
      rp.hp = newHp;
      this.host!.broadcast({ t: 'ev', k: 'dmg', i: targetId, amt: dmg } as HostMsg);
      const died = newHp <= 0;
      if (died) this.afterDamage(targetId, attackerId, attackerName, hs, true);
    } else if (local) {
      const died = this.player.takeDamage(dmg, performance.now());
      this.hud.damageFlash();
      if (died) this.afterDamage(this.myId, attackerId, attackerName, hs, true);
    }
  }

  // ---- client (online) ----
  private joinMatch(name: string, code: string) {
    this.audio.resume();
    this.cleanupNet();
    this.resetWorldEntities();
    this.mode = 'client';
    this.myId = '?';
    this.clientRoom = code.toUpperCase();
    this.menus.show('lobby');
    this.menus.setLobby(this.clientRoom, 0);
    this.menus.setLobbyNote('Connecting to room ' + this.clientRoom + '...');
    this.state = 'lobby';
    this.client = new NetClient({
      onOpen: () => {
        this.client!.send({ t: 'hi', name });
        this.menus.setLobbyNote('Connected! Waiting for the host to start...');
      },
      onMsg: (msg) => this.onClientMsg(msg),
      onError: (err) => { this.menus.setLobbyNote('⚠ ' + err); },
      onClosed: () => {
        if (this.state === 'playing' || this.state === 'end') {
          this.leaveToMenu();
          this.menus.setStatus('Disconnected from host.', true);
        }
      },
    });
    this.client.connect(code);
  }

  private onClientMsg(msg: HostMsg) {
    if (msg.t === 'init') {
      this.myId = msg.id;
      this.names = new Map(Object.entries(msg.names));
      this.scores = new Map(Object.entries(msg.sc).map(([k, v]) => [k, { k: v[0], d: v[1] }]));
      this.matchTime = msg.tm;
      this.player.spawnAt(new THREE.Vector3(0, 0, 30));
      this.player.enabled = false;
      return;
    }
    if (msg.t === 'ev' && msg.k === 'start') {
      this.diff = msg.cfg.diff;
      this.matchTime = CFG.matchTime;
      this.scores.forEach(s => { s.k = 0; s.d = 0; });
      this.state = 'playing';
      this.menus.show(null);
      this.hud.show(true);
      this.hud.setRoom('ROOM ' + this.clientRoom);
      this.hud.setKD(0, 0);
      this.player.hp = 100;
      this.player.alive = true;
      this.enterTouchUI();
      return;
    }
    if (msg.t === 'snap') {
      this.matchTime = msg.tm;
      const now = performance.now();
      for (const sp of msg.pl) {
        if (sp.i === this.myId) { this.player.hp = sp.hp; this.player.alive = sp.hp > 0; continue; }
        let rp = this.remotes.get(sp.i);
        if (!rp) {
          rp = new RemotePlayer(sp.i, sp.n);
          this.world.scene.add(rp.group);
          this.remotes.set(sp.i, rp);
          if (!this.scores.has(sp.i)) this.scores.set(sp.i, { k: 0, d: 0 });
        }
        rp.applySnap(sp, now);
        if (sp.s === 1 && this.prevShootFlags.get(sp.i) !== true) {
          this.audio.remoteShoot();
          this.fx.tracer(new THREE.Vector3(sp.p[0], sp.p[1] + 1.1, sp.p[2]),
            new THREE.Vector3(sp.p[0] - Math.sin(sp.y) * 30, sp.p[1] + 1.1 + Math.sin(sp.x) * 30, sp.p[2] - Math.cos(sp.y) * 30), 0xffd080);
        }
        this.prevShootFlags.set(sp.i, sp.s === 1);
      }
      for (const sb of msg.bt) {
        let bv = this.botViews.get(sb.i);
        if (!bv) {
          bv = new RemotePlayer(sb.i, this.names.get(sb.i) ?? 'BOT');
          this.world.scene.add(bv.group);
          this.botViews.set(sb.i, bv);
          if (!this.scores.has(sb.i)) this.scores.set(sb.i, { k: 0, d: 0 });
        }
        bv.applySnap({ i: sb.i, p: sb.p, y: sb.y, x: 0, m: sb.st as 0 | 1, s: sb.st as 0 | 1, hp: sb.hp, n: this.names.get(sb.i) ?? 'BOT' }, now);
      }
      const scObj = msg.sc;
      this.scores.forEach((s, i) => { if (scObj[i]) { s.k = scObj[i][0]; s.d = scObj[i][1]; } });
      this.hud.setKD(this.scores.get(this.myId)?.k ?? 0, this.scores.get(this.myId)?.d ?? 0);
      return;
    }
    if (msg.t === 'ev') {
      if (msg.k === 'kill') {
        const kn = this.names.get(msg.b) ?? '?', vn = this.names.get(msg.v) ?? '?';
        this.hud.feed(kn, vn, msg.hs, msg.b === this.myId || msg.v === this.myId);
        if (msg.b === this.myId) this.audio.kill();
        if (msg.v === this.myId) this.onLocalDeath();
      } else if (msg.k === 'spawn') {
        if (msg.i === this.myId) this.respawnLocal(new THREE.Vector3(...msg.p));
      } else if (msg.k === 'dmg') {
        if (msg.i === this.myId) {
          this.player.applyServerDamage(msg.amt);
          this.hud.damageFlash();
        }
      } else if (msg.k === 'end') {
        this.state = 'end';
        this.expectUnlock = true;
        document.exitPointerLock?.();
        this.player.enabled = false;
        this.touch.setEnabled(false);
        this.hud.show(false);
        this.audio.matchEnd();
        this.menus.showEnd(msg.board, this.myId, false);
      }
    }
  }

  // ================= combat =================

  private alivePositions(): THREE.Vector3[] {
    const list: THREE.Vector3[] = [];
    if (this.player.alive) list.push(this.player.pos);
    for (const b of this.bots.values()) if (b.alive) list.push(b.pos);
    for (const r of this.remotes.values()) if (r.alive) list.push(r.group.position);
    return list;
  }

  private entityHitMeshes(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    if (this.mode === 'client') {
      this.botViews.forEach(v => out.push(...v.hitMeshes));
      this.remotes.forEach(r => out.push(...r.hitMeshes));
    } else {
      this.bots.forEach(b => out.push(...b.hitMeshes));
      this.remotes.forEach(r => out.push(...r.hitMeshes));
    }
    return out;
  }

  private onLocalShoot(origin: THREE.Vector3, dir: THREE.Vector3) {
    const hit = this.world.raycast(origin, dir, this.player.currentSpec.range, this.entityHitMeshes());
    const end = hit ? hit.point : origin.clone().add(dir.clone().multiplyScalar(this.player.currentSpec.range));
    this.fx.muzzleFlash(this.player.vm.muzzleWorld);
    this.fx.tracer(this.player.vm.muzzleWorld, end);
    if (!hit) return;
    const mesh = hit.object as THREE.Mesh;
    const botId = mesh.userData.botId as string | undefined;
    const remoteId = mesh.userData.remoteId as string | undefined;
    const isEntity = botId || remoteId;
    if (isEntity) {
      const targetId = botId ?? remoteId!;
      // TDM friendly fire: shooting an ally just sparks, no damage/no hitmarker
      if (this.gameMode === 'tdm' && this.teams.get(targetId) === this.teams.get(this.myId)) {
        this.fx.sparks(hit.point, 0x8a8f70, 4);
        return;
      }
      this.fx.sparks(hit.point, 0xb03226, 6);
      this.audio.hit();
      this.hud.hitmarker(!!hit.headshot);
      if (this.mode === 'client') {
        this.client?.send({ t: 'hit', tg: targetId, hs: hit.headshot ? 1 : 0, o: [origin.x, origin.y, origin.z], d: [dir.x, dir.y, dir.z] });
      } else {
        const spec = this.player.currentSpec;
        const dmg = spec.damage * (hit.headshot ? spec.headshotMul : 1);
        const bot = this.bots.get(targetId);
        const rp = this.remotes.get(targetId);
        if (bot && bot.alive) {
          const died = bot.takeDamage(dmg, performance.now(), origin);
          this.afterDamage(targetId, this.myId, this.names.get(this.myId) ?? 'YOU', hit.headshot, died);
        } else if (rp && rp.alive) {
          rp.hp = Math.max(0, rp.hp - dmg);
          this.host?.broadcast({ t: 'ev', k: 'dmg', i: targetId, amt: dmg } as HostMsg);
          if (rp.hp <= 0) this.afterDamage(targetId, this.myId, this.names.get(this.myId) ?? 'YOU', hit.headshot, true);
        }
      }
    } else {
      this.fx.sparks(hit.point, 0xffe14d, 5);
    }
  }

  private onBotShot(shot: BotShot) {
    this.fx.tracer(shot.from, shot.to, 0xff9c5b);
    if (!shot.targetId) return;
    // TDM: bots never target teammates, but guard anyway
    if (this.gameMode === 'tdm' && this.teams.get(shot.targetId) !== undefined
        && this.teams.get(shot.targetId) === this.bots.get(this.shooterBotId(shot))?.team) return;
    if (this.mode === 'offline') {
      if (shot.targetId === this.myId) {
        const died = this.player.takeDamage(shot.dmg, performance.now());
        this.hud.damageFlash();
        if (died) this.afterDamage(this.myId, this.lastBotShooter(shot), this.bots.get(this.lastBotShooter(shot))?.name ?? 'BOT', shot.headshot, true);
      } else {
        const victim = this.bots.get(shot.targetId);
        if (victim && victim.alive) {
          const died = victim.takeDamage(shot.dmg, performance.now(), shot.from);
          if (died) this.afterDamage(shot.targetId, this.lastBotShooter(shot), this.bots.get(this.lastBotShooter(shot))?.name ?? 'BOT', shot.headshot, true);
        }
      }
    } else if (this.mode === 'host') {
      if (shot.targetId === this.myId) {
        const died = this.player.takeDamage(shot.dmg, performance.now());
        this.hud.damageFlash();
        if (died) this.afterDamage(this.myId, this.lastBotShooter(shot), this.bots.get(this.lastBotShooter(shot))?.name ?? 'BOT', shot.headshot, true);
      } else {
        const rp = this.remotes.get(shot.targetId);
        if (rp && rp.alive) {
          rp.hp = Math.max(0, rp.hp - shot.dmg);
          this.host?.broadcast({ t: 'ev', k: 'dmg', i: shot.targetId, amt: shot.dmg } as HostMsg);
          if (rp.hp <= 0) this.afterDamage(shot.targetId, this.lastBotShooter(shot), this.bots.get(this.lastBotShooter(shot))?.name ?? 'BOT', shot.headshot, true);
        }
      }
    }
  }

  private shooterBotId(shot: BotShot): string {
    let best = '', bestD = Infinity;
    this.bots.forEach((b, id) => {
      const d = b.pos.distanceTo(shot.from);
      if (d < bestD) { bestD = d; best = id; }
    });
    return best;
  }

  private lastBotShooter(shot: BotShot): string {
    // find which bot fired by proximity of shot origin
    let best: string | null = null, bestD = Infinity;
    this.bots.forEach(b => {
      const d = b.pos.distanceTo(shot.from);
      if (d < bestD) { bestD = d; best = b.id; }
    });
    return best ?? 'bot';
  }

  private afterDamage(victimId: string, killerId: string, killerName: string, hs: boolean, died: boolean) {
    if (!died) return;
    const v = this.scores.get(victimId) ?? { k: 0, d: 0 };
    v.d++; this.scores.set(victimId, v);
    if (killerId !== victimId) {
      const k = this.scores.get(killerId) ?? { k: 0, d: 0 };
      k.k++; this.scores.set(killerId, k);
    }
    const victimName = this.names.get(victimId) ?? 'PLAYER';
    this.hud.feed(killerName, victimName, hs, killerId === this.myId || victimId === this.myId);
    if (killerId === this.myId) this.audio.kill();
    if (victimId === this.myId) this.onLocalDeath();
    this.host?.broadcast({ t: 'ev', k: 'kill', v: victimId, b: killerId, hs } as HostMsg);
    // schedule respawn for victim humans (bots auto-respawn internally)
    if (this.mode === 'host' && this.remotes.has(victimId)) {
      const rp = this.remotes.get(victimId)!;
      rp.hp = 0; rp.alive = false;
      this.hostRespawns.set(victimId, performance.now() + CFG.respawnDelay * 1000);
    }
    if (this.mode !== 'client' && this.gameMode === 'dm' && killerId !== victimId
        && this.scores.get(killerId) && this.scores.get(killerId)!.k >= CFG.targetKills) {
      this.endMatch(); return;
    }
    if (this.mode === 'offline') {
      const myKills = this.scores.get(this.myId)?.k ?? 0;
      if (this.gameMode === 'gun' && killerId === this.myId) {
        const next = myKills; // ladder slot == kill count
        if (next >= GUN_GAME_LADDER.length) { this.endMatch(); return; }
        this.player.switchWeapon(GUN_GAME_LADDER[next]);
        this.player.refillAll();
      }
      if (this.gameMode === 'tdm') {
        const [a, b] = this.teamKillTotals();
        if (a >= CFG.tdmTargetKills || b >= CFG.tdmTargetKills) { this.endMatch(); return; }
      }
      if (this.gameMode === 'survival' && this.bots.has(victimId)) {
        // dead survival bots stay dead; wave clears when none left
        const aliveLeft = [...this.bots.values()].filter(b => b.alive).length;
        this.lastWaveAlive = aliveLeft + this.survPending;
        if (aliveLeft === 0 && this.survPending > 0) {
          // top-up remaining bots of this wave
          const add = Math.min(this.survPending, CFG.survivalMaxAlive - aliveLeft);
          this.survPending -= add;
          for (let i = 0; i < add; i++) {
            const bot = this.addBot(this.diff, {
              idx: this.bots.size,
              hpScale: Math.min(2.2, 1 + 0.12 * (this.survWave - 1)),
              dmgScale: Math.min(2.2, 1 + 0.09 * (this.survWave - 1)),
              noRespawn: true,
            });
            bot.spawnAt(this.world.pickSpawn(this.alivePositions()));
          }
        } else if (aliveLeft === 0 && this.survPending === 0) {
          this.survIntermission = performance.now() + CFG.survivalIntermission * 1000;
          this.hud.toast(`WAVE ${this.survWave} CLEARED`, 1800);
        }
      }
    }
  }

  private teamKillTotals(): [number, number] {
    let a = 0, b = 0;
    this.scores.forEach((s, id) => {
      const t = this.teams.get(id) ?? (id === this.myId ? 0 : 1);
      if (t === 0) a += s.k; else b += s.k;
    });
    return [a, b];
  }

  private onLocalDeath() {
    this.player.alive = false;
    this.player.enabled = false;
    this.touch.setEnabled(false); // hide touch UI during the respawn overlay
    if (this.mode === 'offline' && this.gameMode === 'survival') {
      // no respawns in survival — end shortly
      this.hud.showRespawn(true, 0);
      setTimeout(() => { if (this.state === 'playing') this.endMatch(); }, 1400);
      return;
    }
    this.respawnDeadline = performance.now() + CFG.respawnDelay * 1000;
    this.hud.showRespawn(true, CFG.respawnDelay);
    this.expectUnlock = false;
  }

  private respawnLocal(p: THREE.Vector3) {
    this.player.spawnAt(p);
    this.player.enabled = true;
    if (this.touchActive) this.touch.setEnabled(true);
    this.hud.showRespawn(false);
    if (this.state === 'playing') this.requestLock();
  }

  // ================= match flow =================

  private onLobbyStart = () => {
    if (this.mode !== 'host' || this.state !== 'lobby') return;
    this.matchTime = CFG.matchTime;
    this.host?.broadcast({ t: 'ev', k: 'start', cfg: { bots: this.bots.size, diff: this.diff } } as HostMsg);
    // give every connected client a spawn
    this.remotes.forEach((rp, id) => {
      const p = this.world.pickSpawn(this.alivePositions());
      rp.hp = 100;
      this.host?.send(this.connOf(id), { t: 'ev', k: 'spawn', i: id, p: [p.x, p.y, p.z] } as HostMsg);
    });
    this.player.spawnAt(this.world.pickSpawn(this.alivePositions()));
    this.hud.setKD(0, 0);
    this.enterMatch();
  };

  private connOf(id: string): never {
    for (const [k, v] of this.connIds) if (v === id) return k as never;
    throw new Error('conn not found');
  }

  private restartMatch() {
    if (this.mode === 'client') return;
    this.resetWorldEntities();
    this.scores.set(this.myId, { k: 0, d: 0 });
    this.player.spawnAt(this.world.pickSpawn([new THREE.Vector3(0, 0, 0)]));
    this.initModeState(this.gameMode === 'gun' ? 5 : this.offlineBotCount);
    if (this.mode === 'host') {
      this.host?.broadcast({ t: 'ev', k: 'start', cfg: { bots: this.bots.size, diff: this.diff } } as HostMsg);
      this.remotes.forEach((rp, id) => {
        if (!this.scores.has(id)) this.scores.set(id, { k: 0, d: 0 });
        rp.hp = 100;
        const p = this.world.pickSpawn(this.alivePositions());
        this.host?.send(this.connOf(id), { t: 'ev', k: 'spawn', i: id, p: [p.x, p.y, p.z] } as HostMsg);
      });
    }
    this.hud.setKD(0, 0);
    this.enterMatch();
  }

  private offlineBotCount = 5;

  private endMatch() {
    const board: [string, string, number, number][] = [];
    this.scores.forEach((s, id) => board.push([id, this.names.get(id) ?? 'PLAYER', s.k, s.d]));
    board.sort((a, b) => b[2] - a[2]);
    this.state = 'end';
    this.expectUnlock = true;
    document.exitPointerLock?.();
    this.player.enabled = false;
    this.touch.setEnabled(false);
    this.hud.show(false);
    this.hud.showRespawn(false);
    this.audio.matchEnd();
    if (this.mode === 'offline' && this.gameMode === 'survival') {
      const k = this.scores.get(this.myId)?.k ?? 0;
      this.menus.showSurvivalEnd(Math.max(1, this.survWave), k, this.names.get(this.myId) ?? 'YOU');
      return;
    }
    if (this.mode === 'offline' && this.gameMode === 'tdm') {
      const [a, b] = this.teamKillTotals();
      this.menus.showTeamEnd(a, b, this.names.get(this.myId) ?? 'YOU', a >= b);
      return;
    }
    this.host?.broadcast({ t: 'ev', k: 'end', board } as HostMsg);
    this.menus.showEnd(board, this.myId, this.mode !== 'client');
  }

  private leaveToMenu() {
    this.cleanupNet();
    this.resetWorldEntities();
    this.mode = null;
    this.state = 'menu';
    this.paused = false;
    this.expectUnlock = true;
    document.exitPointerLock?.();
    this.touch.setEnabled(false);
    this.hud.show(false);
    this.hud.showRespawn(false);
    this.hud.scoreboard(false, [], '');
    this.menus.setStatus('');
    this.menus.show('main');
  }

  private cleanupNet() {
    this.host?.destroy(); this.host = null;
    this.client?.destroy(); this.client = null;
    this.connIds.clear();
    this.nextPeerNum = 2;
  }

  // ================= input & loop =================

  private requestLock() {
    if (this.touchActive) return; // no pointer lock on touch devices
    this.expectUnlock = false;
    this.world.renderer.domElement.requestPointerLock?.();
  }

  private resume() {
    this.menus.show(null);
    this.paused = false;
    this.player.enabled = this.player.alive;
    if (this.touchActive) this.touch.setEnabled(true);
    this.requestLock();
    this.audio.resume();
  }

  private pauseGame() {
    this.paused = true;
    this.player.enabled = false;
    this.player.mouseDown = false;
    this.touch.setEnabled(false);
    this.menus.show('pause');
  }

  private onCanvasClick = () => {
    if (this.touchActive) return; // taps belong to the touch zones
    if (this.state === 'playing' && !this.menus.isVisible()) this.requestLock();
  };

  private onPointerLock = () => {
    const locked = document.pointerLockElement === this.world.renderer.domElement;
    if (!locked && this.state === 'playing' && !this.expectUnlock && !this.menus.isVisible()) {
      this.pauseGame();
    }
  };

  private onKeydown = (e: KeyboardEvent) => {
    if (this.state !== 'playing') return;
    if (normKey(e) === 'Tab' && !e.repeat) {
      e.preventDefault();
      this.showScoreboard(true);
    }
  };
  private onKeyup = (e: KeyboardEvent) => {
    if (normKey(e) === 'Tab') this.showScoreboard(false);
  };

  private showScoreboard(show: boolean) {
    const rows: { name: string; k: number; d: number }[] = [];
    this.scores.forEach((s, id) => rows.push({ name: this.names.get(id) ?? id, k: s.k, d: s.d }));
    this.hud.scoreboard(show, rows, this.names.get(this.myId) ?? '');
  }

  private onResize = () => this.applyLayout();
  private onBeforeUnload = () => {
    if (this.mode === 'client') this.client?.send({ t: 'bye' });
  };

  private tick(dt: number, now: number) {
    const inMenu = this.state === 'menu' || this.state === 'lobby' || this.state === 'end';
    if (inMenu) {
      // idle orbit camera
      const t = now * 0.00008;
      this.world.camera.position.set(Math.cos(t) * 34, 16 + Math.sin(t * 0.7) * 3, Math.sin(t) * 34);
      this.world.camera.lookAt(0, 2, 0);
      this.player.vm.setVisible(false);
      return;
    }
    if (this.paused) return;

    // local player
    this.player.enabled = this.player.alive && !this.menus.isVisible();
    const { fired } = this.player.update(dt, now);
    void fired;
    this.player.syncCamera(this.world.camera);

    // death / respawn (offline & host)
    if ((this.mode === 'offline' || this.mode === 'host') && !this.player.alive && this.respawnDeadline > 0) {
      const remain = (this.respawnDeadline - now) / 1000;
      this.hud.showRespawn(remain > 0, Math.max(0, remain));
      if (remain <= 0) {
        this.respawnDeadline = 0;
        const p = this.world.pickSpawn(this.alivePositions());
        this.respawnLocal(p);
        this.host?.broadcast({ t: 'ev', k: 'spawn', i: this.myId, p: [p.x, p.y, p.z] } as HostMsg);
      }
    }

    // bots (offline & host)
    if (this.mode !== 'client') {
      const targets: BotTarget[] = [
        { id: this.myId, pos: this.player.pos, alive: this.player.alive, isLocal: true, team: this.teams.get(this.myId) ?? -1 },
      ];
      this.remotes.forEach((rp, id) => targets.push({ id, pos: rp.group.position, alive: rp.alive, isLocal: false, team: this.teams.get(id) ?? -1 }));
      // TDM: bots also fight each other -> include bots as targets
      if (this.mode === 'offline' && this.gameMode === 'tdm') {
        this.bots.forEach((b, id) => targets.push({ id, pos: b.pos, alive: b.alive, isLocal: false, team: b.team }));
      }
      this.bots.forEach(b => b.update(dt, now, targets));
      // remote human respawns (killed by bots/clients)
      this.hostRespawns.forEach((at, id) => {
        if (now >= at) {
          this.hostRespawns.delete(id);
          const rp = this.remotes.get(id);
          if (rp) { rp.hp = 100; rp.alive = true; }
          const p = this.world.pickSpawn(this.alivePositions());
          this.host?.broadcast({ t: 'ev', k: 'spawn', i: id, p: [p.x, p.y, p.z] } as HostMsg);
        }
      });
      // survival wave manager
      if (this.mode === 'offline' && this.gameMode === 'survival') {
        this.survElapsed += dt;
        const waveActive = this.lastWaveAlive > 0 || this.survPending > 0;
        if (!waveActive && this.survIntermission > 0 && now >= this.survIntermission) {
          this.survIntermission = 0;
          this.spawnSurvivalWave();
        }
      }
    }

    // remote/bot visuals (client interp; host direct)
    if (this.mode === 'client') {
      this.remotes.forEach(r => r.update(now, 100));
      this.botViews.forEach(b => b.update(now, 100));
    } else {
      this.remotes.forEach(r => r.update(now, 0));
    }

    // match timer
    let timerText = '', modeText = '';
    if (this.mode !== 'client') {
      if (this.mode === 'offline' && this.gameMode === 'survival') {
        timerText = fmtTime(this.survElapsed);
        const left = [...this.bots.values()].filter(b => b.alive).length + this.survPending;
        modeText = this.lastWaveAlive > 0 || this.survPending > 0
          ? `WAVE ${this.survWave} — ${left} LEFT`
          : this.survIntermission > 0
            ? `NEXT WAVE IN ${Math.max(1, Math.ceil((this.survIntermission - now) / 1000))}`
            : 'SURVIVAL';
      } else if (this.mode === 'offline' && this.gameMode === 'gun') {
        this.matchTime -= dt;
        if (this.matchTime <= 0) { this.matchTime = 0; this.endMatch(); return; }
        const k = this.scores.get(this.myId)?.k ?? 0;
        timerText = fmtTime(this.matchTime);
        modeText = `GUN ${Math.min(k + 1, GUN_GAME_LADDER.length)}/${GUN_GAME_LADDER.length} — ${this.player.currentSpec.name}`;
      } else if (this.mode === 'offline' && this.gameMode === 'tdm') {
        this.matchTime -= dt;
        if (this.matchTime <= 0) { this.matchTime = 0; this.endMatch(); return; }
        const [a, b] = this.teamKillTotals();
        timerText = fmtTime(this.matchTime);
        modeText = `ALLIES ${a} — ${b} ENEMY`;
      } else {
        this.matchTime -= dt;
        if (this.matchTime <= 0) { this.matchTime = 0; this.endMatch(); return; }
        timerText = fmtTime(this.matchTime);
        modeText = this.mode === 'offline' ? 'OFFLINE DEATHMATCH' : 'ONLINE DEATHMATCH';
      }
      // host snapshot broadcast
      if (this.mode === 'host' && now - this.lastSnapSent >= 1000 / CFG.snapRate) {
        this.lastSnapSent = now;
        this.sendSnapshot();
      }
    } else {
      timerText = fmtTime(this.matchTime);
      modeText = 'ONLINE DEATHMATCH';
    }
    this.hud.setTimer(timerText, modeText);

    // client input send
    if (this.mode === 'client' && this.player.alive && now - this.lastInputSent >= 1000 / CFG.inputRate) {
      this.lastInputSent = now;
      const st = this.player.netState();
      this.client?.send({ t: 'st', p: st.p, y: st.y, x: st.x, m: st.m, s: st.s, hp: st.hp });
    }

    // HUD
    this.hud.setHp(this.player.hp);
    this.hud.setAmmo(this.player.ammo, this.player.reloading);
    this.hud.setKD(this.scores.get(this.myId)?.k ?? 0, this.scores.get(this.myId)?.d ?? 0);
    this.fx.update(dt);
  }

  private sendSnapshot() {
    if (!this.host) return;
    const pl: SnapPlayer[] = [];
    const me = this.player.netState();
    pl.push({ i: this.myId, p: me.p, y: me.y, x: me.x, m: me.m, s: me.s, hp: me.hp, n: this.names.get(this.myId) ?? 'HOST' });
    this.remotes.forEach((rp, id) => {
      const pos = rp.group.position;
      pl.push({ i: id, p: [r2(pos.x), r2(pos.y), r2(pos.z)], y: r2(rp.group.rotation.y), x: 0, m: 0, s: this.prevShootFlags.get(id) ? 1 : 0, hp: Math.round(rp.hp), n: this.names.get(id) ?? 'PLAYER' });
    });
    const bt: SnapBot[] = [];
    this.bots.forEach((b, id) => {
      bt.push({ i: id, p: [r2(b.pos.x), r2(b.pos.y), r2(b.pos.z)], y: r2(b.yaw), hp: Math.round(b.hp), st: b.shooting ? 1 : 0 });
    });
    const sc: Record<string, [number, number]> = {};
    this.scores.forEach((s, i) => { sc[i] = [s.k, s.d]; });
    this.host.broadcast({ t: 'snap', tm: Math.round(this.matchTime), pl, bt, sc } as HostMsg);
  }

  private renderLoop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.renderLoop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.tick(dt, performance.now());
    this.world.renderer.render(this.world.scene, this.world.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.cleanupNet();
    window.removeEventListener('resize', this.onResize);
    window.visualViewport?.removeEventListener?.('resize', this.onResize);
    document.removeEventListener('pointerlockchange', this.onPointerLock);
    window.removeEventListener('keydown', this.onKeydown);
    window.removeEventListener('keyup', this.onKeyup);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.removeEventListener('ns-lobby-start', this.onLobbyStart as EventListener);
    this.rotMq?.removeEventListener?.('change', this.onOrientationChange);
    this.touch.destroy();
    this.player.dispose();
    this.world.dispose();
    this.root.remove();
  }
}

function r2(n: number): number { return Math.round(n * 100) / 100; }
function botColor(id: string): number {
  return playerColor(id);
}

export function mountGame(container: HTMLElement): () => void {
  injectStyles();
  void loadSoldier(); // start fetching the soldier avatar immediately (menu covers load time)
  const root = document.createElement('div');
  root.className = 'ns-root';
  container.appendChild(root);
  const game = new Game(root);
  // debug handle for automated testing only (opt-in via ?debug=1)
  if (typeof location !== 'undefined' && location.search.includes('debug=1')) {
    (globalThis as unknown as { __NS_DEBUG__?: unknown }).__NS_DEBUG__ = game;
  }
  return () => game.dispose();
}
