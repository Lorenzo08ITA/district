import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
export type Surface =
  | 'siding'
  | 'steel'
  | 'polymer'
  | 'fabric'
  | 'stone'
  | 'plaster'
  | 'wood'
  | 'brick'
  | 'asphalt'
  | 'grass'
  | 'roof'
  | 'fence';
/** Small deterministic PBR textures; never generated in a render or physics loop. */
export class SurfaceLibrary {
  private maps = new Map<
    Surface,
    { color: THREE.DataTexture; normal: THREE.DataTexture; rough: THREE.DataTexture }
  >();
  material(
    kind: Surface,
    color: number,
    metalness = 0,
    roughness = 0.8,
  ): THREE.MeshStandardMaterial {
    let set = this.maps.get(kind);
    if (!set) {
      const size = 128,
        h = new Float32Array(size * size),
        rgb = new Uint8Array(size * size * 4),
        normal = new Uint8Array(rgb.length),
        rough = new Uint8Array(rgb.length);
      let seed = 92731;
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          seed ^= seed << 13;
          seed ^= seed >>> 17;
          seed ^= seed << 5;
          const noise = (seed >>> 0) / 4294967296,
            u = x / size,
            v = y / size;
          let value = 0.58 + noise * 0.22,
            alpha = 255;
          if (kind === 'siding') value = 0.72 + noise * 0.04 - ((v * 8) % 1 < 0.06 ? 0.16 : 0);
          if (kind === 'wood')
            value = 0.5 + Math.sin(u * 44 + Math.sin(v * 10) * 2) * 0.09 + noise * 0.12;
          if (kind === 'steel')
            value = 0.66 + noise * 0.08 + (y % 13 === 0 ? 0.09 : 0) - (x % 43 === 0 ? 0.15 : 0);
          if (kind === 'fabric') value = 0.5 + noise * 0.07 + (x % 4 < 2 !== y % 4 < 2 ? 0.15 : 0);
          if (kind === 'brick') {
            const row = Math.floor(v * 8),
              joint = (u * 4 + (row % 2) * 0.5) % 1;
            value = (v * 8) % 1 < 0.06 || joint < 0.035 ? 0.3 : 0.65 + noise * 0.16;
          }
          if (kind === 'plaster' || kind === 'stone')
            value = 0.55 + noise * 0.18 + Math.sin(u * 22) * Math.sin(v * 18) * 0.08;
          if (kind === 'asphalt') value = 0.38 + noise * 0.3 + (noise > 0.97 ? 0.2 : 0);
          if (kind === 'grass') value = 0.45 + noise * 0.35 + Math.sin((x + y) * 3) * 0.08;
          if (kind === 'roof')
            value = (v * 12) % 1 < 0.12 ? 0.3 : 0.6 + noise * 0.12 + Math.sin(u * 31.4) * 0.12;
          if (kind === 'fence') {
            const line = Math.min(
              Math.abs(((x + y) % 32) - 16),
              Math.abs(((x - y + 128) % 32) - 16),
            );
            alpha = line < 2 ? 255 : 0;
            value = 0.7;
          }
          const i = (y * size + x) * 4,
            t = Math.round(Math.max(0, Math.min(1, value)) * 255);
          h[y * size + x] = value;
          rgb[i] = rgb[i + 1] = rgb[i + 2] = t;
          rgb[i + 3] = alpha;
          rough[i] =
            rough[i + 1] =
            rough[i + 2] =
              kind === 'steel' ? 135 + Math.round(noise * 65) : 190 + Math.round(noise * 50);
          rough[i + 3] = 255;
        }
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const dx =
              (h[y * size + ((x + 1) % size)]! - h[y * size + ((x + size - 1) % size)]!) * 1.5,
            dy = (h[((y + 1) % size) * size + x]! - h[((y + size - 1) % size) * size + x]!) * 1.5,
            n = 1 / Math.hypot(dx, dy, 1),
            i = (y * size + x) * 4;
          normal[i] = Math.round((-dx * n * 0.5 + 0.5) * 255);
          normal[i + 1] = Math.round((-dy * n * 0.5 + 0.5) * 255);
          normal[i + 2] = Math.round((n * 0.5 + 0.5) * 255);
          normal[i + 3] = 255;
        }
      const texture = (data: Uint8Array) => {
        const t = new THREE.DataTexture(data, size, size);
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.magFilter = THREE.LinearFilter;
        t.minFilter = THREE.LinearMipmapLinearFilter;
        t.generateMipmaps = true;
        t.anisotropy = 4;
        t.needsUpdate = true;
        return t;
      };
      set = { color: texture(rgb), normal: texture(normal), rough: texture(rough) };
      set.color.colorSpace = THREE.SRGBColorSpace;
      this.maps.set(kind, set);
    }
    const material = new THREE.MeshStandardMaterial({
      color,
      metalness,
      roughness,
      map: set.color,
      normalMap: set.normal,
      roughnessMap: set.rough,
      normalScale: new THREE.Vector2(0.28, 0.28),
    });
    if (kind === 'fence') {
      material.alphaTest = 0.45;
      material.side = THREE.DoubleSide;
      material.metalness = 0.7;
    }
    return material;
  }
  dispose(): void {
    for (const maps of this.maps.values()) {
      maps.color.dispose();
      maps.normal.dispose();
      maps.rough.dispose();
    }
    this.maps.clear();
  }
}
/** Preserve animated child groups; consolidate only immutable sibling meshes. */
export function batchStaticMeshes(root: THREE.Group, recursive = true): void {
  if (recursive)
    for (const child of root.children)
      if (child instanceof THREE.Group) batchStaticMeshes(child, true);
  const groups = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of root.children) {
    if (
      !(child instanceof THREE.Mesh) ||
      child instanceof THREE.InstancedMesh ||
      Array.isArray(child.material)
    )
      continue;
    const list = groups.get(child.material) ?? [];
    list.push(child);
    groups.set(child.material, list);
  }
  for (const [material, meshes] of groups) {
    if (meshes.length < 2) continue;
    const geometries: THREE.BufferGeometry[] = [];
    let shadow = false;
    for (const mesh of meshes) {
      mesh.updateMatrix();
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      if (!geometry.getAttribute('uv'))
        geometry.setAttribute(
          'uv',
          new THREE.BufferAttribute(
            new Float32Array(geometry.getAttribute('position').count * 2),
            2,
          ),
        );
      geometry.applyMatrix4(mesh.matrix);
      geometries.push(geometry);
      shadow ||= mesh.castShadow;
    }
    const geometry = mergeGeometries(geometries, false);
    for (const temporary of geometries) temporary.dispose();
    if (!geometry) throw new Error('Incompatible static mesh attributes');
    const combined = new THREE.Mesh(geometry, material);
    combined.castShadow = shadow;
    combined.receiveShadow = true;
    for (const mesh of meshes) root.remove(mesh);
    root.add(combined);
  }
}
