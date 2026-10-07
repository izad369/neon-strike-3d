// NEON STRIKE 3D - visual effects: tracers, impact sparks, muzzle flash
import * as THREE from 'three';
import { COLORS } from './constants';

interface Tracer { mesh: THREE.Mesh; life: number; max: number }
interface Spark { points: THREE.Points; vels: THREE.Vector3[]; life: number; max: number }

export class Effects {
  private scene: THREE.Scene;
  private tracers: Tracer[] = [];
  private sparkList: Spark[] = [];
  private flashLight: THREE.PointLight;
  private flashTime = 0;
  private sparkGeo = new THREE.BufferGeometry();
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.flashLight = new THREE.PointLight(0xffe9a0, 0, 14);
    scene.add(this.flashLight);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color = 0xffe9a0) {
    const len = from.distanceTo(to);
    if (len < 0.2) return;
    const geo = new THREE.CylinderGeometry(0.012, 0.012, len, 4, 1, true);
    geo.translate(0, -len / 2, 0); // pivot at start, pointing down -Y
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), this.tmp.subVectors(to, from).normalize());
    this.scene.add(mesh);
    this.tracers.push({ mesh, life: 0.09, max: 0.09 });
  }

  sparks(at: THREE.Vector3, color = COLORS.yellow, count = 8) {
    const pos = new Float32Array(count * 3);
    const vels: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = at.x; pos[i * 3 + 1] = at.y; pos[i * 3 + 2] = at.z;
      vels.push(new THREE.Vector3((Math.random() - 0.5) * 5, Math.random() * 4 + 1, (Math.random() - 0.5) * 5));
    }
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color, size: 0.09, transparent: true, opacity: 1, depthWrite: false });
    const points = new THREE.Points(this.sparkGeo.clone(), mat);
    this.scene.add(points);
    this.sparkList.push({ points, vels, life: 0.4, max: 0.4 });
  }

  muzzleFlash(at: THREE.Vector3) {
    this.flashLight.position.copy(at);
    this.flashLight.intensity = 26;
    this.flashTime = 0.045;
  }

  update(dt: number) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      t.life -= dt;
      const mat = t.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, (t.life / t.max) * 0.85);
      if (t.life <= 0) {
        this.scene.remove(t.mesh);
        t.mesh.geometry.dispose(); mat.dispose();
        this.tracers.splice(i, 1);
      }
    }
    for (let i = this.sparkList.length - 1; i >= 0; i--) {
      const s = this.sparkList[i];
      s.life -= dt;
      const attr = s.points.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let j = 0; j < s.vels.length; j++) {
        s.vels[j].y -= 12 * dt;
        attr.setXYZ(j, attr.getX(j) + s.vels[j].x * dt, Math.max(0.02, attr.getY(j) + s.vels[j].y * dt), attr.getZ(j) + s.vels[j].z * dt);
      }
      attr.needsUpdate = true;
      (s.points.material as THREE.PointsMaterial).opacity = Math.max(0, s.life / s.max);
      if (s.life <= 0) {
        this.scene.remove(s.points);
        s.points.geometry.dispose(); (s.points.material as THREE.Material).dispose();
        this.sparkList.splice(i, 1);
      }
    }
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      this.flashLight.intensity = Math.max(0, (this.flashTime / 0.045) * 26);
    }
  }

  clear() {
    this.tracers.forEach(t => { this.scene.remove(t.mesh); t.mesh.geometry.dispose(); });
    this.tracers = [];
    this.sparkList.forEach(s => { this.scene.remove(s.points); s.points.geometry.dispose(); });
    this.sparkList = [];
    this.flashLight.intensity = 0;
  }
}
