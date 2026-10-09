// DESERT STRIKE 3D - scene + map system (outpost / urban / oasis / warzone),
// collision & raycast helpers
import * as THREE from 'three';
import { CFG, COLORS } from './constants';

export type Box = { min: THREE.Vector3; max: THREE.Vector3 };
export type WorldMapId = 'outpost' | 'urban' | 'oasis' | 'warzone';

export class World {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  solids: THREE.Mesh[] = [];      // meshes bullets/LOS collide with
  colliders: Box[] = [];          // AABBs players collide with
  spawnPoints: THREE.Vector3[] = [];
  patrolPoints: THREE.Vector3[] = [];
  lootSpots: THREE.Vector3[] = []; // BR loot anchors
  arenaSize = CFG.arena;           // per-map play area (BR warzone is bigger)
  mapId: WorldMapId = 'outpost';
  private mapRoot = new THREE.Group();
  private raycaster = new THREE.Raycaster();

  constructor(container: HTMLElement, opts?: { mobile?: boolean; map?: WorldMapId }) {
    const mobile = !!opts?.mobile;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(COLORS.sky);
    this.scene.fog = new THREE.FogExp2(COLORS.sky, 0.011);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 400);
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    // mobile GPUs: cap pixel ratio harder (fill-rate is the bottleneck on phones)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.4 : 1.75));
    container.appendChild(this.renderer.domElement);
    this.resize();

    this.scene.add(this.mapRoot);
    this.setMap(opts?.map ?? 'outpost');
  }

  /** wipe and build a different map (called when a match starts) */
  setMap(id: WorldMapId) {
    this.mapRoot.clear();
    this.solids = [];
    this.colliders = [];
    this.spawnPoints = [];
    this.patrolPoints = [];
    this.lootSpots = [];
    this.mapId = id;
    this.buildLights();
    if (id === 'urban') this.buildUrban();
    else if (id === 'oasis') this.buildOasis();
    else if (id === 'warzone') this.buildWarzone();
    else this.buildOutpost();
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
    // harsh desert sun + warm bounce (per-map tint applied via lights)
    this.scene.add(new THREE.HemisphereLight(0xfff3d6, 0x9a8a68, 1.0));
    const dir = new THREE.DirectionalLight(0xffe4b8, 1.15);
    dir.position.set(30, 55, 18);
    this.scene.add(dir);
    const fill = new THREE.DirectionalLight(0xd8c8a8, 0.35);
    fill.position.set(-24, 30, -26);
    this.scene.add(fill);
  }

  private setSky(sky: number, fogDensity: number) {
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.FogExp2(sky, fogDensity);
  }

  private addBox(x: number, y: number, z: number, w: number, h: number, d: number, opts?: { glow?: number; solid?: boolean; color?: number }) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const mat = new THREE.MeshLambertMaterial({ color: opts?.color ?? COLORS.wallBase });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y + h / 2, z);
    this.mapRoot.add(mesh);
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
    this.mapRoot.add(trim);
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
    this.mapRoot.add(mesh);
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
    this.mapRoot.add(mesh);
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 1.04, r * 1.04, 0.08, 12),
      new THREE.MeshLambertMaterial({ color: 0x3c3a30 })
    );
    ring.position.set(x, h * 0.62, z);
    this.mapRoot.add(ring);
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
        this.mapRoot.add(m);
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
    this.mapRoot.add(g);
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
      this.mapRoot.add(leg);
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
    const railDef: [number, number, number, number][] = [
      [0, -s / 2, s, 0.18], [0, s / 2, s, 0.18], [-s / 2, 0, 0.18, s], [s / 2, 0, 0.18, s],
    ];
    railDef.forEach(([ox, oz, rw, rd]) => {
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(rw, railH, rd),
        new THREE.MeshLambertMaterial({ color: wood })
      );
      rail.position.set(x + ox, legH + 0.32 + railH / 2, z + oz);
      this.mapRoot.add(rail);
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
    this.mapRoot.add(roof);
    // step crates to climb up
    this.addPropBox(x + s / 2 + 1.1, 0, z, 1.6, 1.1, 1.6, woodDark);
    this.addPropBox(x + s / 2 + 1.1, 1.1, z, 1.6, 1.1, 1.6, woodDark);
    this.addPropBox(x + s / 2 - 0.7, 0, z, 1.4, 2.2, 1.4, woodDark);
  }

  /** comms mast with crossbars + a small dish */
  private addMast(x: number, z: number) {
    const metal = 0x50524a;
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.2, 9, 8),
      new THREE.MeshLambertMaterial({ color: metal })
    );
    mast.position.set(x, 4.5, z);
    this.mapRoot.add(mast);
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
      this.mapRoot.add(bar);
    });
    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2.6),
      new THREE.MeshLambertMaterial({ color: 0xb8b0a0, side: THREE.DoubleSide })
    );
    dish.position.set(x + 0.35, 8.35, z);
    dish.rotation.z = Math.PI * 0.75;
    this.mapRoot.add(dish);
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
    this.mapRoot.add(m, top);
    this.solids.push(m, top);
    const ew = Math.abs(2.4 * Math.cos(ry)) + Math.abs(0.62 * Math.sin(ry));
    const ed = Math.abs(2.4 * Math.sin(ry)) + Math.abs(0.62 * Math.cos(ry));
    this.colliders.push({
      min: new THREE.Vector3(x - ew / 2, 0, z - ed / 2),
      max: new THREE.Vector3(x + ew / 2, 1.05, z + ed / 2),
    });
  }

  /** floor + grid + perimeter walls, shared by every map */
  private buildBase(size: number, floorColor: number, gridColor: number, wallColor: number) {
    const half = size / 2, t = 1, H = CFG.wallH;
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshLambertMaterial({ color: floorColor })
    );
    floor.rotation.x = -Math.PI / 2;
    this.mapRoot.add(floor);
    const grid = new THREE.GridHelper(size, Math.round(size / 2), gridColor, gridColor);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.3;
    grid.position.y = 0.01;
    this.mapRoot.add(grid);
    const per: [number, number, number, number][] = [
      [0, -half, size + t, t], [0, half, size + t, t], [-half, 0, t, size + t], [half, 0, t, size + t],
    ];
    per.forEach(([x, z, w, d]) => this.addBox(x, 0, z, w, H, d, { color: wallColor, glow: 0x6e5b40 }));
  }

  // ================= MAP 1: DESERT OUTPOST (classic) =================
  private buildOutpost() {
    this.arenaSize = CFG.arena;
    this.setSky(COLORS.sky, 0.011);
    this.buildBase(CFG.arena, 0xc7b183, COLORS.floorGrid, COLORS.wallBase);
    const A = CFG.arena, H = CFG.wallH;

    // sandbag/beam decor lines over the arena
    for (let i = -3; i <= 3; i++) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(A - 8, 0.18, 0.55),
        new THREE.MeshLambertMaterial({ color: 0x6e5b40 })
      );
      bar.position.set(0, 11, i * 11);
      this.mapRoot.add(bar);
    }

    // central raised platform (jumpable via side crates)
    this.addBox(0, 0, 0, 14, 2, 14, { glow: COLORS.yellow });
    this.addBox(0, 0, 10, 3, 1, 3, { glow: COLORS.green });
    this.addBox(0, 0, -10, 3, 1, 3, { glow: COLORS.green });

    // inner walls (symmetric layout)
    const W = COLORS.cyan, M = COLORS.magenta;
    this.addBox(-16, 0, -16, 14, H - 1, 1.2, { glow: W });
    this.addBox(-22.4, 0, -10, 1.2, H - 1, 13, { glow: W });
    this.addBox(16, 0, 16, 14, H - 1, 1.2, { glow: M });
    this.addBox(22.4, 0, 10, 1.2, H - 1, 13, { glow: M });
    this.addBox(-14, 0, 16, 1.2, H - 1, 12, { glow: M });
    this.addBox(14, 0, -16, 1.2, H - 1, 12, { glow: W });
    this.addBox(-30, 0, 2, 1.2, H, 18, { glow: COLORS.purple });
    this.addBox(30, 0, -2, 1.2, H, 18, { glow: COLORS.purple });
    this.addBox(-8, 0, -26, 10, 2.6, 1.2, { glow: COLORS.orange });
    this.addBox(8, 0, 26, 10, 2.6, 1.2, { glow: COLORS.orange });

    // pillars
    [[-10, -10], [10, -10], [-10, 10], [10, 10]].forEach(([x, z]) => {
      this.addBox(x, 0, z, 2.2, H - 0.5, 2.2, { glow: COLORS.green });
    });

    // crates (climbable)
    const crateSpots: [number, number, number][] = [
      [-26, -26, 2], [-24, -26, 2], [-25, -23, 1],
      [26, 26, 2], [24, 26, 2], [25, 23, 1],
      [26, -24, 2], [-26, 24, 2], [-34, -8, 1.5], [34, 8, 1.5],
      [0, -20, 1.5], [0, 20, 1.5], [-18, 0, 1.5], [18, 0, 1.5],
    ];
    crateSpots.forEach(([x, z, s]) => this.addBox(x, 0, z, s, s, s, { glow: COLORS.cyan }));

    // military props
    this.addWatchtower(-26, 26);
    this.addWatchtower(26, -26);
    this.addTent(-30, -14, 0.5);
    this.addTent(30, 14, 0.5 + Math.PI);
    this.addSandbags(6, 24, 4.5, 0);
    this.addSandbags(-6, -24, 4.5, 0);
    this.addSandbags(24, 0, 4.5, Math.PI / 2);
    this.addSandbags(-24, 0, 4.5, Math.PI / 2);
    const barrelSpots: [number, number][] = [
      [-14, 8], [-13.2, 9], [-14.6, 9.2],
      [14, -8], [13.2, -9], [14.6, -9.2],
      [4, -15], [-4, 15],
      [-21, 21], [21, -21],
    ];
    barrelSpots.forEach(([bx, bz], i) => this.addBarrel(bx, bz, i % 3 === 0 ? 0x8a4a2e : 0x5f6b45));
    this.addBarrier(13, 13, 0.65);
    this.addBarrier(-13, -13, 0.65);
    this.addBarrier(-13, 13, -0.65);
    this.addBarrier(13, -13, -0.65);
    this.addPropBox(10, 0, -4, 1.3, 0.7, 0.8, 0x5f6b45);
    this.addPropBox(10, 0.7, -4, 1.0, 0.55, 0.7, 0x6e7c4e);
    this.addPropBox(-10, 0, 4, 1.3, 0.7, 0.8, 0x5f6b45);
    this.addPropBox(-10, 0.7, 4, 1.0, 0.55, 0.7, 0x6e7c4e);
    this.addMast(22, 2);
    this.addMast(-22, -2);

    this.spawnPoints = [
      new THREE.Vector3(-35, 0, -35), new THREE.Vector3(35, 0, -35),
      new THREE.Vector3(-35, 0, 35), new THREE.Vector3(35, 0, 35),
      new THREE.Vector3(0, 0, -35), new THREE.Vector3(0, 0, 35),
      new THREE.Vector3(-35, 0, 0), new THREE.Vector3(35, 0, 0),
    ];
    this.patrolPoints = [
      new THREE.Vector3(0, 2.2, 0), new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 0, 20),
      new THREE.Vector3(-20, 0, 20), new THREE.Vector3(20, 0, -20), new THREE.Vector3(0, 0, -30),
      new THREE.Vector3(0, 0, 30), new THREE.Vector3(-30, 0, 0), new THREE.Vector3(30, 0, 0),
      new THREE.Vector3(-12, 0, -30), new THREE.Vector3(12, 0, 30), new THREE.Vector3(-30, 0, 12),
      new THREE.Vector3(30, 0, -12), new THREE.Vector3(8, 0, -8), new THREE.Vector3(-8, 0, 8),
    ];
    this.genLoot(26);
  }

  // ================= MAP 2: URBAN BLOCKS =================
  private buildUrban() {
    this.arenaSize = CFG.arena;
    this.setSky(0xb4bcc4, 0.014);
    this.buildBase(CFG.arena, 0x8f8d86, 0x77756e, 0x9a9890);
    const H = CFG.wallH;

    // four city blocks with street gaps
    const blocks: [number, number][] = [[-21, -21], [21, -21], [-21, 21], [21, 21]];
    blocks.forEach(([bx, bz], i) => {
      const h = 6 + (i % 2) * 2.5;
      this.addBox(bx, 0, bz, 15, h, 15, { color: 0xa39a8a, glow: 0x6b6f74 });      // main building
      this.addBox(bx + (i % 2 ? -9.5 : 9.5), 0, bz + (i < 2 ? 9.5 : -9.5), 5, 3.2, 5, { color: 0x8d8578, glow: 0x6b6f74 }); // annex
      this.addBox(bx, 0, bz + (i < 2 ? -9.8 : 9.8), 7, 2.2, 4, { color: 0x7d766c, glow: COLORS.orange }); // loading dock
    });

    // central plaza with raised platform
    this.addBox(0, 0, 0, 10, 1.6, 10, { color: 0xb0a895, glow: COLORS.yellow });
    this.addBox(0, 0, 7.5, 2.4, 0.8, 2.4, { color: 0xa39b88, glow: COLORS.green });
    this.addBox(0, 0, -7.5, 2.4, 0.8, 2.4, { color: 0xa39b88, glow: COLORS.green });

    // street covers
    this.addBarrier(0, 14, 0); this.addBarrier(0, -14, 0);
    this.addBarrier(-14, 0, Math.PI / 2); this.addBarrier(14, 0, Math.PI / 2);
    this.addBarrier(-8, 26, 0.4); this.addBarrier(8, -26, 0.4);
    this.addBarrier(26, 8, Math.PI / 2 + 0.4); this.addBarrier(-26, -8, Math.PI / 2 + 0.4);

    // side alleys
    this.addBox(-34, 0, 12, 1.2, H - 1, 10, { color: 0x9a948a, glow: 0x6b6f74 });
    this.addBox(34, 0, -12, 1.2, H - 1, 10, { color: 0x9a948a, glow: 0x6b6f74 });

    // street furniture
    const spots: [number, number][] = [[-6, -30], [6, 30], [30, -6], [-30, 6]];
    spots.forEach(([x, z], i) => {
      this.addBarrel(x, z, i % 2 ? 0x8a4a2e : 0x5f6b45);
      this.addBarrel(x + 1.2, z + 0.6, 0x5f6b45);
    });
    [[-28, -28], [28, 28], [-28, 28], [28, -28]].forEach(([x, z]) => this.addPropBox(x, 0, z, 2, 2, 2, 0x6e6a5e));
    this.addSandbags(12, 12, 4, 0.7); this.addSandbags(-12, -12, 4, 0.7);
    this.addTent(-32, 28, 0.3); this.addTent(32, -28, 0.3 + Math.PI);
    this.addMast(0, 26); this.addMast(0, -26);
    this.addWatchtower(-30, 0); this.addWatchtower(30, 0);

    this.spawnPoints = [
      new THREE.Vector3(-35, 0, -35), new THREE.Vector3(35, 0, -35),
      new THREE.Vector3(-35, 0, 35), new THREE.Vector3(35, 0, 35),
      new THREE.Vector3(0, 0, -36), new THREE.Vector3(0, 0, 36),
      new THREE.Vector3(-36, 0, 0), new THREE.Vector3(36, 0, 0),
    ];
    this.patrolPoints = [
      new THREE.Vector3(0, 1.6, 0), new THREE.Vector3(-21, 0, 0), new THREE.Vector3(21, 0, 0),
      new THREE.Vector3(0, 0, -21), new THREE.Vector3(0, 0, 21), new THREE.Vector3(-30, 0, -30),
      new THREE.Vector3(30, 0, 30), new THREE.Vector3(-30, 0, 30), new THREE.Vector3(30, 0, -30),
      new THREE.Vector3(-12, 0, 24), new THREE.Vector3(12, 0, -24), new THREE.Vector3(24, 0, 12),
      new THREE.Vector3(-24, 0, -12), new THREE.Vector3(0, 0, -32), new THREE.Vector3(0, 0, 32),
    ];
    this.genLoot(26);
  }

  // ================= MAP 3: DRY OASIS =================
  private buildOasis() {
    this.arenaSize = CFG.arena;
    this.setSky(0xdfe4c0, 0.009);
    this.buildBase(CFG.arena, 0xd0c088, 0xb3a476, 0x8a7a54);
    const H = CFG.wallH;

    // dried pond + rim rocks (center)
    const pond = new THREE.Mesh(
      new THREE.CircleGeometry(9, 28),
      new THREE.MeshLambertMaterial({ color: 0x6f8b8f })
    );
    pond.rotation.x = -Math.PI / 2;
    pond.position.set(0, 0.02, 0);
    this.mapRoot.add(pond);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.addPropBox(Math.cos(a) * 10.5, 0, Math.sin(a) * 10.5, 1.8, 1 + (i % 3) * 0.4, 1.6, 0x8f8264, a);
    }

    // palms (mast + frond disc)
    [[14, 6], [-14, -6], [7, -16], [-7, 16], [18, -12], [-18, 12]].forEach(([x, z]) => {
      this.addMast(x, z);
      const fronds = new THREE.Mesh(
        new THREE.ConeGeometry(1.9, 0.7, 7),
        new THREE.MeshLambertMaterial({ color: 0x5f7a3a })
      );
      fronds.position.set(x, 9.3, z);
      this.mapRoot.add(fronds);
    });

    // rock outcrops
    const rocks: [number, number, number][] = [
      [-24, -24, 3.2], [-21, -26, 2.4], [24, 24, 3.4], [21, 26, 2.2],
      [-30, 18, 2.6], [30, -18, 2.8], [10, 30, 2.2], [-10, -30, 2.4],
    ];
    rocks.forEach(([x, z, s]) => this.addPropBox(x, 0, z, s, s * 0.8, s, 0x93866a, x * 0.37));

    // dune ridges (low long boxes)
    this.addPropBox(-16, 0, 8, 12, 0.9, 2.4, 0xc4b384, 0.5);
    this.addPropBox(16, 0, -8, 12, 0.9, 2.4, 0xc4b384, 0.5);

    // camp: tents, sandbags, towers
    this.addTent(-28, -12, 0.8); this.addTent(28, 12, 0.8 + Math.PI);
    this.addTent(-12, 28, 0.2); this.addTent(12, -28, 0.2 + Math.PI);
    this.addWatchtower(-26, 26); this.addWatchtower(26, -26);
    this.addSandbags(8, 22, 4.5, 0); this.addSandbags(-8, -22, 4.5, 0);
    this.addSandbags(22, -8, 4.5, Math.PI / 2); this.addSandbags(-22, 8, 4.5, Math.PI / 2);
    const bs: [number, number][] = [[4, -26], [-4, 26], [26, 4], [-26, -4]];
    bs.forEach(([x, z], i) => this.addBarrel(x, z, i % 2 ? 0x8a4a2e : 0x5f6b45));
    this.addBarrier(14, 14, 0.7); this.addBarrier(-14, -14, 0.7);
    this.addBox(-20, 0, 0, 1.2, H - 1, 14, { color: 0x9b8c66, glow: 0x8a7a54 });
    this.addBox(20, 0, 0, 1.2, H - 1, 14, { color: 0x9b8c66, glow: 0x8a7a54 });

    this.spawnPoints = [
      new THREE.Vector3(-35, 0, -35), new THREE.Vector3(35, 0, -35),
      new THREE.Vector3(-35, 0, 35), new THREE.Vector3(35, 0, 35),
      new THREE.Vector3(0, 0, -35), new THREE.Vector3(0, 0, 35),
      new THREE.Vector3(-35, 0, 0), new THREE.Vector3(35, 0, 0),
    ];
    this.patrolPoints = [
      new THREE.Vector3(0, 0, -16), new THREE.Vector3(0, 0, 16), new THREE.Vector3(-16, 0, 0),
      new THREE.Vector3(16, 0, 0), new THREE.Vector3(-22, 0, -22), new THREE.Vector3(22, 0, 22),
      new THREE.Vector3(-22, 0, 22), new THREE.Vector3(22, 0, -22), new THREE.Vector3(0, 0, -30),
      new THREE.Vector3(0, 0, 30), new THREE.Vector3(-30, 0, 0), new THREE.Vector3(30, 0, 0),
      new THREE.Vector3(14, 0, -20), new THREE.Vector3(-14, 0, 20),
    ];
    this.genLoot(26);
  }

  // ================= MAP 4: WARZONE (Battle Royale, 170x170) =================
  private buildWarzone() {
    this.arenaSize = CFG.brArena;
    this.setSky(0xcdbf98, 0.006);
    this.buildBase(CFG.brArena, 0xbfae7e, 0xa08f60, 0x8a7a54);
    const S = CFG.brArena, half = S / 2, H = 6;

    // --- central town: 3x3 building grid with streets ---
    for (let gx = -1; gx <= 1; gx++) {
      for (let gz = -1; gz <= 1; gz++) {
        if (gx === 0 && gz === 0) continue; // plaza stays open
        const bx = gx * 22, bz = gz * 22;
        const h = 5 + ((gx + 2) * (gz + 2)) % 4;
        this.addBox(bx, 0, bz, 13, h, 13, { color: 0xa3988a, glow: 0x6b6f74 });
        this.addPropBox(bx + (gx < 0 ? 8.5 : -8.5), 0, bz, 3.5, 2.2, 3.5, 0x8d8578);
      }
    }
    // plaza cover
    this.addBox(0, 0, 0, 12, 1.8, 12, { color: 0xb0a895, glow: COLORS.yellow });
    this.addBarrier(0, 10, 0); this.addBarrier(0, -10, 0);
    this.addBarrier(10, 0, Math.PI / 2); this.addBarrier(-10, 0, Math.PI / 2);
    this.addSandbags(-8, 8, 4, 0.8); this.addSandbags(8, -8, 4, 0.8);

    // --- four corner compounds ---
    const comp: [number, number][] = [[-62, -62], [62, -62], [-62, 62], [62, 62]];
    comp.forEach(([cx, cz], i) => {
      this.addWatchtower(cx, cz);
      this.addTent(cx + 7 * (i % 2 ? -1 : 1), cz + 6, i * 0.4);
      this.addTent(cx - 6, cz + (i < 2 ? 8 : -8) * (i % 3 ? 1 : -1), i * 0.9);
      this.addSandbags(cx, cz + 10, 5, 0);
      this.addSandbags(cx + 10, cz, 5, Math.PI / 2);
      this.addPropBox(cx + (i % 2 ? -12 : 12), 0, cz - 8, 2.2, 2.2, 2.2, 0x6e6a5e);
      this.addBarrel(cx - 8, cz + (i % 2 ? 10 : -10), i % 2 ? 0x8a4a2e : 0x5f6b45);
      this.addBarrel(cx - 6.8, cz + (i % 2 ? 10.8 : -10.8), 0x5f6b45);
    });

    // --- mid-side warehouse rows ---
    [[0, -62], [0, 62], [-62, 0], [62, 0]].forEach(([wx, wz], i) => {
      const long = i < 2;
      this.addBox(wx, 0, wz, long ? 20 : 8, 5.5, long ? 8 : 20, { color: 0x98876a, glow: 0x6e5b40 });
      this.addPropBox(wx + (long ? 13 : 0), 0, wz + (long ? 0 : 13), 2.6, 2.6, 2.6, 0x6e6a5e);
      this.addBarrier(wx + (long ? -13 : 7), wz + (long ? 7 : -13), long ? 0 : Math.PI / 2);
    });

    // --- scattered cover fields (rocks, crates, barrels) ---
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      const r = 40 + (i % 5) * 12;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) > half - 6 || Math.abs(z) > half - 6) continue;
      if (i % 3 === 0) this.addPropBox(x, 0, z, 2.8, 2.2, 2.8, 0x93866a, a);
      else if (i % 3 === 1) { this.addBox(x, 0, z, 2, 2, 2, { glow: COLORS.cyan }); this.addBox(x + 2.1, 0, z, 1.6, 1.6, 1.6, { glow: COLORS.cyan }); }
      else { this.addBarrel(x, z, 0x5f6b45); this.addBarrel(x + 1.2, z + 0.5, 0x8a4a2e); }
    }

    // --- long walls for lane cover ---
    this.addBox(-34, 0, 34, 1.2, H, 16, { color: 0x9b8c66, glow: 0x8a7a54 });
    this.addBox(34, 0, -34, 1.2, H, 16, { color: 0x9b8c66, glow: 0x8a7a54 });
    this.addBox(-34, 0, -34, 16, H, 1.2, { color: 0x9b8c66, glow: 0x8a7a54 });
    this.addBox(34, 0, 34, 16, H, 1.2, { color: 0x9b8c66, glow: 0x8a7a54 });
    this.addMast(0, 40); this.addMast(0, -40); this.addMast(40, 0); this.addMast(-40, 0);

    // spawns spread wide (kept inside the walls: outer ring at half of the half-size)
    this.spawnPoints = [];
    const sr = half / 2 - 7; // ≈35.5 on the 170-map — max offset ±71, safely inside ±84
    for (let gx = -2; gx <= 2; gx++) {
      for (let gz = -2; gz <= 2; gz++) {
        if (gx === 0 && gz === 0) continue;
        this.spawnPoints.push(new THREE.Vector3(gx * sr, 0, gz * sr));
      }
    }
    // patrol waypoints
    this.patrolPoints = [];
    for (let gx = -2; gx <= 2; gx++) {
      for (let gz = -2; gz <= 2; gz++) {
        this.patrolPoints.push(new THREE.Vector3(gx * 28, 0, gz * 28));
      }
    }
    this.patrolPoints.push(new THREE.Vector3(0, 1.8, 0));
    this.genLoot(CFG.brLootCount);
  }

  /** scatter loot anchor points across open ground (BR) */
  private genLoot(n: number) {
    const half = this.arenaSize / 2 - 5;
    let tries = 0;
    while (this.lootSpots.length < n && tries < n * 30) {
      tries++;
      const p = new THREE.Vector3((Math.random() * 2 - 1) * half, 0, (Math.random() * 2 - 1) * half);
      // reject if inside a collider footprint
      let blocked = false;
      for (const b of this.colliders) {
        if (p.x > b.min.x - 1 && p.x < b.max.x + 1 && p.z > b.min.z - 1 && p.z < b.max.z + 1 && b.min.y < 1.2) { blocked = true; break; }
      }
      if (blocked) continue;
      let tooClose = false;
      for (const q of this.lootSpots) if (p.distanceTo(q) < 4) { tooClose = true; break; }
      if (tooClose) continue;
      this.lootSpots.push(p);
    }
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
    const lim = this.arenaSize / 2 - radius - 0.4;
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
