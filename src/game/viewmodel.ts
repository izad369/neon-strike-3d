// DESERT STRIKE 3D - first-person weapon viewmodel: 7 distinct gun shapes,
// recoil & sway, weapon-switch snap. Meshes are rebuilt from WeaponSpec dims.
import * as THREE from 'three';
import { WeaponSpec, WEAPONS } from './weapons';

export class ViewModel {
  group = new THREE.Group();
  private camera: THREE.PerspectiveCamera;
  private recoil = 0;          // 0..1
  private swayX = 0;
  private swayY = 0;
  private bobT = 0;
  private muzzle = new THREE.Object3D();
  private basePos = new THREE.Vector3(0.34, -0.32, -0.62);
  private spec: WeaponSpec = WEAPONS[3];
  private crouchDip = 0;

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    this.rebuild(this.spec);
    camera.add(this.group);
  }

  /** rebuild the gun mesh for a new weapon (called on switch) */
  setWeapon(spec: WeaponSpec) {
    if (spec.id === this.spec.id) return;
    this.spec = spec;
    this.rebuild(spec);
  }
  get weaponId(): string { return this.spec.id; }

  private rebuild(spec: WeaponSpec) {
    // clear previous meshes
    for (const c of [...this.group.children]) {
      this.group.remove(c);
      const m = c as THREE.Mesh;
      if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    }

    const gunmetal = spec.wood ? 0x4a3f2c : 0x39372e;
    const bodyMat = new THREE.MeshLambertMaterial({ color: gunmetal });
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x6b4f2e });
    const accentMat = new THREE.MeshBasicMaterial({ color: 0xd6b96a });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x26251f });
    const furniture = spec.wood ? woodMat : bodyMat;

    const bodyL = spec.bodyLen;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, bodyL), furniture);
    receiver.position.set(0, 0, -bodyL * 0.28);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(spec.barrelW, spec.barrelW, spec.barrelLen, 8), darkMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, -bodyL * 0.56 - spec.barrelLen * 0.5);

    const muzzleTip = new THREE.Mesh(new THREE.CylinderGeometry(spec.barrelW * 1.4, spec.barrelW * 1.4, 0.07, 8), furniture);
    muzzleTip.rotation.x = Math.PI / 2;
    muzzleTip.position.set(0, 0.015, -bodyL * 0.56 - spec.barrelLen - 0.02);

    const magH = spec.drum ? 0.2 : spec.id === 'pistol' ? 0.11 : 0.15;
    const mag = new THREE.Mesh(
      new THREE.BoxGeometry(spec.drum ? 0.12 : 0.06, magH, spec.drum ? 0.12 : 0.09),
      darkMat
    );
    mag.position.set(0, -0.06 - magH / 2, spec.drum ? -0.14 : -0.02);
    mag.rotation.x = spec.drum ? 0 : 0.12;

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), furniture);
    grip.position.set(0, -0.11, 0.05);
    grip.rotation.x = -0.3;

    const parts: THREE.Object3D[] = [receiver, barrel, muzzleTip, mag, grip];

    if (spec.stock) {
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.2), furniture);
      stock.position.set(0, -0.01, 0.14);
      parts.push(stock);
    }
    if (spec.scope) {
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.22, 10), darkMat);
      tube.rotation.x = Math.PI / 2;
      tube.position.set(0, 0.095, -0.16);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.026, 10), new THREE.MeshBasicMaterial({ color: 0x9fb8c8 }));
      lens.position.set(0, 0.095, -0.272);
      lens.rotation.y = Math.PI;
      parts.push(tube, lens);
    } else {
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.1), accentMat);
      sight.position.set(0, 0.075, -bodyL * 0.4);
      parts.push(sight);
    }
    if (spec.id === 'shotgun') {
      const pump = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.05, 0.14), furniture);
      pump.position.set(0, -0.045, -bodyL * 0.62);
      parts.push(pump);
    }
    if (spec.id === 'lmg') {
      const bipodL = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.012), darkMat);
      bipodL.position.set(-0.03, -0.06, -bodyL * 0.85);
      bipodL.rotation.z = 0.3;
      const bipodR = bipodL.clone(); bipodR.position.x = 0.03; bipodR.rotation.z = -0.3;
      parts.push(bipodL, bipodR);
    }

    const stripL = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.02, bodyL * 0.6), accentMat);
    stripL.position.set(-0.048, 0.02, -bodyL * 0.3);
    const stripR = stripL.clone(); stripR.position.x = 0.048;
    parts.push(stripL, stripR);

    const muzzleZ = -bodyL * 0.56 - spec.barrelLen - 0.06;
    this.muzzle.position.set(0, 0.015, muzzleZ);
    parts.push(this.muzzle);

    this.group.add(...parts);
    this.group.position.copy(this.basePos);
    this.group.rotation.y = -0.04;
  }

  get muzzleWorld(): THREE.Vector3 {
    const v = new THREE.Vector3();
    this.muzzle.getWorldPosition(v);
    return v;
  }

  fire() { this.recoil = Math.min(1, this.recoil + 0.5 * this.spec.recoil); }

  update(dt: number, moving: boolean, pitch: number, yaw: number, reloading: boolean, crouching = false) {
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (moving) this.bobT += dt * (crouching ? 7 : 11);

    // weapon sway follows look pitch
    const targetSwayY = THREE.MathUtils.clamp(pitch * -0.03, -0.05, 0.05);
    this.swayY += (targetSwayY - this.swayY) * dt * 8;

    const bobX = Math.sin(this.bobT) * (moving ? 0.012 : 0.003);
    const bobY = Math.abs(Math.cos(this.bobT)) * (moving ? 0.014 : 0.004);
    const kick = this.recoil * 0.09;
    const reloadDip = reloading ? 0.22 : 0;
    this.crouchDip += ((crouching ? 0.05 : 0) - this.crouchDip) * dt * 8;

    this.group.position.set(
      this.basePos.x + bobX,
      this.basePos.y + bobY - this.recoil * 0.02 - reloadDip + this.swayY - this.crouchDip,
      this.basePos.z + kick
    );
    this.group.rotation.x = this.recoil * 0.14 + (reloading ? 0.5 : 0);
    this.group.rotation.z = reloading ? 0.25 : 0;
  }

  setVisible(v: boolean) { this.group.visible = v; }

  dispose() {
    this.group.traverse(o => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
    });
    this.camera.remove(this.group);
  }
}
