// DESERT STRIKE 3D - shared character avatar (bots & remote players)
// Uses the decimated soldier GLB when available; falls back to a simple
// military-blocky figure otherwise. Hit detection uses cheap invisible
// proxies so raycasts stay fast even with the detailed soldier model.
import * as THREE from 'three';
import { soldierTemplate } from './assets';

// military marker palette (team/ID colors that read well on desert terrain)
const MARKERS = [0xe08a2e, 0xb0432a, 0x7d8f4e, 0xd6b25e, 0x5f7a8a, 0x9a5a6e, 0x6b8ea4, 0x8a6d3b];

const HIT_MAT = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });

export function makeAvatar(color: number, name: string, withNameplate = true): { group: THREE.Group; hitMeshes: THREE.Mesh[] } {
  const group = new THREE.Group();
  group.scale.setScalar(1.72); // soldier template is height 1 -> game height ~1.7

  const template = soldierTemplate();
  let body: THREE.Object3D;

  if (template) {
    body = template.clone(true);
    const markerMat = new THREE.MeshBasicMaterial({ color });
    // team marker: vest patch (front) + shoulder patches — readable, never clips the face
    const patch = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.07, 0.02), markerMat);
    patch.position.set(0, 0.63, 0.115);
    const padL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.13), markerMat);
    padL.position.set(-0.185, 0.71, 0);
    const padR = padL.clone(); padR.position.x = 0.185;
    body.add(patch, padL, padR);
  } else {
    // fallback blocky soldier
    const root = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x4a4638 });
    const trimMat = new THREE.MeshBasicMaterial({ color });
    const legGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);
    const legL = new THREE.Mesh(legGeo, bodyMat); legL.position.set(-0.11, 0.25, 0);
    const legR = new THREE.Mesh(legGeo, bodyMat); legR.position.set(0.11, 0.25, 0);
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.26), bodyMat);
    torso.position.set(0, 0.78, 0);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.28), trimMat);
    chest.position.set(0, 0.95, 0);
    const armGeo = new THREE.BoxGeometry(0.12, 0.45, 0.12);
    const armL = new THREE.Mesh(armGeo, bodyMat); armL.position.set(-0.29, 0.8, 0);
    const armR = new THREE.Mesh(armGeo, bodyMat); armR.position.set(0.29, 0.8, 0);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), bodyMat);
    head.position.set(0, 1.22, 0);
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.05), trimMat);
    visor.position.set(0, 1.24, 0.15);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.42), new THREE.MeshLambertMaterial({ color: 0x2e2c24 }));
    gun.position.set(0.3, 0.72, 0.28);
    root.add(legL, legR, torso, chest, armL, armR, head, visor, gun);
    body = root;
  }
  group.add(body);
  group.userData.body = body;

  // --- invisible hit proxies (raycastable, not rendered) ---
  const hitMeshes: THREE.Mesh[] = [];
  const proxy = (w: number, h: number, d: number, x: number, y: number, z: number, head = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), HIT_MAT);
    m.position.set(x, y, z);
    if (head) { m.userData.head = true; }
    m.userData.entity = group;
    group.add(m);
    hitMeshes.push(m);
    return m;
  };
  proxy(0.13, 0.5, 0.15, -0.09, 0.25, 0);          // leg L
  proxy(0.13, 0.5, 0.15, 0.09, 0.25, 0);           // leg R
  proxy(0.36, 0.5, 0.22, 0, 0.62, 0);              // torso
  proxy(0.11, 0.42, 0.11, -0.22, 0.62, 0);         // arm L
  proxy(0.11, 0.42, 0.11, 0.22, 0.62, 0);          // arm R
  proxy(0.2, 0.22, 0.2, 0, 0.9, 0, true);          // head (headshot zone)

  if (withNameplate) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(28,24,16,0.78)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 60);
    ctx.font = 'bold 30px Rajdhani, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2ecd8';
    ctx.fillText(name.slice(0, 14), 128, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    plate.scale.set(1.5, 0.375, 1);
    plate.position.set(0, 1.08, 0); // local space (group scaled 1.72) -> ~1.86 world
    group.add(plate);
  }

  return { group, hitMeshes };
}

export function playerColor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return MARKERS[h % MARKERS.length];
}
