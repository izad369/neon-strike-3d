// DESERT STRIKE 3D - shared asset loading (soldier GLB avatar)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let template: THREE.Group | null = null;
let pending: Promise<THREE.Group | null> | null = null;

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Load the soldier model once and cache it as a normalized template
 * (height = 1, feet at y=0, centered on X/Z). Returns null when unavailable.
 * Standalone build embeds it as base64 on globalThis; the Next dev shell
 * serves it from /soldier.glb.
 */
export function loadSoldier(): Promise<THREE.Group | null> {
  if (template) return Promise.resolve(template);
  if (pending) return pending;
  pending = (async () => {
    try {
      const loader = new GLTFLoader();
      const b64 = (globalThis as unknown as { __NS_SOLDIER_GLB__?: string }).__NS_SOLDIER_GLB__;
      let buffer: ArrayBuffer;
      if (b64) {
        buffer = b64ToBuffer(b64);
      } else {
        const res = await fetch('soldier.glb', { cache: 'force-cache' });
        if (!res.ok) throw new Error('soldier.glb not available');
        buffer = await res.arrayBuffer();
      }
      const gltf = await loader.parseAsync(buffer, '');
      const root = new THREE.Group();
      const inner = gltf.scene instanceof THREE.Group ? gltf.scene : new THREE.Group().add(gltf.scene);
      // normalize: uniform scale so height = 1, feet on the ground, centered
      const box = new THREE.Box3().setFromObject(inner);
      const size = new THREE.Vector3();
      box.getSize(size);
      const s = 1 / Math.max(0.0001, size.y);
      inner.scale.setScalar(s);
      box.setFromObject(inner);
      const center = new THREE.Vector3();
      box.getCenter(center);
      inner.position.set(-center.x, -box.min.y, -center.z);
      root.add(inner);
      // embedded GLTF ships metallic=1 (looks black without an envmap) — make it field-ready
      root.traverse(o => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && (mat as Partial<THREE.MeshStandardMaterial>).metalness !== undefined) {
          mat.metalness = 0.12;
          mat.roughness = 0.78;
          mat.emissive = new THREE.Color(0x2e2a22); // lift the very dark camo texture
        }
        mesh.castShadow = false;
        mesh.receiveShadow = false;
        mesh.frustumCulled = true;
      });
      template = root;
      return root;
    } catch (err) {
      console.warn('[desert-strike] soldier model unavailable, using fallback avatar', err);
      return null;
    }
  })();
  return pending;
}

export function soldierTemplate(): THREE.Group | null {
  return template;
}
