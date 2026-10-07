// NEON STRIKE 3D - first-person weapon viewmodel with recoil & sway
import * as THREE from 'three';

export class ViewModel {
  group = new THREE.Group();
  private camera: THREE.PerspectiveCamera;
  private recoil = 0;          // 0..1
  private swayX = 0;
  private swayY = 0;
  private bobT = 0;
  private muzzle = new THREE.Object3D();
  private basePos = new THREE.Vector3(0.34, -0.32, -0.62);

  constructor(camera: THREE.PerspectiveCamera) {
    this.camera = camera;
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x1b1f3a });
    const accentMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff });
    const darkMat = new THREE.MeshLambertMaterial({ color: 0x10122a });

    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.5), bodyMat);
    receiver.position.set(0, 0, -0.1);

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.34, 8), darkMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0.015, -0.48);

    const muzzleTip = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.07, 8), bodyMat);
    muzzleTip.rotation.x = Math.PI / 2;
    muzzleTip.position.set(0, 0.015, -0.62);

    const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), darkMat);
    mag.position.set(0, -0.12, -0.02);
    mag.rotation.x = 0.12;

    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.14, 0.07), bodyMat);
    grip.position.set(0, -0.11, 0.12);
    grip.rotation.x = -0.3;

    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.18), bodyMat);
    stock.position.set(0, -0.01, 0.22);

    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.12), accentMat);
    sight.position.set(0, 0.075, -0.18);

    const stripL = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.02, 0.3), accentMat);
    stripL.position.set(-0.048, 0.02, -0.12);
    const stripR = stripL.clone(); stripR.position.x = 0.048;

    this.muzzle.position.set(0, 0.015, -0.66);

    this.group.add(receiver, barrel, muzzleTip, mag, grip, stock, sight, stripL, stripR, this.muzzle);
    this.group.position.copy(this.basePos);
    this.group.rotation.y = -0.04;
    camera.add(this.group);
  }

  get muzzleWorld(): THREE.Vector3 {
    const v = new THREE.Vector3();
    this.muzzle.getWorldPosition(v);
    return v;
  }

  fire() { this.recoil = Math.min(1, this.recoil + 0.55); }

  update(dt: number, moving: boolean, pitch: number, yaw: number, reloading: boolean) {
    this.recoil = Math.max(0, this.recoil - dt * 6);
    if (moving) this.bobT += dt * 11;

    // weapon sway follows look deltas
    this.swayX += ((yaw - this.swayX) * 0 + 0) * dt; // placeholder no-op, kept simple
    const targetSwayY = THREE.MathUtils.clamp(pitch * -0.03, -0.05, 0.05);
    this.swayY += (targetSwayY - this.swayY) * dt * 8;

    const bobX = Math.sin(this.bobT) * (moving ? 0.012 : 0.003);
    const bobY = Math.abs(Math.cos(this.bobT)) * (moving ? 0.014 : 0.004);
    const kick = this.recoil * 0.09;
    const reloadDip = reloading ? 0.22 : 0;

    this.group.position.set(
      this.basePos.x + bobX,
      this.basePos.y + bobY - this.recoil * 0.02 - reloadDip + this.swayY,
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
