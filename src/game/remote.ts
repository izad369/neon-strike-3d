// NEON STRIKE 3D - remote player entity with snapshot interpolation
import * as THREE from 'three';
import { makeAvatar, playerColor } from './avatar';
import { SnapPlayer } from './constants';

interface Sample { p: THREE.Vector3; y: number; x: number; m: 0 | 1; s: 0 | 1; t: number }

export class RemotePlayer {
  id: string;
  name: string;
  group: THREE.Group;
  hitMeshes: THREE.Mesh[];
  kills = 0; deaths = 0;
  hp = 100;
  alive = true;
  private buf: Sample[] = [];
  private lastShooting = false;
  muzzle = new THREE.Vector3();

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
    const av = makeAvatar(playerColor(id), name);
    this.group = av.group;
    this.hitMeshes = av.hitMeshes;
    this.hitMeshes.forEach(m => { m.userData.remoteId = this.id; });
  }

  applySnap(s: SnapPlayer, clientTime: number) {
    this.hp = s.hp;
    this.alive = s.hp > 0;
    this.group.visible = this.alive;
    this.name = s.n;
    this.buf.push({ p: new THREE.Vector3(s.p[0], s.p[1], s.p[2]), y: s.y, x: s.x, m: s.m, s: s.s, t: clientTime });
    // keep ~1s of samples
    while (this.buf.length > 20) this.buf.shift();
  }

  /** interpolate towards renderTime (renderTime = now - interpDelay) */
  update(now: number, renderDelay: number) {
    if (this.buf.length === 0) return;
    const target = now - renderDelay;
    // find two samples around target time
    let a = this.buf[0], b = this.buf[this.buf.length - 1];
    for (let i = 0; i < this.buf.length - 1; i++) {
      if (this.buf[i].t <= target && this.buf[i + 1].t >= target) {
        a = this.buf[i]; b = this.buf[i + 1];
        break;
      }
    }
    const span = b.t - a.t;
    const f = span > 0 ? THREE.MathUtils.clamp((target - a.t) / span, 0, 1) : 1;
    const pos = a.p.clone().lerp(b.p, f);
    const yaw = lerpAngle(a.y, b.y, f);
    this.group.position.copy(pos);
    this.group.rotation.y = yaw;
    this.muzzle.set(pos.x, pos.y + 1.1, pos.z);
    // small recoil dip when shooting (cheap visual, works for soldier & fallback)
    const shooting = b.s === 1;
    const body = this.group.userData.body as THREE.Object3D | undefined;
    if (body) {
      if (shooting && !this.lastShooting) body.position.y = -0.05;
      body.position.y += (0 - body.position.y) * 0.2;
    }
    this.lastShooting = shooting;
  }

  reset() {
    this.buf = [];
    this.group.visible = false;
  }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
