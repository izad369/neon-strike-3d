// DESERT STRIKE 3D - scene, desert military outpost map, collision & raycast helpers
import * as THREE from 'three';
import { CFG, COLORS } from './constants';

export type Box = { min: THREE.Vector3; max: THREE.Vector3 };

export class World {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  solids: THREE.Mesh[] = [];      // meshes bullets/LOS collide with
  colliders: Box[] = [];          // AABBs players collide with
  spawnPoints: THREE.Vector3[] = [];
  patrolPoints: THREE.Vector3[] = [];
  private raycaster = new THREE.Raycaster();

  constructor(container: HTMLElement, opts?: { mobile?: boolean }) {
    const mobile = !!opts?.mobile;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.FogExp2(COLORS.sky, 0.011);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 300);
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    // mobile GPUs: cap pixel ratio harder (fill-rate is the bottleneck on phones)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.4 : 1.75));
    container.appendChild(this.renderer.domElement);
    this.resize();

    this.buildLights();
    this.buildArena();
  }

  resize(w?: number, h?: number) {
    // visualViewport covers iOS toolbars/rotation better than window alone.
    // Forced-landscape mode passes swapped dims explicitly (portrait phones).
    const vv = window.visualViewport;
    const dw = Math.round(vv?.width ?? window.innerWidth);
    const dh = Math.round(vv?.height ?? window.innerHeight);
    const W = w ?? dw, H = h ?? dh;
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, H);
  }

  private buildLights() {
    // harsh desert sun + warm bounce
    this.scene.add(new THREE.HemisphereLight(0xfff3d6, 0x9a8a68, 1.0));
    const dir = new THREE.DirectionalLight(0xffe4b8, 1.15);
    dir.position.set(30, 55, 18);
    this.scene.add(dir);
    // subtle warm fill from the opposite corner
    const fill = new THREE.DirectionalLight(0xd8c8a8, 0.35);
    fill.position.set(-24, 30, -26);
    this.scene.add(fill);
  }

  private addBox(x: number, y: number, z: number, w: number, h: number, d: number, opts?: { glow?: number; solid?: boolean }) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.wallBase });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    this.scene.add(mesh);
    if (opts?.solid !== false) {
      this.solids.push(mesh);
      this.colliders.push({
        min: new THREE.Vector3(x - w / 2, y, z - d / 2),
        max: new THREE.Vector3(x + w / 2, y + h, z + d / 2),
      });
    }
    // military trim on top edge (was neon glow)
    const glow = opts?.glow ?? COLORS.cyan;
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.08, 0.1, d + 0.08),
      new THREE.MeshLambertMaterial({ color: glow })
    );
    trim.position.set(x, y + h + 0.02, z);
    this.scene.add(trim);
    return mesh;
  }

  /** plain collider box without the trim (props) */
  private addPropBox(x: number, y: number, z: number, w: number, h: number, d: number, color: number, ry = 0) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color })
    );
    mesh.position.set(x, y + h / 2, z);
    if (ry) mesh.rotation.y = ry;
    this.scene.add(mesh);
    this.solids.push(mesh);
    // AABB collider (approximation for rotated boxes)
    const ew = ry ? Math.abs(w * Math.cos(ry)) + Math.abs(d * Math.sin(ry)) : w;
    const ed = ry ? Math.abs(w * Math.sin(ry)) + Math.abs(d * Math.cos(ry)) : d;
    this.colliders.push({
      min: new THREE.Vector3(x - ew / 2, y, z - ed / 2),
      max: new THREE.Vector3(x + ew / 2, y + h, z + ed / 2),
    });
    return mesh;
  }

  /** oil barrel (cylinder) with an AABB collider */
  private addBarrel(x: number, z: number, color: number, h = 1.15, r = 0.42) {
    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, h, 12),
      new THREE.MeshLambertMaterial({ color })
    );
    mesh.position.set(x, h / 2, z);
    this.scene.add(mesh);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.04, r * 1.04, 0.08, 12),
      new THREE.MeshLambertMaterial({ color: 0x3c3a30 })
    );
    ring.position.set(x, h * 0.62, z);
    this.scene.add(ring);
    this.solids.push(mesh);
    this.colliders.push({
      min: new THREE.Vector3(x - r, 0, z - r),
      max: new THREE.Vector3(x + r, h, z + r),
    });
  }

  /** sandbag wall: two stacked rows, slightly offset */
  private addSandbags(x: number, z: number, w: number, ry = 0) {
    const c1 = 0x9a8a62, c2 = 0x8f7d55;
    const bag = 0.62;
    const n = Math.max(2, Math.round(w / bag));
    for (let row = 0; row < 2; row++) {
      const y = row * 0.5;
      const off = row === 0 ? 0 : bag / 2;
      for (let i = 0; i < n; i++) {
        const lx = -w / 2 + bag / 2 + i * bag + off - (row === 1 ? bag / 2 : 0);
        if (lx > w / 2) continue;
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(bag * 0.94, 0.5, 0.72),
          new THREE.MeshLambertMaterial({ color: (i + row) % 2 ? c1 : c2 })
        );
        const cos = Math.cos(ry), sin = Math.sin(ry);
        m.position.set(x + lx * cos, 0.25 + y, z + lx * sin);
        m.rotation.y = ry;
        m.rotation.z = (Math.random() - 0.5) * 0.05;
        this.scene.add(m);
      }
    }
    // one collider for the whole bag wall
    const ew = ry ? Math.abs(w * Math.cos(ry)) + Math.abs(0.72 * Math.sin(ry)) : w;
    const ed = ry ? Math.abs(w * Math.sin(ry)) + Math.abs(0.72 * Math.cos(ry)) : 0.72;
    this.colliders.push({
      min: new THREE.Vector3(x - ew / 2, 0, z - ed / 2),
      max: new THREE.Vector3(x + ew / 2, 1.0, z + ed / 2),
    });
  }

  /** canvas tent: two leaning panels + back wall (approx AABB cover) */
  private addTent(x: number, z: number, ry = 0) {
    const canvas = 0x8f9166, canvasDark = 0x7c7e58;
    const g = new THREE.Group();
    const w = 3.4, d = 3.8, ang = 0.62;
    const pL = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.09, d), new THREE.MeshLambertMaterial({ color: canvas }));
    pL.rotation.z = ang; pL.position.set(-0.92, 0.85, 0);
    const pR = new THREE.Mesh(new THREE.BoxGeometry(2.15, 0.09, d), new THREE.MeshLambertMaterial({ color: canvasDark }));
    pR.rotation.z = -ang; pR.position.set(0.92, 0.85, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.7, 0.1), new THREE.MeshLambertMaterial({ color: canvasDark }));
    back.position.set(0, 0.85, -d / 2);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.9, 6), new THREE.MeshLambertMaterial({ color: 0x5a4526 }));
    pole.position.set(0, 0.95, 0);
    g.add(pL, pR, back, pole);
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    this.scene.add(g);
    this.solids.push(pL, pR, back);
    this.colliders.push({
      min: new THREE.Vector3(x - w / 2, 0, z - d / 2),
      max: new THREE.Vector3(x + w / 2, 1.55, z + d / 2),
    });
  }

  /** wooden watchtower: 4 legs, platform, railing, roof */
  private addWatchtower(x: number, z: number) {
    const wood = 0x7a5c38, woodDark = 0x63492c;
    const s = 4.4, legH = 4.2;
    // legs
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) => {
      const leg = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, legH, 0.36),
        new THREE.MeshLambertMaterial({ color: woodDark })
      );
      leg.position.set(x + sx * (s / 2 - 0.2), legH / 2, z + sz * (s / 2 - 0.2));
      this.scene.add(leg);
      this.solids.push(leg);
      this.colliders.push({
        min: new THREE.Vector3(leg.position.x - 0.18, 0, leg.position.z - 0.18),
        max: new THREE.Vector3(leg.position.x + 0.18, legH, leg.position.z + 0.18),
      });
    });
    // platform (stand on it)
    this.addPropBox(x, legH, z, s, 0.32, s, wood);
    // railing on 3 sides (opening faces center of map)
    const railH = 0.95;
    const ry = Math.atan2(-x, -z); // face origin
    const railDef: [number, number, number, number][] = [
      [0, -s / 2, s, 0.18], [0, s / 2, s, 0.18], [-s / 2, 0, 0.18, s], [s / 2, 0, 0.18, s],
    ];
    void ry;
    railDef.forEach(([ox, oz, rw, rd]) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(rw, railH, rd),
        new THREE.MeshLambertMaterial({ color: wood })
      );
      rail.position.set(x + ox, legH + 0.32 + railH / 2, z + oz);
      this.scene.add(rail);
      this.solids.push(rail);
      this.colliders.push({
        min: new THREE.Vector3(rail.position.x - rw / 2, legH + 0.32, rail.position.z - rd / 2),
        max: new THREE.Vector3(rail.position.x + rw / 2, legH + 0.32 + railH, rail.position.z + rd / 2),
      });
    });
    // roof
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(s * 0.78, 1.3, 4),
      new THREE.MeshLambertMaterial({ color: woodDark })
    );
    roof.position.set(x, legH + 0.32 + railH + 1.5, z);
    roof.rotation.y = Math.PI / 4;
    this.scene.add(roof);
    // step crates to climb up
    this.addPropBox(x + s / 2 + 1.1, 0, z, 1.6, 1.1, 1.6, woodDark);
    this.addPropBox(x + s / 2 + 1.1, 1.1, z, 1.6, 1.1, 1.6, woodDark);
    this.addPropBox(x + s / 2 - 0.7, 0, z, 1.4, 2.2, 1.4, woodDark);
  }

  /** comms mast with crossbars + a small flag */
  private addMast(x: number, z: number) {
    const metal = 0x50524a;
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.2, 9, 8),
      new THREE.MeshLambertMaterial({ color: metal })
    );
    mast.position.set(x, 4.5, z);
    this.scene.add(mast);
    this.solids.push(mast);
    this.colliders.push({
      min: new THREE.Vector3(x - 0.25, 0, z - 0.25),
      max: new THREE.Vector3(x + 0.25, 9, z + 0.25),
    });
    [[6.4, 2.2], [7.4, 1.6]].forEach(([hy, w]) => {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(w, 0.09, 0.09),
        new THREE.MeshLambertMaterial({ color: metal })
      );
      bar.position.set(x, hy, z);
      this.scene.add(bar);
    });
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.6),
      new THREE.MeshLambertMaterial({ color: 0xb8b0a0, side: THREE.DoubleSide })
    );
    dish.position.set(x + 0.35, 8.35, z);
    dish.rotation.z = Math.PI * 0.75;
    this.scene.add(dish);
  }

  /** jersey barrier (concrete) */
  private addBarrier(x: number, z: number, ry: number) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.5, 0.62),
      new THREE.MeshLambertMaterial({ color: 0xb0a895 })
    );
    m.position.set(x, 0.25, z);
    m.rotation.y = ry;
    const top = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 0.55, 0.34),
      new THREE.MeshLambertMaterial({ color: 0xa39b88 })
    );
    top.position.set(x, 0.77, z);
    top.rotation.y = ry;
    this.scene.add(m, top);
    this.solids.push(m, top);
    const ew = Math.abs(2.4 * Math.cos(ry)) + Math.abs(0.62 * Math.sin(ry));
    const ed = Math.abs(2.4 * Math.sin(ry)) + Math.abs(0.62 * Math.cos(ry));
    this.colliders.push({
      min: new THREE.Vector3(x - ew / 2, 0, z - ed / 2),
      max: new THREE.Vector3(x + ew / 2, 1.05, z + ed / 2),
    });
  }

  private buildArena() {
    const A = CFG.arena, H = CFG.wallH, half = A / 2;
    const t = 1;

    // floor (sand)
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(A, A),
      new THREE.MeshLambertMaterial({ color: 0xc7b183 })
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(A, 40, COLORS.floorGrid, 0x9c8a60);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.position.y = 0.01;
    this.scene.add(grid);

    // sandbag/beam decor lines over the arena (was neon ceiling bars)
    for (let i = -3; i <= 3; i++) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(A - 8, 0.18, 0.55),
        new THREE.MeshLambertMaterial({ color: 0x6e5b40 })
      );
      bar.position.set(0, 11, i * 11);
      this.scene.add(bar);
    }

    // perimeter walls
    const perGlow = [COLORS.cyan, COLORS.magenta, COLORS.purple, COLORS.orange];
    [[0, -half, A + t, t, 0], [0, half, A + t, t, 1], [-half, 0, t, A + t, 2], [half, 0, t, A + t, 3]].forEach(
      ([x, z, w, d, i]) => this.addBox(x, 0, z, w, H, d, { glow: perGlow[i as number] })
    );

    // central raised platform (jumpable via side crates)
    this.addBox(0, 0, 0, 14, 2, 14, { glow: COLORS.yellow });
    // step crates to climb it
    this.addBox(0, 0, 10, 3, 1, 3, { glow: COLORS.green });
    this.addBox(0, 0, -10, 3, 1, 3, { glow: COLORS.green });

    // inner walls (symmetric layout)
    const W = COLORS.cyan, M = COLORS.magenta;
    // L-shape corners
    this.addBox(-16, 0, -16, 14, H - 1, 1.2, { glow: W });
    this.addBox(-22.4, 0, -10, 1.2, H - 1, 13, { glow: W });
    this.addBox(16, 0, 16, 14, H - 1, 1.2, { glow: M });
    this.addBox(22.4, 0, 10, 1.2, H - 1, 13, { glow: M });
    // mid lanes
    this.addBox(-14, 0, 16, 1.2, H - 1, 12, { glow: M });
    this.addBox(14, 0, -16, 1.2, H - 1, 12, { glow: W });
    // side long walls
    this.addBox(-30, 0, 2, 1.2, H, 18, { glow: COLORS.purple });
    this.addBox(30, 0, -2, 1.2, H, 18, { glow: COLORS.purple });
    // small cover walls
    this.addBox(-8, 0, -26, 10, 2.6, 1.2, { glow: COLORS.orange });
    this.addBox(8, 0, 26, 10, 2.6, 1.2, { glow: COLORS.orange });

    // pillars
    [[-10, -10], [10, -10], [-10, 10], [10, 10]].forEach(([x, z]) => {
      this.addBox(x, 0, z, 2.2, H - 0.5, 2.2, { glow: COLORS.green });
    });

    // crates (climbable)
    const crateSpots: [number, number, number][] = [
      [-26, -26, 2], [-24, -26, 2], [-25, -23, 1], // stack corner NW
      [26, 26, 2], [24, 26, 2], [25, 23, 1],       // stack corner SE
      [26, -24, 2], [-26, 24, 2], [-34, -8, 1.5], [34, 8, 1.5],
      [0, -20, 1.5], [0, 20, 1.5], [-18, 0, 1.5], [18, 0, 1.5],
    ];
    crateSpots.forEach(([x, z, s]) => this.addBox(x, 0, z, s, s, s, { glow: COLORS.cyan }));

    // ---------- military props ----------
    // wooden watchtowers (climbable via step crates) on the empty diagonal corners
    this.addWatchtower(-26, 26);
    this.addWatchtower(26, -26);

    // canvas tents
    this.addTent(-30, -14, 0.5);
    this.addTent(30, 14, 0.5 + Math.PI);

    // sandbag cover walls
    this.addSandbags(6, 24, 4.5, 0);
    this.addSandbags(-6, -24, 4.5, 0);
    this.addSandbags(24, 0, 4.5, Math.PI / 2);
    this.addSandbags(-24, 0, 4.5, Math.PI / 2);

    // oil barrels (clusters)
    const barrelSpots: [number, number][] = [
      [-14, 8], [-13.2, 9], [-14.6, 9.2],
      [14, -8], [13.2, -9], [14.6, -9.2],
      [4, -15], [-4, 15],
      [-21, 21], [21, -21],
    ];
    barrelSpots.forEach(([bx, bz], i) => this.addBarrel(bx, bz, i % 3 === 0 ? 0x8a4a2e : 0x5f6b45));

    // concrete jersey barriers
    this.addBarrier(13, 13, 0.65);
    this.addBarrier(-13, -13, 0.65);
    this.addBarrier(-13, 13, -0.65);
    this.addBarrier(13, -13, -0.65);

    // ammo crate stacks
    this.addPropBox(10, 0, -4, 1.3, 0.7, 0.8, 0x5f6b45);
    this.addPropBox(10, 0.7, -4, 1.0, 0.55, 0.7, 0x6e7c4e);
    this.addPropBox(-10, 0, 4, 1.3, 0.7, 0.8, 0x5f6b45);
    this.addPropBox(-10, 0.7, 4, 1.0, 0.55, 0.7, 0x6e7c4e);

    // comms masts
    this.addMast(22, 2);
    this.addMast(-22, -2);

    // spawns: 8 around the edges
    this.spawnPoints = [
      new THREE.Vector3(-35, 0, -35), new THREE.Vector3(35, 0, -35),
      new THREE.Vector3(-35, 0, 35), new THREE.Vector3(35, 0, 35),
      new THREE.Vector3(0, 0, -35), new THREE.Vector3(0, 0, 35),
      new THREE.Vector3(-35, 0, 0), new THREE.Vector3(35, 0, 0),
    ];
    // patrol waypoints
    this.patrolPoints = [
      new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 0, 20),
      new THREE.Vector3(-20, 0, 20), new THREE.Vector3(20, 0, -20), new THREE.Vector3(0, 0, -30),
      new THREE.Vector3(0, 0, 30), new THREE.Vector3(-30, 0, 0), new THREE.Vector3(30, 0, 0),
      new THREE.Vector3(-12, 0, -30), new THREE.Vector3(12, 0, 30), new THREE.Vector3(-30, 0, 12),
      new THREE.Vector3(30, 0, -12), new THREE.Vector3(8, 0, -8), new THREE.Vector3(-8, 0, 8),
    ];
  }

  /** axis-separated AABB movement with ground/step resolution. Mutates pos & vel. */
  moveBody(pos: THREE.Vector3, vel: THREE.Vector3, dt: number, radius: number, height: number): { grounded: boolean } {
    let grounded = false;
    // Y first
    pos.y += vel.y * dt;
    if (pos.y <= 0) { pos.y = 0; vel.y = 0; grounded = true; }
    for (const b of this.colliders) {
      if (pos.x + radius > b.min.x && pos.x - radius < b.max.x && pos.z + radius > b.min.z && pos.z - radius < b.max.z) {
        if (vel.y <= 0 && pos.y <= b.max.y && pos.y + height > b.max.y && pos.y > b.max.y - 0.7) {
          pos.y = b.max.y; vel.y = 0; grounded = true;
        } else if (vel.y > 0 && pos.y + height > b.min.y && pos.y < b.min.y) {
          pos.y = b.min.y - height; vel.y = 0;
        }
      }
    }
    // X
    const oldX = pos.x;
    pos.x += vel.x * dt;
    for (const b of this.colliders) {
      if (this.overlaps(pos, radius, height, b)) {
        pos.x = oldX; vel.x = 0; break;
      }
    }
    // Z
    const oldZ = pos.z;
    pos.z += vel.z * dt;
    for (const b of this.colliders) {
      if (this.overlaps(pos, radius, height, b)) {
        pos.z = oldZ; vel.z = 0; break;
      }
    }
    const lim = CFG.arena / 2 - radius - 0.4;
    pos.x = THREE.MathUtils.clamp(pos.x, -lim, lim);
    pos.z = THREE.MathUtils.clamp(pos.z, -lim, lim);
    return { grounded };
  }

  private overlaps(pos: THREE.Vector3, r: number, h: number, b: Box): boolean {
    return pos.x + r > b.min.x && pos.x - r < b.max.x &&
      pos.z + r > b.min.z && pos.z - r < b.max.z &&
      pos.y + h > b.min.y && pos.y < b.max.y;
  }

  /** LOS check between two points against solid geometry */
  hasLOS(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = new THREE.Vector3().subVectors(b, a);
    const dist = dir.length();
    if (dist < 0.001) return true;
    dir.normalize();
    this.raycaster.set(a, dir);
    this.raycaster.far = dist;
    const hits = this.raycaster.intersectObjects(this.solids, false);
    return hits.length === 0;
  }

  /** raycast for bullets; returns nearest hit or null */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, far: number, extra: THREE.Object3D[] = []): { point: THREE.Vector3; object: THREE.Object3D; headshot: boolean } | null {
    this.raycaster.set(origin, dir);
    this.raycaster.far = far;
    const targets = [...this.solids, ...extra];
    const hits = this.raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    const h = hits[0];
    return { point: h.point.clone(), object: h.object, headshot: h.object.userData.head === true };
  }

  pickSpawn(avoid: THREE.Vector3[]): THREE.Vector3 {
    let best = this.spawnPoints[0], bestScore = -1;
    for (const sp of this.spawnPoints) {
      let minD = Infinity;
      for (const a of avoid) minD = Math.min(minD, sp.distanceTo(a));
      const score = minD + Math.random() * 5;
      if (score > bestScore) { bestScore = score; best = sp; }
    }
    return best.clone();
  }

  dispose() {
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
