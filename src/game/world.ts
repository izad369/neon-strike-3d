// NEON STRIKE 3D - scene, neon arena map, collision & raycast helpers
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
    this.scene.background = new THREE.Color(COLORS.dark);
    this.scene.fog = new THREE.FogExp2(COLORS.dark, 0.014);

    this.camera = new THREE.PerspectiveCamera(75, 1, 0.1, 300);
    this.renderer = new THREE.WebGLRenderer({ antialias: !mobile, powerPreference: 'high-performance' });
    // mobile GPUs: cap pixel ratio harder (fill-rate is the bottleneck on phones)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, mobile ? 1.4 : 1.75));
    container.appendChild(this.renderer.domElement);
    this.resize();

    this.buildLights();
    this.buildArena();
  }

  resize() {
    // visualViewport covers iOS toolbars/rotation better than window alone
    const vv = window.visualViewport;
    const w = Math.round(vv?.width ?? window.innerWidth);
    const h = Math.round(vv?.height ?? window.innerHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  private buildLights() {
    this.scene.add(new THREE.HemisphereLight(0x8899ff, 0x1a1030, 0.85));
    const dir = new THREE.DirectionalLight(0xbfd4ff, 0.7);
    dir.position.set(30, 50, 20);
    this.scene.add(dir);
    // neon accents
    const p1 = new THREE.PointLight(COLORS.cyan, 120, 60); p1.position.set(-22, 6, -22); this.scene.add(p1);
    const p2 = new THREE.PointLight(COLORS.magenta, 120, 60); p2.position.set(22, 6, 22); this.scene.add(p2);
    const p3 = new THREE.PointLight(COLORS.purple, 90, 50); p3.position.set(22, 6, -22); this.scene.add(p3);
    const p4 = new THREE.PointLight(COLORS.orange, 90, 50); p4.position.set(-22, 6, 22); this.scene.add(p4);
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
    // neon trim on top edge
    const glow = opts?.glow ?? COLORS.cyan;
    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.08, 0.1, d + 0.08),
      new THREE.MeshBasicMaterial({ color: glow })
    );
    trim.position.set(x, y + h + 0.02, z);
    this.scene.add(trim);
    return mesh;
  }

  private buildArena() {
    const A = CFG.arena, H = CFG.wallH, half = A / 2;
    const t = 1;

    // floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(A, A),
      new THREE.MeshLambertMaterial({ color: 0x0d1024 })
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    const grid = new THREE.GridHelper(A, 40, COLORS.floorGrid, 0x131a33);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.55;
    grid.position.y = 0.01;
    this.scene.add(grid);

    // ceiling glow bars (decor)
    for (let i = -3; i <= 3; i++) {
      const bar = new THREE.Mesh(
        new THREE.BoxGeometry(A - 8, 0.15, 0.5),
        new THREE.MeshBasicMaterial({ color: i % 2 ? COLORS.purple : COLORS.cyan })
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
