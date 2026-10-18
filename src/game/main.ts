// DESERT STRIKE 3D - main orchestrator: game states, modes (offline / host / client),
// game modes (DM / TDM / Survival / Gun Game / Duel / Battle Royale), maps, forced-landscape layout
import * as THREE from 'three';
import { CFG, fmtTime, Difficulty, ClientMsg, HostMsg, SnapBot, SnapPlayer, GameMode, MODE_LABEL, MapId, LootKind, LootInit, LOOT_LABEL, ZoneInfo } from './constants';
import { World } from './world';
import { AudioFX } from './audio';
import { Effects } from './effects';
import { LocalPlayer } from './player';
import { Bot, BotTarget, BotShot } from './bot';
import { RemotePlayer } from './remote';
import { HUD } from './hudbar';
import { Menus } from './menus';
import { NetHost, NetClient } from './net';
import { LanHost, LanClient } from './lan';
import { injectStyles } from './hud';
import { normKey } from './player';
import { TouchControls, detectTouch } from './touch';
import { loadSoldier } from './assets';
import { playerColor } from './avatar';
import { WEAPONS, GUN_GAME_LADDER, BR_LOOT_GUNS, WeaponSpec } from './weapons';
import { Loadout } from './menus';
import { recordMatch, saveCareerName } from './stats';

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
  private lanHost: LanHost | null = null;
  private lanClient: LanClient | null = null;
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

  // battle royale state
  private brZone: (ZoneInfo & {
    hold: number; shrinking: boolean; t: number;
    from: { cx: number; cz: number; r: number };
    to: { cx: number; cz: number; r: number };
  }) | null = null;
  private brZoneMesh: THREE.Mesh | null = null;
  private brZoneRing: THREE.Mesh | null = null;
  private brZoneDmgAt = 0;
  private brCheckAt = 0;
  private loots = new Map<number, { kind: LootKind; pos: THREE.Vector3; mesh: THREE.Mesh; taken: boolean; spin: boolean }>();
  private lootSeq = 1;
  private brPlane: THREE.Group | null = null;
  private zoneSync: ZoneInfo | null = null; // client: zone from host snapshots
  // duel state
  private duelScore: [number, number] = [0, 0];
  private duelRound = 1;
  private duelWaitUntil = 0;

  private lastSnapSent = 0;
  private lastInputSent = 0;
  private respawnDeadline = 0;
  private hostRespawns = new Map<string, number>();
  private prevShootFlags = new Map<string, boolean>();
  private pendingLoadout: Loadout = { knife: 0, primary: 10, backup: 4 };
  private hostLoadout: [number, number, number] = [0, 10, 4];
  private nextTeamFlip = false;
  private brSwapTarget: number | null = null;
  private lastSlotsSig = '';

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
      onRotateFlip: () => this.toggleRotFlip(),
    });
    this.menus = new Menus(root, {
      onStartOffline: (name, bots, diff, mode, map, lo) => this.startOffline(name, bots, diff, mode, map, lo),
      onHost: (name, bots, diff, mode, map, lo) => this.startHost(name, bots, diff, mode, map, lo),
      onJoin: (name, code) => this.joinMatch(name, code),
      onResume: () => this.resume(),
      onLeaveToMenu: () => this.leaveToMenu(),
      onRestartMatch: () => this.restartMatch(),
      onTouchMode: () => this.applyTouchMode(),
      onQuality: (pref) => this.world.setQuality(pref),
      onLanHost: (name, _bots, diff, mode, map, lo) => this.startLanHost(name, diff, mode, map, lo),
      onLanJoin: (name, invite) => this.startLanJoin(name, invite),
      onLanAnswer: (code) => this.lanAcceptAnswer(code),
      onLanAddPlayer: () => {
        this.lanHost?.createInvite();
        this.menus.setLanHostNote('New invite ready — show the QR to the next player.');
      },
      onLanCancel: () => this.lanCancel(),
    });
    this.menus.loadName();
    this.menus.initTouchSeg();
    this.menus.initGfxSeg();
    this.player = new LocalPlayer(this.world, this.world.camera, this.audio, root);
    this.player.onShoot = (o, d) => this.onLocalShoot(o, d);
    this.player.touch = this.touch;
    this.player.onWeaponSwitch = (spec, _slot, slotIdx) => {
      this.hud.setWeaponName(spec.name);
      this.hud.toast(`${spec.name}  [${slotIdx + 1}/3]`);
    };
    // tap/click a weapon slot in the top-right bar -> put that weapon in hand
    // (was never wired, so tapping a slot silently did nothing on mobile)
    this.hud.onSlotTap = (slot) => {
      if (this.state === 'playing' && !this.paused && !this.menus.isVisible()) {
        this.player.switchSlot(slot);
      }
    };
    this.player.onCrouchChange = (c) => this.hud.setCrouchIndicator(c);
    this.player.onAimChange = (a) => this.touch.setAimActive(a);

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
    // physical tilt hint: which way the phone is held (fixes inverted controls
    // when the picture is force-rotated) — best effort, iOS may not report it
    window.addEventListener('deviceorientation', this.onDeviceTilt as EventListener);

    this.hud.setWeaponName(WEAPONS[this.player.weaponIndex].name);
    this.applyLayout(); // initial forced-landscape / rotation pass
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
    this.clearBrVisuals();
    this.duelScore = [0, 0]; this.duelRound = 1; this.duelWaitUntil = 0;
    this.brZone = null; this.zoneSync = null;
    this.hud.setZoneWarn(false);
  }

  /** remove every battle-royale visual (zone cylinder, ring, plane, loot boxes) */
  private clearBrVisuals() {
    if (this.brZoneMesh) { this.world.scene.remove(this.brZoneMesh); this.brZoneMesh = null; }
    if (this.brZoneRing) { this.world.scene.remove(this.brZoneRing); this.brZoneRing = null; }
    if (this.brPlane) { this.world.scene.remove(this.brPlane); this.brPlane = null; }
    this.loots.forEach(l => this.world.scene.remove(l.mesh));
    this.loots.clear();
  }

  private setupLocal(name: string) {
    this.scores.set(this.myId, { k: 0, d: 0 });
    this.names.set(this.myId, name);
    this.menus.saveName();
    saveCareerName(name); // keep the CAREER screen's name in sync (APK-safe storage)
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
    this.applyLayout(); // re-evaluate forced landscape for the new touch state
    if (this.state === 'playing' && !this.paused) this.touch.setEnabled(active);
  }

  /**
   * Layout: on touch devices held portrait the whole game is rendered rotated
   * 90° (forced landscape, portrait is GONE). Rotation direction follows how
   * the phone is physically held so controls never feel inverted.
   */
  private applyLayout() {
    const vv = window.visualViewport;
    const vw = Math.round(vv?.width ?? window.innerWidth);
    const vh = Math.round(vv?.height ?? window.innerHeight);
    const portrait = vh > vw;
    const force = this.touchActive && portrait;
    let flip = false;
    if (force) {
      const ang = (typeof screen !== 'undefined' && screen.orientation) ? screen.orientation.angle : 0;
      if (ang === 180) flip = true;              // upside-down portrait
      else if (ang === 0) flip = this.tiltGamma > 45; // clockwise hold → mirrored rotate
      // ang 90/270 would already be landscape (no forcing)
      // Manual override (ROT button): embedded webviews (Aippy etc.) have no
      // device tilt, so the auto direction can be wrong for the user's grip.
      try {
        const pref = localStorage.getItem('ns_rot_flip');
        if (pref === '0' || pref === '1') flip = pref === '1';
      } catch { /* private mode */ }
    }
    this.root.classList.toggle('ns-forced-landscape', force && !flip);
    this.root.classList.toggle('ns-forced-landscape-flip', force && flip);
    this.touch.setForcedRotation(force ? (flip ? -90 : 90) : 0);
    this.touch.setRotVisible(force);
    this.world.resize(force ? vh : vw, force ? vw : vh);
  }

  private onOrientationChange = () => {
    this.applyLayout();
  };

  /** ROT button (forced landscape): flip which way the picture is rotated, remember it */
  private toggleRotFlip() {
    const flipped = this.root.classList.contains('ns-forced-landscape-flip');
    try { localStorage.setItem('ns_rot_flip', flipped ? '0' : '1'); } catch { /* private mode */ }
    this.applyLayout();
  }

  /** gamma > 45° means the phone's right edge points DOWN (clockwise hold) */
  private onDeviceTilt = (e: DeviceOrientationEvent) => {
    if (e.gamma !== null && Math.abs(e.gamma) > 40) this.tiltGamma = e.gamma;
  };
  private tiltGamma = 0;

  private enterMatch() {
    this.state = 'playing';
    this.paused = false;
    this.menus.show(null);
    this.hud.show(true);
    this.hud.showRespawn(false);
    this.hud.setZoneWarn(false);
    this.hud.setRoom(this.mode === 'host' ? `ROOM ${this.host?.code ?? ''}` : this.mode === 'client' ? `ROOM ${this.clientRoom}` : '');
    this.hud.setWeaponName(WEAPONS[this.player.weaponIndex].name);
    this.enterTouchUI();
    this.applyLayout();
  }

  private startOffline(name: string, botCount: number, diff: Difficulty, mode: GameMode, map: MapId, loadout: Loadout) {
    this.audio.resume();
    this.cleanupNet();
    this.resetWorldEntities();
    this.mode = 'offline';
    this.myId = '1';
    this.diff = diff;
    this.gameMode = mode;
    this.pendingLoadout = loadout;
    this.player.limitedAmmo = false;
    if (mode !== 'br' && mode !== 'gun') {
      this.player.setLoadout(loadout.knife, loadout.primary, loadout.backup);
    }
    this.world.setMap(mode === 'br' ? 'warzone' : map);
    this.setupLocal(name);
    this.initModeState(botCount, true);
    this.hud.setKD(0, 0);
    this.enterMatch();
  }

  /** mode-specific setup, shared by startOffline and restartMatch.
   *  spawnBots=false → humans only (online/local multiplayer: NO bots ever). */
  private initModeState(botCount: number, spawnBots: boolean) {
    this.offlineBotCount = botCount;
    this.teams.clear();
    this.survWave = 0; this.survPending = 0; this.survIntermission = 0;
    this.survElapsed = 0; this.survEnding = false; this.lastWaveAlive = 0;
    this.nextTeamFlip = false;
    if (this.gameMode === 'tdm') {
      this.teams.set(this.myId, 0);
      // half of the bots are allies, the rest enemies
      const allies = Math.floor(botCount / 2);
      if (spawnBots) for (let i = 0; i < botCount; i++) this.addBot(this.diff, { team: i < allies ? 0 : 1, idx: i, nameplate: i < allies });
      this.matchTime = CFG.matchTime;
    } else if (this.gameMode === 'survival') {
      this.matchTime = 9999 * 60; // counts up; HUD shows wave info
      this.survIntermission = performance.now() + 3200;
      this.hud.toast('SURVIVAL — GET READY', 2600);
    } else if (this.gameMode === 'gun') {
      this.matchTime = CFG.gunGameTime;
      for (let i = 0; i < 5; i++) this.addBot(this.diff, { idx: i });
      this.player.setWeaponDirect(GUN_GAME_LADDER[0]);
    } else if (this.gameMode === 'duel') {
      this.matchTime = 9999 * 60;
      this.duelScore = [0, 0]; this.duelRound = 1; this.duelWaitUntil = 0;
      if (spawnBots) {
        const bot = this.addBot(this.diff, { noRespawn: true });
        bot.spawnAt(this.world.pickSpawn([this.player.pos]));
      }
      this.hud.toast('DUEL — FIRST TO 3 ROUNDS', 2600);
    } else if (this.gameMode === 'br') {
      this.matchTime = 9999 * 60;
      this.setupBR(spawnBots);
    } else {
      this.matchTime = CFG.matchTime;
      if (spawnBots) for (let i = 0; i < botCount; i++) this.addBot(this.diff, { idx: i });
    }
  }

  private addBot(diff: Difficulty, opts?: { team?: number; idx?: number; hpScale?: number; dmgScale?: number; noRespawn?: boolean; nameplate?: boolean }) {
    const idx = opts?.idx ?? this.bots.size;
    const name = this.menus.botNameFor(idx);
    // TDM/BR: team colors (olive allies / red enemies). DM: per-bot marker palette.
    const color = opts?.team !== undefined
      ? (opts.team === 0 ? 0x7d8f4e : 0xb0432a)
      : botColor('b' + (idx + 1));
    const bot = new Bot(name, color, diff, this.world, this.audio, shot => this.onBotShot(shot), {
      team: opts?.team ?? -1,
      hpScale: opts?.hpScale,
      dmgScale: opts?.dmgScale,
      noRespawn: opts?.noRespawn,
      nameplate: opts?.nameplate, // allies only — enemy name tags reveal positions
    });
    const id = bot.id; // FIX: key every map by the bot's real id — its hit meshes carry
    //                      userData.botId = bot.id, so a mismatch made enemies unkillable
    //                      after restarting with a different mode/difficulty.
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

  // ================= battle royale =================

  /** BR setup: squads (offline) / humans-only FFA (online), safe zone, loot, plane drop */
  private setupBR(spawnBots: boolean) {
    if (spawnBots) {
      // squads: player + allies vs enemy squads
      for (let i = 0; i < CFG.brAllies; i++) this.addBot(this.diff, { team: 0, idx: i, noRespawn: true, nameplate: true });
      for (let s = 0; s < CFG.brEnemySquads; s++) {
        for (let m = 0; m < CFG.brSquadSize; m++) {
          this.addBot(this.diff, { team: s + 1, idx: CFG.brAllies + s * CFG.brSquadSize + m, noRespawn: true });
        }
      }
    } else {
      this.teams.set(this.myId, 0); // online FFA: every human is their own squad
    }
    // initial safe zone near the middle of the map
    const a = Math.random() * Math.PI * 2, d0 = Math.random() * 16;
    this.brZone = {
      cx: Math.cos(a) * d0, cz: Math.sin(a) * d0, r: CFG.brZoneStart, phase: 0,
      hold: performance.now() + (CFG.brZoneHoldSec + 12) * 1000,
      shrinking: false, t: 0,
      from: { cx: 0, cz: 0, r: 0 }, to: { cx: 0, cz: 0, r: 0 },
    };
    this.buildZoneMeshes();
    // loot: offline/host spawn locally — clients receive the list in 'init'
    if (this.mode !== 'client') this.spawnLoot();
    // plane drop: everyone starts high in the air
    const airDrop = () => new THREE.Vector3((Math.random() * 2 - 1) * 60, CFG.brPlaneY, (Math.random() * 2 - 1) * 60);
    this.player.spawnAt(airDrop());
    this.player.setBrLoadout();
    this.player.parachute = true;
    this.bots.forEach(b => { const p = airDrop(); p.y = CFG.brPlaneY - Math.random() * 14; b.spawnAt(p); });
    this.spawnPlane();
    this.hud.toast('BATTLE ROYALE — JUMP!', 2600);
  }

  private buildZoneMeshes() {
    if (this.brZoneMesh || this.brZoneRing) return;
    this.brZoneMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(1, 1, 90, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xd2691e, transparent: true, opacity: 0.13, side: THREE.DoubleSide, depthWrite: false })
    );
    this.brZoneRing = new THREE.Mesh(
      new THREE.RingGeometry(0.975, 1, 72),
      new THREE.MeshBasicMaterial({ color: 0xff8a3c, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false })
    );
    this.brZoneRing.rotation.x = -Math.PI / 2;
    this.world.scene.add(this.brZoneMesh, this.brZoneRing);
  }

  /** cheap cargo plane that flies over the drop zone at match start */
  private spawnPlane() {
    const g = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: 0x707a6a });
    const fus = new THREE.Mesh(new THREE.BoxGeometry(15, 2.4, 2.6), mat);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.4, 22), mat); wing.position.y = 0.7;
    const tail = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.2, 0.4), mat); tail.position.set(-6.8, 2, 0);
    const tailW = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 6.5), mat); tailW.position.set(-7, 1.6, 0);
    g.add(fus, wing, tail, tailW);
    g.position.set(-170, CFG.brPlaneY + 14, this.player.pos.z);
    this.world.scene.add(g);
    this.brPlane = g;
  }

  private updateZoneVisuals() {
    const z = this.mode === 'client' ? this.zoneSync : this.brZone;
    if (!z || !this.brZoneMesh || !this.brZoneRing) return;
    this.brZoneMesh.position.set(z.cx, 45, z.cz);
    this.brZoneMesh.scale.set(z.r, 1, z.r);
    this.brZoneRing.position.set(z.cx, 0.15, z.cz);
    this.brZoneRing.scale.set(z.r, z.r, 1);
  }

  /** zone shrink + damage — simulated on the host / offline game only */
  private updateZoneLogic(now: number) {
    const z = this.brZone;
    if (!z) return;
    if (!z.shrinking && now >= z.hold && z.r > CFG.brZoneMin) {
      z.phase++;
      z.shrinking = true; z.t = now;
      z.from = { cx: z.cx, cz: z.cz, r: z.r };
      const nr = Math.max(CFG.brZoneMin, z.r * 0.62);
      const maxOff = Math.max(0, z.r - nr);
      const a = Math.random() * Math.PI * 2, off = Math.random() * maxOff;
      z.to = { cx: z.cx + Math.cos(a) * off, cz: z.cz + Math.sin(a) * off, r: nr };
      this.hud.toast(`ZONE ${z.phase} CLOSING IN`, 2000);
      this.audio.zoneWarn();
    }
    if (z.shrinking) {
      const k = Math.min(1, (now - z.t) / (CFG.brZonePhaseSec * 1000));
      const e = k * k * (3 - 2 * k);
      z.cx = THREE.MathUtils.lerp(z.from.cx, z.to.cx, e);
      z.cz = THREE.MathUtils.lerp(z.from.cz, z.to.cz, e);
      z.r = THREE.MathUtils.lerp(z.from.r, z.to.r, e);
      if (k >= 1) { z.shrinking = false; z.hold = now + CFG.brZoneHoldSec * 1000; }
    }
    // timer slot shows the zone countdown
    this.matchTime = z.shrinking
      ? Math.max(0, (z.t + CFG.brZonePhaseSec * 1000 - now) / 1000)
      : Math.max(0, (z.hold - now) / 1000);
    // zone damage tick (2 Hz)
    if (now >= this.brZoneDmgAt) {
      this.brZoneDmgAt = now + 500;
      const dmg = CFG.brDmgBase * (z.phase + 1) * 0.5;
      if (this.player.alive && Math.hypot(this.player.pos.x - z.cx, this.player.pos.z - z.cz) > z.r) {
        const died = this.player.takeDamage(dmg, now);
        this.hud.damageFlash();
        if (died) this.afterDamage(this.myId, this.myId, 'THE ZONE', false, true);
      }
      this.bots.forEach((b, id) => {
        if (!b.alive || b.isDropping) return; // zone ignores plane droppers, NOT roof campers
        if (Math.hypot(b.pos.x - z.cx, b.pos.z - z.cz) > z.r) {
          const died = b.takeDamage(dmg, now, b.pos.clone());
          if (died) this.afterDamage(id, id, 'THE ZONE', false, true);
        }
      });
      // remote humans take their own zone damage client-side; their deaths arrive via 'st' hp<=0
    }
  }

  /** horizontal distance outside the safe zone (BR), null when not in BR */
  private zoneDist(): number | null {
    const z = this.mode === 'client' ? this.zoneSync : this.brZone;
    if (!z) return null;
    return Math.hypot(this.player.pos.x - z.cx, this.player.pos.z - z.cz) - z.r;
  }

  private brAliveEnemies(): number {
    let n = 0;
    this.bots.forEach(b => { if (b.alive && b.team > 0) n++; });
    // humans-only BR (online): every other player is an enemy squad of one
    const myTeam = this.teams.get(this.myId) ?? 0;
    this.remotes.forEach((r, id) => { if (r.alive && (this.teams.get(id) ?? 1) !== myTeam) n++; });
    return n;
  }

  private brAliveAllies(): number {
    let n = this.player.alive ? 1 : 0;
    const myTeam = this.teams.get(this.myId) ?? 0;
    this.bots.forEach(b => { if (b.alive && b.team === myTeam) n++; });
    if (this.mode === 'host') this.remotes.forEach((r, id) => { if (r.alive && this.teams.get(id) === myTeam) n++; });
    return n;
  }

  /** squads still in the game when the player's squad falls (placement) */
  private brPlacement(): number {
    const myTeam = this.teams.get(this.myId) ?? 0;
    const teams = new Set<number>();
    this.bots.forEach(b => { if (b.alive && b.team !== myTeam) teams.add(b.team); });
    this.remotes.forEach((r, id) => { if (r.alive && (this.teams.get(id) ?? 1) !== myTeam) teams.add(this.teams.get(id) ?? 1); });
    return teams.size + 1;
  }

  private checkBREnd(now: number) {
    if (this.gameMode !== 'br' || this.mode === 'client' || this.state !== 'playing') return;
    if (now < this.brCheckAt) return;
    this.brCheckAt = now + 700;
    if (this.brAliveEnemies() === 0 || this.brAliveAllies() === 0) this.endMatch();
  }

  // ================= loot (battle royale) =================

  private rollLoot(): LootKind {
    let r = Math.random() * 100;
    for (const [k, w] of LOOT_TABLE) { if ((r -= w) <= 0) return k; }
    return 'ammo';
  }

  private makeLootMesh(kind: LootKind): THREE.Mesh {
    let geo = lootGeos.get(kind);
    if (!geo) {
      const parts = kind.startsWith('w')
        ? gunLootParts(WEAPONS[BR_LOOT_GUNS[lootGunIdx(kind) - 1]])
        : kind === 'ammo' ? ammoLootParts() : kind === 'med' ? medLootParts() : vestLootParts();
      parts.push(haloLootPart(kind));
      geo = mergeLootParts(parts);
      lootGeos.set(kind, geo);
    }
    if (!lootMat) lootMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    return new THREE.Mesh(geo, lootMat);
  }

  /** scatter loot over the warzone loot anchors (offline + host) */
  private spawnLoot() {
    this.clearLoot();
    for (const p of this.world.lootSpots) {
      const kind = this.rollLoot();
      const id = this.lootSeq++;
      const mesh = this.makeLootMesh(kind);
      const spin = !kind.startsWith('w');
      if (spin) mesh.position.set(p.x, 0.52, p.z);
      else { mesh.position.set(p.x, 0.12, p.z); mesh.rotation.y = Math.random() * Math.PI * 2; }
      this.world.scene.add(mesh);
      this.loots.set(id, { kind, pos: p.clone(), mesh, taken: false, spin });
    }
  }

  /** clients: build loot from the host's init list */
  private spawnLootFromList(list: LootInit[]) {
    this.clearLoot();
    for (const [id, kind, x, , z] of list) {
      const mesh = this.makeLootMesh(kind);
      const spin = !kind.startsWith('w');
      if (spin) mesh.position.set(x, 0.52, z);
      else { mesh.position.set(x, 0.12, z); mesh.rotation.y = Math.random() * Math.PI * 2; }
      this.world.scene.add(mesh);
      this.loots.set(id, { kind, pos: new THREE.Vector3(x, 0, z), mesh, taken: false, spin });
    }
  }

  private clearLoot() {
    this.loots.forEach(l => this.world.scene.remove(l.mesh));
    this.loots.clear();
  }

  private applyLoot(kind: LootKind) {
    if (kind === 'ammo') this.player.refillAmmoAll();
    else if (kind === 'med') this.player.heal(50);
    else if (kind === 'vest') this.player.armor = 100;
    else this.player.giveWeapon(BR_LOOT_GUNS[lootGunIdx(kind) - 1]);
  }

  /** would walking over this supply item actually help right now? (BR loot is scarce — don't waste it) */
  private lootUseful(kind: LootKind): boolean {
    if (kind === 'med') return this.player.hp < CFG.playerHp - 0.5;
    if (kind === 'vest') return this.player.armor < 99;
    if (kind === 'ammo') return this.player.needsAmmo();
    return true;
  }

  /**
   * Loot loop: supplies (ammo/medkit/vest) are auto-picked by walking over them.
   * GUNS are NOT auto-picked — a SWAP prompt shows and the pickup happens only
   * when the player presses E / the SWAP button, replacing the held weapon.
   */
  private tryLootPickup(now: number) {
    if (this.gameMode !== 'br' || !this.player.alive || this.player.pos.y > 1.2) {
      if (this.brSwapTarget !== null) { this.brSwapTarget = null; this.hud.setSwapHint(false); this.touch.showSwap(false); }
      return;
    }
    const p = this.player.pos;
    let nearestId: number | null = null;
    let nearestKind: LootKind | null = null;
    let nearestD = Infinity;
    const taken: number[] = [];
    this.loots.forEach((l, id) => {
      if (l.taken) return;
      const dx = Math.abs(l.pos.x - p.x), dz = Math.abs(l.pos.z - p.z);
      if (dx > 1.15 || dz > 1.15) return;
      if (l.kind.startsWith('w')) {
        const d = dx + dz;
        if (d < nearestD) { nearestD = d; nearestId = id; nearestKind = l.kind; }
        return;
      }
      // supplies: instant pickup — but only when it actually helps (else leave it on the ground)
      if (!this.lootUseful(l.kind)) return;
      taken.push(id);
      l.taken = true;
      this.world.scene.remove(l.mesh);
      this.applyLoot(l.kind);
      this.audio.pickup();
      this.hud.toast(LOOT_LABEL[l.kind], 950);
      if (this.mode === 'host') this.host?.broadcast({ t: 'ev', k: 'loot', i: id } as HostMsg);
      else if (this.mode === 'client') this.client?.send({ t: 'loot', i: id });
    });
    void now;
    if (nearestId !== null && nearestKind) {
      if (this.brSwapTarget !== nearestId) this.touch.showSwap(true);
      this.brSwapTarget = nearestId;
      this.hud.setSwapHint(true, LOOT_LABEL[nearestKind]);
    } else if (this.brSwapTarget !== null) {
      this.brSwapTarget = null;
      this.hud.setSwapHint(false);
      this.touch.showSwap(false);
    }
  }

  /** E key / SWAP button: exchange the held weapon with the ground gun below us */
  private doBrSwap() {
    if (this.gameMode !== 'br' || this.brSwapTarget === null || !this.player.alive) return;
    const l = this.loots.get(this.brSwapTarget);
    this.brSwapTarget = null;
    this.hud.setSwapHint(false);
    this.touch.showSwap(false);
    if (!l || l.taken) return;
    const gunIdx = BR_LOOT_GUNS[lootGunIdx(l.kind) - 1];
    l.taken = true;
    this.world.scene.remove(l.mesh);
    const replaced = this.player.giveWeapon(gunIdx);
    if (replaced !== -1 && this.mode !== 'client') this.dropWeapon(replaced);
    this.audio.pickup();
    this.hud.toast(`${LOOT_LABEL[l.kind]} EQUIPPED`, 950);
    if (this.mode === 'host') this.host?.broadcast({ t: 'ev', k: 'loot', i: this.lootsKeyOf(l) } as HostMsg);
    else if (this.mode === 'client') this.client?.send({ t: 'loot', i: this.lootsKeyOf(l) });
  }

  private lootsKeyOf(l: { kind: LootKind; pos: THREE.Vector3 }): number {
    let found = -1;
    this.loots.forEach((v, k) => { if (v === l) found = k; });
    return found;
  }

  /** host/offline: the replaced gun lands on the ground as fresh loot */
  private dropWeapon(idx: number) {
    const li = BR_LOOT_GUNS.indexOf(idx);
    if (li === -1) return;
    const kind = ('w' + (li + 1)) as LootKind;
    const id = this.lootSeq++;
    const mesh = this.makeLootMesh(kind);
    const px = this.player.pos.x + (Math.random() - 0.5) * 2.2;
    const pz = this.player.pos.z + (Math.random() - 0.5) * 2.2;
    mesh.position.set(px, 0.12, pz);
    mesh.rotation.y = Math.random() * Math.PI * 2;
    this.world.scene.add(mesh);
    this.loots.set(id, { kind, pos: new THREE.Vector3(px, 0, pz), mesh, taken: false, spin: false });
  }

  // ---- host (online) ----
  private clientRoom = '';

  // ---- LAN (Wi-Fi) multiplayer — manual-signaling WebRTC, zero internet ----

  private startLanHost(name: string, diff: Difficulty, gameMode: GameMode, map: MapId, loadout: Loadout) {
    this.audio.resume();
    this.cleanupNet();
    this.resetWorldEntities();
    this.mode = 'host';
    this.myId = '1';
    this.diff = diff;
    this.gameMode = gameMode === 'br' ? 'br' : gameMode === 'tdm' ? 'tdm' : 'dm';
    this.hostLoadout = [loadout.knife, loadout.primary, loadout.backup];
    this.player.limitedAmmo = this.gameMode === 'br';
    if (this.gameMode !== 'br') {
      this.player.setLoadout(loadout.knife, loadout.primary, loadout.backup);
    }
    this.world.setMap(this.gameMode === 'br' ? 'warzone' : map);
    this.setupLocal(name);
    this.initModeState(0, false); // LAN multiplayer: humans only
    this.state = 'lobby';
    this.menus.show('lan-host');
    this.menus.setLanHostPlayers(0);
    this.menus.setLanHostNote('Making invite code…');
    this.lanHost = new LanHost({
      onInviteReady: (invite) => {
        this.menus.showLanHostInvite(invite);
        this.menus.setLanHostNote('Show the QR / code to your friend — then paste or scan their ANSWER below.');
        this.audio.ui();
      },
      onPlayerConnected: () => {
        this.menus.setLanHostPlayers(this.lanHost?.conns.length ?? 0);
        this.menus.setLanHostNote('Player connected! Start when ready — or add more players.');
        this.audio.ui();
      },
      onPeerJoin: () => {
        this.menus.setLanHostPlayers(this.lanHost?.conns.length ?? 0);
      },
      onPeerLeave: (conn) => {
        const id = this.connId(conn);
        if (id) this.removeRemote(id);
        this.menus.setLanHostPlayers(this.lanHost?.conns.length ?? 0);
      },
      onMsg: (conn, msg) => this.onHostMsg(conn as never, msg as ClientMsg),
      onError: (err) => this.menus.setLanHostNote('⚠ ' + err, true),
    });
    // the whole host game logic (onHostMsg / broadcast / connIds) works unchanged
    // on top of the LAN transport — same duck-typed surface as NetHost
    this.host = this.lanHost as unknown as NetHost;
    void this.lanHost.createInvite();
  }

  private startLanJoin(name: string, invite: string) {
    this.audio.resume();
    this.cleanupNet();
    this.resetWorldEntities();
    this.mode = 'client';
    this.myId = '?';
    this.clientRoom = 'WI-FI';
    this.state = 'lobby';
    this.menus.setLanJoinNote('Reading invite…');
    this.lanClient = new LanClient({
      onInviteAccepted: () => this.menus.setLanJoinNote('Invite OK — making your answer…'),
      onAnswerReady: (answer) => {
        this.menus.showLanJoinAnswer(answer);
        this.menus.setLanJoinNote('Show this back to the HOST (they scan or paste it) — then wait…');
      },
      onOpen: () => {
        this.lanClient?.send({ t: 'hi', name });
        this.menus.show('lobby');
        this.menus.setLobby('WI-FI', 1);
        this.menus.setLobbyNote('Connected! Waiting for the host to start…');
        this.audio.ui();
      },
      onMsg: (msg) => this.onClientMsg(msg as HostMsg),
      onError: (err) => this.menus.setLanJoinNote('⚠ ' + err, true),
      onClosed: () => {
        if (this.state === 'playing' || this.state === 'end') {
          this.leaveToMenu();
          this.menus.setStatus('Disconnected from host.', true);
        } else {
          this.menus.setLanJoinNote('Host closed the connection.', true);
          this.menus.resetLanJoin();
        }
      },
    });
    this.client = this.lanClient as unknown as NetClient;
    void this.lanClient.connect(invite);
  }

  private lanAcceptAnswer(code: string) {
    if (!this.lanHost) return;
    this.lanHost.acceptAnswer(code)
      .then(() => this.menus.setLanHostNote('Answer accepted — connecting…'))
      .catch((e: unknown) => this.menus.setLanHostNote('⚠ ' + ((e as Error)?.message || 'Bad answer code.'), true));
  }

  private lanCancel() {
    this.cleanupNet();
    this.menus.resetLanJoin();
    this.menus.show('online');
  }

  private startHost(name: string, _botCount: number, diff: Difficulty, gameMode: GameMode, map: MapId, loadout: Loadout) {
    this.audio.resume();
    this.cleanupNet();
    this.resetWorldEntities();
    this.mode = 'host';
    this.myId = '1';
    this.diff = diff;
    this.gameMode = gameMode === 'br' ? 'br' : gameMode === 'tdm' ? 'tdm' : 'dm'; // online: DM / TDM / co-op Battle Royale
    this.hostLoadout = [loadout.knife, loadout.primary, loadout.backup];
    this.player.limitedAmmo = this.gameMode === 'br';
    if (this.gameMode !== 'br') {
      this.player.setLoadout(loadout.knife, loadout.primary, loadout.backup);
    }
    this.world.setMap(this.gameMode === 'br' ? 'warzone' : map);
    this.setupLocal(name);
    this.initModeState(0, false); // MULTIPLAYER = NO BOTS, only real players
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
      // teammates get a nameplate; enemies stay anonymous (no position leaks)
      const myTeam = this.teams.get(this.myId) ?? 0;
      let rp: RemotePlayer;
      if (this.gameMode === 'tdm') {
        const t = this.nextTeamFlip ? 1 : 0;
        this.nextTeamFlip = !this.nextTeamFlip;
        this.teams.set(id, t);
        rp = new RemotePlayer(id, msg.name, t === myTeam);
      } else if (this.gameMode === 'br') {
        this.teams.set(id, Number(id)); // BR online: everyone is their own squad
        rp = new RemotePlayer(id, msg.name, false);
      } else {
        rp = new RemotePlayer(id, msg.name, false);
      }
      rp.hp = 100; rp.alive = true;
      this.world.scene.add(rp.group);
      this.remotes.set(id, rp);
      this.scores.set(id, { k: 0, d: 0 });
      this.names.set(id, msg.name);
      const namesObj: Record<string, string> = {};
      this.names.forEach((n, i) => { namesObj[i] = n; });
      const scObj: Record<string, [number, number]> = {};
      this.scores.forEach((s, i) => { scObj[i] = [s.k, s.d]; });
      const lootList: LootInit[] = this.gameMode === 'br'
        ? [...this.loots.entries()].filter(([, l]) => !l.taken)
          .map(([lid, l]) => [lid, l.kind, r2(l.pos.x), r2(l.pos.y), r2(l.pos.z)] as LootInit)
        : [];
      this.host!.send(conn as never, {
        t: 'init', id, cfg: { bots: this.bots.size, diff: this.diff, mode: this.gameMode, map: this.world.mapId as MapId, loot: lootList, loadout: this.hostLoadout },
        tm: this.state === 'playing' ? this.matchTime : CFG.matchTime, sc: scObj, names: namesObj,
      } as HostMsg);
      if (this.state === 'playing') {
        const p = this.gameMode === 'br'
          ? new THREE.Vector3((Math.random() * 2 - 1) * 60, CFG.brPlaneY, (Math.random() * 2 - 1) * 60)
          : this.world.pickSpawn(this.alivePositions());
        this.host!.send(conn as never, { t: 'ev', k: 'spawn', i: id, p: [p.x, p.y, p.z] } as HostMsg);
      }
      return;
    }
    const id = this.connId(conn);
    if (!id) return;
    const rp = this.remotes.get(id);
    if (msg.t === 'st' && rp) {
      rp.applySnap({ i: id, p: msg.p, y: msg.y, x: msg.x, m: msg.m, s: msg.s, hp: msg.hp, n: this.names.get(id) ?? 'PLAYER' }, performance.now());
      // zone / fall deaths arrive here: client hp hit 0 but no killer was reported
      if (msg.hp <= 0 && rp.alive) {
        rp.hp = 0; rp.alive = false;
        this.afterDamage(id, id, this.names.get(id) ?? 'PLAYER', false, true);
      }
      if (msg.s === 1 && this.prevShootFlags.get(id) !== true) {
        this.audio.remoteShoot();
        this.fx.tracer(new THREE.Vector3(msg.p[0], msg.p[1] + 1.1, msg.p[2]),
          new THREE.Vector3(msg.p[0] - Math.sin(msg.y) * 30, msg.p[1] + 1.1 + Math.sin(msg.x) * 30, msg.p[2] - Math.cos(msg.y) * 30));
        // bots hear the human gunfire and investigate
        this.bots.forEach(b => b.hear(new THREE.Vector3(msg.p[0], msg.p[1], msg.p[2]), performance.now()));
      }
      this.prevShootFlags.set(id, msg.s === 1);
    } else if (msg.t === 'hit') {
      this.applyClientHit(id, msg.tg, msg.hs === 1, new THREE.Vector3(...msg.o), new THREE.Vector3(...msg.d));
    } else if (msg.t === 'loot') {
      const l = this.loots.get(msg.i);
      if (l && !l.taken) {
        l.taken = true;
        this.world.scene.remove(l.mesh);
        this.host!.broadcast({ t: 'ev', k: 'loot', i: msg.i } as HostMsg);
      }
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
    // friendly fire is DISABLED in every team mode
    const aTeam = this.teams.get(attackerId), tTeam = this.teams.get(targetId);
    if (aTeam !== undefined && tTeam !== undefined && aTeam === tTeam && attackerId !== targetId) return;
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
        this.menus.setLobby(this.clientRoom, 1); // v3.10 — count yourself, don't show 0
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
      this.diff = msg.cfg.diff;
      this.gameMode = msg.cfg.mode ?? 'dm';
      if (msg.cfg.map) this.world.setMap(msg.cfg.map);
      if (msg.cfg.loot) this.spawnLootFromList(msg.cfg.loot);
      if (msg.cfg.loadout && this.gameMode !== 'br') {
        const [k, p, b] = msg.cfg.loadout;
        this.player.limitedAmmo = false;
        this.player.setLoadout(k, p, b);
      }
      if (this.gameMode === 'br') this.buildZoneMeshes();
      this.player.spawnAt(new THREE.Vector3(0, 0, 30));
      this.player.enabled = false;
      return;
    }
    if (msg.t === 'ev' && msg.k === 'start') {
      this.diff = msg.cfg.diff;
      this.gameMode = msg.cfg.mode ?? this.gameMode;
      if (msg.cfg.map) this.world.setMap(msg.cfg.map);
      if (msg.cfg.loadout && this.gameMode !== 'br') {
        const [k, p, b] = msg.cfg.loadout;
        this.player.limitedAmmo = false;
        this.player.setLoadout(k, p, b);
      }
      if (this.gameMode === 'br') this.buildZoneMeshes();
      this.matchTime = this.gameMode === 'br' ? 9999 * 60 : CFG.matchTime;
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
      if (msg.zn) this.zoneSync = { cx: msg.zn[0], cz: msg.zn[1], r: msg.zn[2], phase: msg.zn[3] };
      return;
    }
    if (msg.t === 'ev') {
      if (msg.k === 'kill') {
        const kn = this.names.get(msg.b) ?? '?', vn = this.names.get(msg.v) ?? '?';
        this.hud.feed(kn, vn, msg.hs, msg.b === this.myId || msg.v === this.myId);
        if (msg.b === this.myId) this.audio.kill();
        if (msg.v === this.myId) this.onLocalDeath();
      } else if (msg.k === 'spawn') {
        if (msg.i === this.myId) {
          if (this.state !== 'playing') {
            // mid-match join: the host dropped us straight into a running match
            this.state = 'playing';
            this.menus.show(null);
            this.hud.show(true);
            this.hud.setRoom('ROOM ' + this.clientRoom);
            this.hud.setKD(this.scores.get(this.myId)?.k ?? 0, this.scores.get(this.myId)?.d ?? 0);
            this.enterTouchUI();
          }
          this.respawnLocal(new THREE.Vector3(...msg.p));
        }
      } else if (msg.k === 'dmg') {
        if (msg.i === this.myId) {
          this.player.applyServerDamage(msg.amt);
          this.hud.damageFlash();
        }
      } else if (msg.k === 'loot') {
        const l = this.loots.get(msg.i);
        if (l && !l.taken) { l.taken = true; this.world.scene.remove(l.mesh); }
      } else if (msg.k === 'end') {
        this.state = 'end';
        this.expectUnlock = true;
        document.exitPointerLock?.();
        this.player.enabled = false;
        this.touch.setEnabled(false);
        this.hud.show(false);
        this.audio.matchEnd();
        try {
          // record the match on the client too (career stats work online)
          const sorted = [...msg.board].sort((a, b) => b[2] - a[2]);
          const rank = Math.max(1, sorted.findIndex(r => r[0] === this.myId) + 1);
          const row = sorted.find(r => r[0] === this.myId);
          const won = !!row && sorted[0][0] === this.myId;
          const info = this.gameMode === 'gun'
            ? `${Math.min(row?.[2] ?? 0, GUN_GAME_LADDER.length)}/${GUN_GAME_LADDER.length} GUNS — RANK #${rank}`
            : `RANK #${rank}`;
          recordMatch(this.names.get(this.myId) ?? 'YOU', this.gameMode, row?.[2] ?? 0, row?.[3] ?? 0, won, info);
        } catch { /* stats must never break the game */ }
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
    // only LIVING entities are hittable — corpses on the ground can't be shot
    if (this.mode === 'client') {
      this.botViews.forEach(v => { if (v.alive) out.push(...v.hitMeshes); });
      this.remotes.forEach(r => { if (r.alive) out.push(...r.hitMeshes); });
    } else {
      this.bots.forEach(b => { if (b.alive) out.push(...b.hitMeshes); });
      this.remotes.forEach(r => { if (r.alive) out.push(...r.hitMeshes); });
    }
    return out;
  }

  private onLocalShoot(origin: THREE.Vector3, dir: THREE.Vector3) {
    // gunfire is audible: nearby bots come hunting (they still need LOS to see you)
    const now = performance.now();
    this.bots.forEach(b => b.hear(origin, now));
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
      // friendly fire OFF in every team mode (tdm, br squads, co-op)
      const myTeam = this.teams.get(this.myId);
      const tTeam = this.teams.get(targetId);
      if (tTeam !== undefined && myTeam !== undefined && tTeam === myTeam) {
        this.fx.sparks(hit.point, 0x8a8f70, 4);
        return;
      }
      // battle royale: landing protection — can't hurt someone still dropping
      const tBot = this.bots.get(targetId);
      if (tBot && tBot.isDropping) { this.fx.sparks(hit.point, 0x8a8f70, 4); return; }
      const tRp = this.remotes.get(targetId);
      if (tRp && tRp.group.position.y > 10) { this.fx.sparks(hit.point, 0x8a8f70, 4); return; }
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
    // battle royale landing protection: the local player can't be hurt while dropping
    if (this.gameMode === 'br' && this.player.isAirborneOrLanding(performance.now())) return;
    // battle royale landing protection: the local player can't be hurt while dropping
    if (this.gameMode === 'br' && this.player.isAirborneOrLanding(performance.now())) return;
    // team modes: bots never target teammates, but guard anyway
    if ((this.gameMode === 'tdm' || this.gameMode === 'br') && this.teams.get(shot.targetId) !== undefined
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
    if (this.mode === 'host' && this.remotes.has(victimId) && this.gameMode !== 'br') {
      const rp = this.remotes.get(victimId)!;
      rp.hp = 0; rp.alive = false;
      this.hostRespawns.set(victimId, performance.now() + CFG.respawnDelay * 1000);
    }
    if (this.mode !== 'client' && this.gameMode === 'dm' && killerId !== victimId
        && this.scores.get(killerId) && this.scores.get(killerId)!.k >= CFG.targetKills) {
      this.endMatch(); return;
    }
    if (this.mode === 'offline' && this.gameMode === 'duel' && died) {
      if (victimId === this.myId) this.duelScore[1]++; else this.duelScore[0]++;
      if (this.duelScore[0] >= CFG.duelRounds || this.duelScore[1] >= CFG.duelRounds) { this.endMatch(); return; }
      this.duelWaitUntil = performance.now() + CFG.duelRespawn * 1000 + 700;
    }
    if (this.mode === 'offline') {
      const myKills = this.scores.get(this.myId)?.k ?? 0;
      if (this.gameMode === 'gun' && killerId === this.myId) {
        const next = myKills; // ladder slot == kill count
        if (next >= GUN_GAME_LADDER.length) { this.endMatch(); return; }
        this.player.setWeaponDirect(GUN_GAME_LADDER[next]);
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
    // online TDM (humans only): team kill limit checked on the host too
    if (this.mode === 'host' && this.gameMode === 'tdm' && died) {
      const [a, b] = this.teamKillTotals();
      if (a >= CFG.tdmTargetKills || b >= CFG.tdmTargetKills) { this.endMatch(); return; }
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
    this.player.parachute = false;
    this.touch.setEnabled(false); // hide touch UI during the respawn overlay
    if (this.mode === 'offline' && this.gameMode === 'survival') {
      // no respawns in survival — end shortly
      this.hud.showRespawn(true, 0);
      setTimeout(() => { if (this.state === 'playing') this.endMatch(); }, 1400);
      return;
    }
    if (this.mode === 'offline' && this.gameMode === 'duel') {
      // round-based: the round loop respawns both fighters
      this.hud.showRespawn(true, CFG.duelRespawn, 'NEXT ROUND IN');
      return;
    }
    if (this.gameMode === 'br') {
      // no respawns in the warzone
      this.hud.showRespawn(true, 0, this.mode === 'client' ? 'SQUAD WIPED — SPECTATING' : 'ELIMINATED');
      if (this.mode !== 'client') setTimeout(() => { if (this.state === 'playing') this.endMatch(); }, 1500);
      return;
    }
    this.respawnDeadline = performance.now() + CFG.respawnDelay * 1000;
    this.hud.showRespawn(true, CFG.respawnDelay);
    this.expectUnlock = false;
  }

  private respawnLocal(p: THREE.Vector3) {
    this.player.spawnAt(p);
    this.player.parachute = false;
    if (this.gameMode === 'br') { this.player.setBrLoadout(); this.player.parachute = true; }
    this.player.enabled = true;
    if (this.touchActive) this.touch.setEnabled(true);
    this.hud.showRespawn(false);
    if (this.state === 'playing') this.requestLock();
  }

  // ================= match flow =================

  private onLobbyStart = () => {
    if (this.mode !== 'host' || this.state !== 'lobby') return;
    if (this.gameMode !== 'br') this.matchTime = CFG.matchTime;
    this.host?.broadcast({ t: 'ev', k: 'start', cfg: { bots: this.bots.size, diff: this.diff, mode: this.gameMode, map: this.world.mapId as MapId, loadout: this.hostLoadout } } as HostMsg);
    // give every connected client a spawn (BR: drop from the air)
    this.remotes.forEach((rp, id) => {
      const p = this.gameMode === 'br'
        ? new THREE.Vector3((Math.random() * 2 - 1) * 60, CFG.brPlaneY, (Math.random() * 2 - 1) * 60)
        : this.world.pickSpawn(this.alivePositions());
      rp.hp = 100;
      this.host?.send(this.connOf(id), { t: 'ev', k: 'spawn', i: id, p: [p.x, p.y, p.z] } as HostMsg);
    });
    if (this.gameMode !== 'br') this.player.spawnAt(this.world.pickSpawn(this.alivePositions()));
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
    this.player.parachute = false;
    if (this.gameMode !== 'br') this.player.spawnAt(this.world.pickSpawn([new THREE.Vector3(0, 0, 0)]));
    this.initModeState(this.gameMode === 'gun' ? 5 : this.offlineBotCount, this.mode !== 'host');
    if (this.mode === 'host') {
      this.host?.broadcast({ t: 'ev', k: 'start', cfg: { bots: this.bots.size, diff: this.diff, mode: this.gameMode, map: this.world.mapId as MapId, loadout: this.hostLoadout } } as HostMsg);
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

  /** persist this finished match into the on-device CAREER stats (never throws) */
  private recordCareer(won: boolean, info: string) {
    try {
      const s = this.scores.get(this.myId) ?? { k: 0, d: 0 };
      recordMatch(this.names.get(this.myId) ?? 'YOU', this.gameMode, s.k, s.d, won, info);
    } catch { /* stats must never break the game */ }
  }

  private endMatch() {
    if (this.state === 'end') return;
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
    this.hud.setZoneWarn(false);
    this.audio.matchEnd();
    if (this.mode === 'offline' && this.gameMode === 'survival') {
      const k = this.scores.get(this.myId)?.k ?? 0;
      this.recordCareer(false, `WAVE ${Math.max(1, this.survWave)} — ${k} KILLS`);
      this.menus.showSurvivalEnd(Math.max(1, this.survWave), k, this.names.get(this.myId) ?? 'YOU');
      return;
    }
    if (this.gameMode === 'br') {
      const won = this.mode !== 'client' && this.brAliveEnemies() === 0 && this.brAliveAllies() > 0;
      const k = this.scores.get(this.myId)?.k ?? 0;
      const place = won ? 1 : this.brPlacement();
      this.recordCareer(won, `#${place} OF 5 — ${k} KILLS`);
      this.menus.showBrEnd(won, k, place, this.names.get(this.myId) ?? 'YOU');
      return;
    }
    if (this.mode === 'offline' && this.gameMode === 'duel') {
      const won = this.duelScore[0] >= CFG.duelRounds;
      this.recordCareer(won, `ROUNDS ${this.duelScore[0]}-${this.duelScore[1]}`);
      this.menus.showDuelEnd(won, this.duelScore[0], this.duelScore[1]);
      return;
    }
    if (this.mode === 'offline' && this.gameMode === 'tdm') {
      const [a, b] = this.teamKillTotals();
      this.recordCareer(a >= b, `ALLIES ${a} — ${b} ENEMY`);
      this.menus.showTeamEnd(a, b, this.names.get(this.myId) ?? 'YOU', a >= b);
      return;
    }
    const rank = Math.max(1, board.findIndex(r => r[0] === this.myId) + 1);
    if (this.gameMode === 'gun') {
      const k = this.scores.get(this.myId)?.k ?? 0;
      this.recordCareer(k >= GUN_GAME_LADDER.length, `${Math.min(k, GUN_GAME_LADDER.length)}/${GUN_GAME_LADDER.length} GUNS — RANK #${rank}`);
    } else {
      this.recordCareer(rank === 1, `RANK #${rank}`);
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
    this.lanHost?.destroy(); this.lanHost = null;
    this.lanClient?.destroy(); this.lanClient = null;
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
    if (normKey(e) === 'KeyE' && !e.repeat && !this.paused && !this.menus.isVisible()) {
      this.doBrSwap();
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

  /** ADS view: fov zoom per weapon (aim blend smoothed in player) + sniper scope overlay */
  private applyAimView(_dt: number) {
    const cam = this.world.camera;
    const zoom = WEAPONS[this.player.weaponIndex].zoom ?? 1.25;
    const target = CFG.baseFov / (1 + (zoom - 1) * this.player.aimAmount);
    if (Math.abs(cam.fov - target) > 0.01) {
      cam.fov = target;
      cam.updateProjectionMatrix();
    }
    const scoped = !!WEAPONS[this.player.weaponIndex].scope && this.player.aimAmount > 0.82;
    this.hud.setScope(scoped);
    // clean scope picture: the gun model disappears when the scope is up (Bug: barrel in the scope)
    this.player.vm.setScopedHidden(scoped);
  }
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
    this.applyAimView(dt);

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
        { id: this.myId, pos: this.player.pos, alive: this.player.alive, isLocal: true, team: this.teams.get(this.myId) ?? -1,
          dropping: this.gameMode === 'br' && this.player.isAirborneOrLanding(now) },
      ];
      this.remotes.forEach((rp, id) => targets.push({ id, pos: rp.group.position, alive: rp.alive, isLocal: false, team: this.teams.get(id) ?? -1, dropping: rp.group.position.y > 10 }));
      // team modes: bots also fight each other -> include bots as targets
      if (this.gameMode === 'tdm' || this.gameMode === 'br') {
        this.bots.forEach((b, id) => targets.push({ id, pos: b.pos, alive: b.alive, isLocal: false, team: b.team, dropping: b.isDropping }));
      }
      const zoneArg = this.gameMode === 'br' && this.brZone
        ? { cx: this.brZone.cx, cz: this.brZone.cz, r: this.brZone.r, phase: this.brZone.phase }
        : undefined;
      this.bots.forEach(b => b.update(dt, now, targets, zoneArg));
      // soft separation so bots never pile up / get stuck inside each other
      const alive = [...this.bots.values()].filter(b => b.alive && !b.isDropping);
      for (let i = 0; i < alive.length; i++) {
        for (let j = i + 1; j < alive.length; j++) {
          const a = alive[i], c = alive[j];
          const dx = c.pos.x - a.pos.x, dz = c.pos.z - a.pos.z;
          const d = Math.hypot(dx, dz);
          if (d < 0.95) {
            if (d < 0.02) { a.pos.x += (Math.random() - 0.5) * 0.5; a.pos.z += (Math.random() - 0.5) * 0.5; continue; }
            const push = (0.95 - d) / 2, nx = dx / d, nz = dz / d;
            a.pos.x -= nx * push; a.pos.z -= nz * push;
            c.pos.x += nx * push; c.pos.z += nz * push;
          }
        }
      }
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
      // battle royale: zone simulation + win/lose checks
      if (this.gameMode === 'br') {
        this.updateZoneLogic(now);
        this.checkBREnd(now);
      }
      // duel: next round respawn
      if (this.mode === 'offline' && this.gameMode === 'duel' && this.duelWaitUntil > 0) {
        const remain = (this.duelWaitUntil - now) / 1000;
        // keep the NEXT ROUND IN overlay's countdown alive while the player is dead
        if (!this.player.alive) this.hud.showRespawn(remain > 0, Math.max(0, remain), 'NEXT ROUND IN');
        if (now >= this.duelWaitUntil) {
          this.duelWaitUntil = 0;
          this.duelRound++;
          const p = this.world.pickSpawn([new THREE.Vector3(0, 0, 0)]);
          const bot = [...this.bots.values()][0];
          if (bot) bot.spawnAt(this.world.pickSpawn([p]));
          // respawnLocal (not just spawnAt): revives the player AND hides the
          // YOU DIED overlay + re-enables touch controls — the overlay used to
          // stay on screen forever after dying in duel (stuck-death-screen bug)
          this.respawnLocal(p);
          this.hud.toast(`ROUND ${this.duelRound}`, 1400);
        }
      }
    } else if (this.gameMode === 'br' && this.zoneSync && this.player.alive) {
      // client: self-applied zone damage from the synced zone
      if (now >= this.brZoneDmgAt) {
        this.brZoneDmgAt = now + 500;
        const z = this.zoneSync;
        if (Math.hypot(this.player.pos.x - z.cx, this.player.pos.z - z.cz) > z.r) {
          const died = this.player.takeDamage(CFG.brDmgBase * (z.phase + 1) * 0.5, now);
          this.hud.damageFlash();
          if (died) this.afterDamage(this.myId, this.myId, 'THE ZONE', false, true);
        }
      }
    }

    // loot & zone visuals (BR)
    if (this.gameMode === 'br') {
      this.tryLootPickup(now);
      if (this.touch.consumeSwap()) this.doBrSwap();
      this.updateZoneVisuals();
      if (this.loots.size) {
        this.loots.forEach(l => {
          if (l.taken) return;
          if (!l.spin) return; // guns lie flat on the ground at a fixed angle
          l.mesh.rotation.y += dt * 1.5;
          l.mesh.position.y = 0.52 + Math.sin(now * 0.0028 + l.pos.x * 3.1) * 0.09;
        });
      }
      if (this.brPlane) {
        this.brPlane.position.x += 44 * dt;
        this.brPlane.position.y = CFG.brPlaneY + 14 + Math.sin(now * 0.001) * 2;
        if (this.brPlane.position.x > 180) { this.world.scene.remove(this.brPlane); this.brPlane = null; }
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
      } else if (this.gameMode === 'br') {
        // matchTime is driven by the zone simulation (offline/host); clients get it via snaps
        timerText = fmtTime(this.matchTime);
        const aliveN = this.brAliveAllies() + this.brAliveEnemies();
        modeText = `${aliveN} ALIVE — ZONE ${(this.brZone?.phase ?? 0) + 1}`;
      } else if (this.mode === 'offline' && this.gameMode === 'duel') {
        timerText = `ROUND ${this.duelRound}`;
        modeText = `DUEL — YOU ${this.duelScore[0]} : ${this.duelScore[1]} ENEMY`;
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
    } else if (this.gameMode === 'br') {
      timerText = this.zoneSync ? `ZONE ${this.zoneSync.phase + 1}` : '';
      const aliveN = (this.player.alive ? 1 : 0)
        + [...this.botViews.values()].filter(b => b.alive).length
        + [...this.remotes.values()].filter(r => r.alive).length;
      modeText = `${aliveN} ALIVE`;
    } else {
      timerText = fmtTime(this.matchTime);
      modeText = 'ONLINE DEATHMATCH';
    }
    this.hud.setTimer(timerText, modeText);

    // outside-zone warning (BR)
    const zd = this.zoneDist();
    this.hud.setZoneWarn(this.gameMode === 'br' && this.player.alive && zd !== null && zd > 0 && this.state === 'playing');

    // client input send
    if (this.mode === 'client' && this.player.alive && now - this.lastInputSent >= 1000 / CFG.inputRate) {
      this.lastInputSent = now;
      const st = this.player.netState();
      this.client?.send({ t: 'st', p: st.p, y: st.y, x: st.x, m: st.m, s: st.s, hp: st.hp });
    }

    // HUD
    this.hud.setHp(this.player.hp, this.player.armor);
    this.hud.setAmmo(this.player.ammo, this.player.reloading, this.player.reserve);
    this.hud.setKD(this.scores.get(this.myId)?.k ?? 0, this.scores.get(this.myId)?.d ?? 0);
    // 3-slot weapon bar (top-right) — rebuild only when it changes
    const slots = this.player.slotWeapons;
    const sig = `${slots[0]},${slots[1]},${slots[2]},${this.player.slotIndex},${this.gameMode}`;
    if (sig !== this.lastSlotsSig) {
      this.lastSlotsSig = sig;
      this.hud.setSlots(slots.map((w, i) => ({
        name: w === -1 ? '' : WEAPONS[w].name,
        active: i === this.player.slotIndex,
        empty: w === -1,
      })));
    }
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
    const zn = this.brZone
      ? [r2(this.brZone.cx), r2(this.brZone.cz), r2(this.brZone.r), this.brZone.phase]
      : undefined;
    this.host.broadcast({ t: 'snap', tm: Math.round(this.matchTime), pl, bt, sc, zn } as HostMsg);
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
    window.removeEventListener('deviceorientation', this.onDeviceTilt as EventListener);
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

// ---- battle royale loot ----
const LOOT_TABLE: [LootKind, number][] = [
  ['w1', 4], ['w2', 7], ['w3', 6], ['w4', 6], ['w5', 7], ['w6', 9], ['w7', 8], ['w8', 6],
  ['w9', 5], ['w10', 5], ['w11', 4], ['w12', 3], ['w13', 4],
  ['ammo', 12], ['med', 8], ['vest', 6],
];
/** glow-ring color under each ground item (kind identification at a glance) */
const LOOT_HALO: Record<LootKind, number> = {
  w1: 0xd8cfae, w2: 0xb9a76a, w3: 0xc4b384, w4: 0xcfc06e, w5: 0xc98d4e, w6: 0x9fb86e,
  w7: 0xd98e32, w8: 0xb0a86e, w9: 0xe0b35c, w10: 0x7d9a55, w11: 0x8f9a6a, w12: 0x7fa0a8, w13: 0xd8b25e,
  ammo: 0xd6b96a, med: 0xe07b6a, vest: 0x7f9fb5,
};

/** 'w13' -> 13 (kind[1] would wrongly parse 'w10'-'w13' as w1) */
function lootGunIdx(kind: LootKind): number {
  return parseInt(kind.slice(1), 10);
}

// every ground item is ONE merged geometry with baked vertex colors => 1 draw call per item
type LootPart = { geo: THREE.BufferGeometry; m: THREE.Matrix4; c: number };
const _lootCol = new THREE.Color();

function mergeLootParts(parts: LootPart[]): THREE.BufferGeometry {
  const pos: number[] = [], norm: number[] = [], col: number[] = [];
  for (const p of parts) {
    const g = p.geo.toNonIndexed();
    g.applyMatrix4(p.m);
    const pa = g.getAttribute('position'), na = g.getAttribute('normal');
    _lootCol.setHex(p.c);
    for (let i = 0; i < pa.count; i++) {
      pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      norm.push(na.getX(i), na.getY(i), na.getZ(i));
      col.push(_lootCol.r, _lootCol.g, _lootCol.b);
    }
    g.dispose();
    p.geo.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function boxPart(sx: number, sy: number, sz: number, px: number, py: number, pz: number, c: number, ry = 0, rz = 0): LootPart {
  const geo = new THREE.BoxGeometry(sx, sy, sz);
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0, ry, rz));
  m.setPosition(px, py, pz);
  return { geo, m, c };
}

/** cylinder along Y (rz=0) or lying along X (rz=PI/2) */
function cylPart(r: number, h: number, px: number, py: number, pz: number, c: number, rz = 0): LootPart {
  const geo = new THREE.CylinderGeometry(r, r, h, 6);
  const m = new THREE.Matrix4().makeRotationZ(rz);
  m.setPosition(px, py, pz);
  return { geo, m, c };
}

const LOOT_GUNMETAL = 0x3f434a, LOOT_DARK = 0x24272c, LOOT_POLY = 0x5a5340, LOOT_WOOD = 0x6e4a2a, LOOT_GLASS = 0x9fd8e8;

/** a true gun silhouette per weapon spec (receiver / barrel / grip / mag / stock / scope) */
function gunLootParts(spec: WeaponSpec): LootPart[] {
  const bodyH = 0.085, bodyW = 0.06;
  const stockLen = spec.stock ? 0.2 : 0.06;
  const total = spec.bodyLen + spec.barrelLen + stockLen;
  const k = Math.min(1.7, Math.max(0.95, 0.9 / total)); // normalize silhouette length
  const Y = 0.2;                                        // lift so nothing clips the ground
  const sh = -total / 2;                                // stock/rear edge
  const bx = sh + stockLen;                             // receiver start
  const barrelX = bx + spec.bodyLen;
  const parts: LootPart[] = [];
  parts.push(boxPart(spec.bodyLen * k, bodyH * k, bodyW * k, bx + spec.bodyLen / 2, Y, 0, LOOT_GUNMETAL));
  const bw = Math.max(0.026, spec.barrelW * 3 * k);
  parts.push(boxPart(spec.barrelLen * k, bw, bw, barrelX + spec.barrelLen / 2, Y + bodyH * 0.15 * k, 0, LOOT_DARK));
  parts.push(boxPart(0.028 * k, 0.05 * k, 0.02 * k, barrelX + spec.barrelLen * 0.2, Y + (bodyH * 0.5 + 0.024) * k, 0, LOOT_DARK)); // front sight
  parts.push(boxPart(0.05 * k, 0.16 * k, 0.048 * k, bx + spec.bodyLen * 0.22, Y - 0.09 * k, 0, LOOT_DARK, 0, 0.26));              // grip
  if (spec.drum) parts.push(boxPart(0.15 * k, 0.15 * k, 0.09 * k, bx + spec.bodyLen * 0.5, Y - 0.12 * k, 0, LOOT_DARK));
  else parts.push(boxPart(0.05 * k, 0.15 * k, 0.045 * k, bx + spec.bodyLen * 0.58, Y - 0.11 * k, 0, LOOT_DARK, 0, -0.12));         // magazine
  if (spec.stock) {
    parts.push(boxPart(stockLen * k, 0.06 * k, 0.05 * k, sh + stockLen / 2, Y - 0.005 * k, 0, spec.wood ? LOOT_WOOD : LOOT_POLY));
    if (spec.wood) parts.push(boxPart(spec.bodyLen * 0.55 * k, 0.05 * k, 0.045 * k, bx + spec.bodyLen * 0.3, Y - 0.06 * k, 0, LOOT_WOOD));
  } else {
    parts.push(boxPart(0.06 * k, 0.055 * k, 0.055 * k, bx + spec.bodyLen * 0.86, Y + 0.05 * k, 0, LOOT_DARK)); // pistol slide
  }
  if (spec.scope) {
    const sy = Y + (bodyH * 0.5 + 0.05) * k;
    parts.push(cylPart(0.034 * k, 0.2 * k, bx + spec.bodyLen * 0.45, sy, 0, LOOT_DARK, Math.PI / 2));
    parts.push(cylPart(0.044 * k, 0.03 * k, bx + spec.bodyLen * 0.45 + 0.1 * k, sy, 0, LOOT_GLASS, Math.PI / 2));
  }
  return parts;
}

/** olive ammo crate with three rifle cartridges sticking out of the top */
function ammoLootParts(): LootPart[] {
  const crate = 0x55603f, lid = 0x6a7550, band = 0x3f4a2f, brass = 0xc9a34e, tip = 0x8a6b30;
  const parts: LootPart[] = [
    boxPart(0.4, 0.18, 0.26, 0, 0.09, 0, crate),
    boxPart(0.42, 0.045, 0.28, 0, 0.2, 0, lid),
    boxPart(0.415, 0.05, 0.05, 0, 0.13, 0, band),
  ];
  for (let i = -1; i <= 1; i++) {
    parts.push(cylPart(0.02, 0.13, i * 0.055, 0.28, 0.04, brass));
    parts.push(cylPart(0.021, 0.03, i * 0.055, 0.355, 0.04, tip));
  }
  return parts;
}

/** white medkit case with a red cross on the lid */
function medLootParts(): LootPart[] {
  const white = 0xe8e4da, red = 0xd84838, latch = 0xb8b4aa;
  return [
    boxPart(0.38, 0.2, 0.26, 0, 0.1, 0, white),
    boxPart(0.39, 0.04, 0.27, 0, 0.19, 0, white),
    boxPart(0.2, 0.022, 0.055, 0, 0.215, 0, red),
    boxPart(0.055, 0.022, 0.2, 0, 0.215, 0, red),
    boxPart(0.1, 0.03, 0.05, 0, 0.225, 0, latch),
  ];
}

/** armor vest: torso plate + front plate + shoulders + belt */
function vestLootParts(): LootPart[] {
  const base = 0x5c6f7d, plate = 0x42525e, belt = 0x3a464f;
  return [
    boxPart(0.34, 0.36, 0.14, 0, 0.18, 0, base),
    boxPart(0.26, 0.22, 0.05, 0, 0.2, 0.08, plate),
    boxPart(0.1, 0.06, 0.16, -0.16, 0.38, 0, base),
    boxPart(0.1, 0.06, 0.16, 0.16, 0.38, 0, base),
    boxPart(0.36, 0.06, 0.15, 0, 0.06, 0, belt),
  ];
}

/** colored glow ring on the ground so loot pops from a distance */
function haloLootPart(kind: LootKind): LootPart {
  const gun = kind.startsWith('w');
  const geo = new THREE.CircleGeometry(gun ? 0.55 : 0.42, 18);
  const m = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
  m.setPosition(0, gun ? 0.015 : -0.36, 0);
  return { geo, m, c: LOOT_HALO[kind] };
}

const lootGeos = new Map<LootKind, THREE.BufferGeometry>();
let lootMat: THREE.MeshLambertMaterial | null = null;

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
