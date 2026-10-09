// NEON STRIKE 3D - AI bots (simulated on host / in offline mode)
import * as THREE from 'three';
import { CFG, DIFFICULTY, Difficulty } from './constants';
import { World } from './world';
import { makeAvatar } from './avatar';
import { AudioFX } from './audio';

export interface BotTarget {
  id: string;
  pos: THREE.Vector3;
  alive: boolean;
  isLocal: boolean;
  team: number; // -1 = no teams (DM), 0/1 = TDM
}

export interface BotShot {
  targetId: string;
  dmg: number;
  headshot: boolean;
  from: THREE.Vector3;
  to: THREE.Vector3;
}

type BotState = 'patrol' | 'combat' | 'hunt';

let botCounter = 0;

export interface BotOptions {
  team?: number;        // -1 default (no teams)
  hpScale?: number;     // survival waves scale hp
  dmgScale?: number;    // survival waves scale damage
  noRespawn?: boolean;  // survival: waves spawn fresh bots, no auto respawn
}

export class Bot {
  id: string;
  name: string;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  hp = CFG.botHp;
  maxHp = CFG.botHp;
  alive = true;
  team: number;
  group: THREE.Group;
  hitMeshes: THREE.Mesh[];
  state: BotState = 'patrol';
  private targetPoint = new THREE.Vector3();
  private lastSeen: THREE.Vector3 | null = null;
  private nextThink = 0;
  private nextFire = 0;
  private burstLeft = 0;
  private respawnAt = 0;
  private strafeDir = 1;
  private repathAt = 0;
  private lastShotAt = 0;
  private dmgScale: number;
  private noRespawn: boolean;
  get shooting(): boolean { return performance.now() - this.lastShotAt < 160; }
  private diff: typeof DIFFICULTY[Difficulty];

  constructor(name: string, color: number, diff: Difficulty, private world: World, private audio: AudioFX,
    private onShoot: (shot: BotShot) => void, opts?: BotOptions) {
    this.id = 'b' + (++botCounter);
    this.name = name;
    this.team = opts?.team ?? -1;
    this.dmgScale = opts?.dmgScale ?? 1;
    this.noRespawn = opts?.noRespawn ?? false;
    this.diff = DIFFICULTY[diff];
    this.maxHp = Math.round(CFG.botHp * (opts?.hpScale ?? 1));
    this.hp = this.maxHp;
    const av = makeAvatar(color, name);
    this.group = av.group;
    this.hitMeshes = av.hitMeshes;
    this.hitMeshes.forEach(m => { m.userData.botId = this.id; });
  }

  spawnAt(p: THREE.Vector3) {
    this.pos.copy(p); this.pos.y += 0.1;
    this.vel.set(0, 0, 0);
    this.hp = this.maxHp;
    this.alive = true;
    this.state = 'patrol';
    this.lastSeen = null;
    this.group.visible = true;
    this.audio.spawnFx();
  }

  takeDamage(amt: number, now: number, attackerPos: THREE.Vector3): boolean {
    if (!this.alive) return false;
    this.hp -= amt;
    // aggro towards attacker
    this.lastSeen = attackerPos.clone();
    if (this.state === 'patrol') this.state = 'combat';
    if (this.hp <= 0) { this.hp = 0; this.die(now); return true; }
    return false;
  }

  private die(now: number) {
    this.alive = false;
    this.respawnAt = this.noRespawn ? Number.POSITIVE_INFINITY : now + CFG.respawnDelay * 1000;
    this.group.visible = false;
  }

  private pickPatrol() {
    const pts = this.world.patrolPoints;
    this.targetPoint.copy(pts[Math.floor(Math.random() * pts.length)]);
  }

  update(dt: number, now: number, targets: BotTarget[]) {
    if (!this.alive) {
      if (now >= this.respawnAt) {
        const avoid = targets.filter(t => t.alive).map(t => t.pos);
        this.spawnAt(this.world.pickSpawn(avoid));
      }
      return;
    }

    // --- think (10 Hz) ---
    if (now >= this.nextThink) {
      this.nextThink = now + 100;
      this.think(targets, now);
    }

    // --- act ---
    const speed = this.diff.moveSpeed;
    let moveTarget: THREE.Vector3 | null = null;

    if (this.state === 'combat') {
      const tgt = this.currentTarget(targets);
      if (tgt) {
        const dist = this.pos.distanceTo(tgt.pos);
        // strafe around target, keep mid range
        if (now >= this.repathAt) {
          this.repathAt = now + 700 + Math.random() * 600;
          this.strafeDir = Math.random() < 0.5 ? -1 : 1;
          if (dist < 7) this.strafeDir *= -1; // too close, back off
        }
        const toT = new THREE.Vector3().subVectors(tgt.pos, this.pos).setY(0).normalize();
        const side = new THREE.Vector3(-toT.z, 0, toT.x).multiplyScalar(this.strafeDir);
        const desired = new THREE.Vector3().subVectors(tgt.pos, this.pos).setY(0);
        const keep = dist > 16 ? 1 : dist < 8 ? -1 : 0;
        moveTarget = new THREE.Vector3(
          this.pos.x + side.x * 6 + toT.x * keep * 4,
          this.pos.y,
          this.pos.z + side.z * 6 + toT.z * keep * 4
        );
        this.yaw = Math.atan2(-toT.x, -toT.z);
        // fire control
        if (now >= this.nextFire && this.burstLeft <= 0) {
          this.burstLeft = this.diff.burst;
        }
        if (this.burstLeft > 0 && now >= this.nextFire) {
          this.shootAt(tgt, now);
          this.burstLeft--;
          this.nextFire = now + (this.burstLeft > 0 ? this.diff.fireInterval * 1000 : 500 + Math.random() * 700);
        }
      } else {
        this.state = this.lastSeen ? 'hunt' : 'patrol';
      }
    }

    if (this.state === 'hunt' && this.lastSeen) {
      moveTarget = this.lastSeen;
      if (this.pos.distanceTo(this.lastSeen) < 2) { this.lastSeen = null; this.state = 'patrol'; }
    }

    if (this.state === 'patrol') {
      if (this.pos.distanceTo(this.targetPoint) < 2 || this.targetPoint.lengthSq() === 0) this.pickPatrol();
      moveTarget = this.targetPoint;
      const to = new THREE.Vector3().subVectors(moveTarget, this.pos).setY(0);
      if (to.lengthSq() > 0.01) this.yaw = Math.atan2(-to.x, -to.z);
    }

    if (moveTarget) {
      const to = new THREE.Vector3().subVectors(moveTarget, this.pos).setY(0);
      if (to.lengthSq() > 0.1) {
        to.normalize().multiplyScalar(speed);
        // obstacle probe
        const probe = new THREE.Vector3(this.pos.x, this.pos.y + 0.9, this.pos.z);
        const ahead = new THREE.Vector3(to.x, 0, to.z).normalize();
        if (!this.world.hasLOS(probe, probe.clone().add(ahead.multiplyScalar(1.6)))) {
          const side = new THREE.Vector3(-ahead.z, 0, ahead.x).multiplyScalar(this.strafeDir);
          to.x = side.x * speed; to.z = side.z * speed;
        }
        this.vel.x = to.x; this.vel.z = to.z;
      } else { this.vel.x = 0; this.vel.z = 0; }
    } else { this.vel.x = 0; this.vel.z = 0; }

    this.vel.y -= CFG.gravity * dt;
    this.world.moveBody(this.pos, this.vel, dt, CFG.playerRadius, CFG.playerHeight);

    // animate
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    const moving = Math.abs(this.vel.x) + Math.abs(this.vel.z) > 0.5;
    // subtle walk bob on the visual body (soldier model or fallback)
    const body = this.group.userData.body as THREE.Object3D | undefined;
    if (body) body.position.y = moving ? Math.abs(Math.sin(now * 0.011)) * 0.05 : 0;
  }

  private currentTarget(targets: BotTarget[]): BotTarget | null {
    let best: BotTarget | null = null, bestD = Infinity;
    const eye = new THREE.Vector3(this.pos.x, this.pos.y + 1.4, this.pos.z);
    for (const t of targets) {
      if (!t.alive) continue;
      if (t.id === this.id) continue; // never target self
      if (this.team !== -1 && t.team === this.team) continue; // team mode: enemies only
      const d = this.pos.distanceTo(t.pos);
      if (d > this.diff.vision) continue;
      const tEye = new THREE.Vector3(t.pos.x, t.pos.y + 1.4, t.pos.z);
      if (!this.world.hasLOS(eye, tEye)) continue;
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  }

  private think(targets: BotTarget[], now: number) {
    if (this.state === 'combat') return; // combat re-evaluated each frame via currentTarget
    const tgt = this.currentTarget(targets);
    if (tgt) {
      this.state = 'combat';
      this.lastSeen = tgt.pos.clone();
      this.nextFire = now + this.diff.reaction * 1000;
      this.burstLeft = 0;
    }
  }

  private shootAt(target: BotTarget, now: number) {
    const from = new THREE.Vector3(this.pos.x, this.pos.y + 1.4, this.pos.z);
    const aim = new THREE.Vector3(target.pos.x, target.pos.y + 1.1, target.pos.z);
    const dir = aim.sub(from).normalize();
    const sp = this.diff.spread;
    dir.x += (Math.random() - 0.5) * sp * 2;
    dir.y += (Math.random() - 0.5) * sp * 2;
    dir.z += (Math.random() - 0.5) * sp * 2;
    dir.normalize();

    // resolve hit against world + all targets (approximation: hits first target in cone)
    const toT = new THREE.Vector3(target.pos.x, target.pos.y + 1.1, target.pos.z).sub(from);
    const dist = toT.length();
    const alignment = toT.normalize().dot(dir);
    const hit = alignment > 0.995 - Math.min(0.01, dist * 0.0001) ? target : null;

    this.lastShotAt = now;
    const endPoint = from.clone().add(dir.clone().multiplyScalar(Math.min(dist + 2, CFG.range)));
    if (hit) {
      const dmg = Math.round(this.diff.dmg * CFG.botDamage * (alignment > 0.9993 ? 1.5 : 1) * this.dmgScale);
      this.onShoot({ targetId: hit.id, dmg, headshot: alignment > 0.9993, from, to: endPoint });
    } else {
      this.onShoot({ targetId: '', dmg: 0, headshot: false, from, to: endPoint });
    }
    this.audio.botShoot();
  }
}
