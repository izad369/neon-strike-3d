// NEON STRIKE 3D - shared character avatar mesh (bots & remote players)
import * as THREE from 'three';

export function makeAvatar(color: number, name: string, withNameplate = true): { group: THREE.Group; hitMeshes: THREE.Mesh[] } {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0x14162e });
  const trimMat = new THREE.MeshBasicMaterial({ color });

  // legs
  const legGeo = new THREE.BoxGeometry(0.16, 0.5, 0.16);
  const legL = new THREE.Mesh(legGeo, bodyMat); legL.position.set(-0.11, 0.25, 0);
  const legR = new THREE.Mesh(legGeo, bodyMat); legR.position.set(0.11, 0.25, 0);
  // torso
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.26), bodyMat);
  torso.position.set(0, 0.78, 0);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.08, 0.28), trimMat);
  chest.position.set(0, 0.95, 0);
  // arms
  const armGeo = new THREE.BoxGeometry(0.12, 0.45, 0.12);
  const armL = new THREE.Mesh(armGeo, bodyMat); armL.position.set(-0.29, 0.8, 0);
  const armR = new THREE.Mesh(armGeo, bodyMat); armR.position.set(0.29, 0.8, 0);
  // head
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), bodyMat);
  head.position.set(0, 1.22, 0);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.05), trimMat);
  visor.position.set(0, 1.24, 0.15);
  head.userData.head = true; visor.userData.head = true;
  // gun prop
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.42), new THREE.MeshLambertMaterial({ color: 0x1b1f3a }));
  gun.position.set(0.3, 0.72, 0.28);

  group.add(legL, legR, torso, chest, armL, armR, head, visor, gun);

  const hitMeshes: THREE.Mesh[] = [legL, legR, torso, armL, armR, head, visor];
  hitMeshes.forEach(m => { m.userData.entity = group; });

  if (withNameplate) {
    const canvas = document.createElement('canvas');
    canvas.width = 256; canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgba(5,8,20,0.75)';
    ctx.fillRect(0, 0, 256, 64);
    ctx.strokeStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, 252, 60);
    ctx.font = 'bold 30px Rajdhani, Arial, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(name.slice(0, 14), 128, 34);
    const tex = new THREE.CanvasTexture(canvas);
    const plate = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    plate.scale.set(1.5, 0.375, 1);
    plate.position.set(0, 1.75, 0);
    group.add(plate);
  }

  return { group, hitMeshes };
}

export function playerColor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = (h % 360) / 360;
  return new THREE.Color().setHSL(hue, 1, 0.55).getHex();
}
