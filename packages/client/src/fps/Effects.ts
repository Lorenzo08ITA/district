import * as THREE from 'three';
/** Fixed-capacity pools: no mesh, vector, matrix or object creation during rendering. */
export class BallisticEffects {
  readonly root = new THREE.Group();
  private tracers: THREE.InstancedMesh;
  private shells: THREE.InstancedMesh;
  private sparks: THREE.InstancedMesh;
  private decals: THREE.InstancedMesh;
  private tracer = new Float64Array(128 * 8);
  private shell = new Float64Array(96 * 10);
  private spark = new Float64Array(256 * 8);
  private decal = new Float64Array(96 * 9);
  private ti = 0;
  private si = 0;
  private pi = 0;
  private di = 0;
  private object = new THREE.Object3D();
  private direction = new THREE.Vector3();
  private origin = new THREE.Vector3();
  private end = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private rng = 12345;
  constructor() {
    this.tracers = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.016, 0.016, 1, 5),
      new THREE.MeshBasicMaterial({ color: 0xffda8d, transparent: true, opacity: 0.8 }),
      128,
    );
    this.shells = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.04, 6),
      new THREE.MeshStandardMaterial({ color: 0xc6a569, metalness: 0.85, roughness: 0.3 }),
      96,
    );
    this.sparks = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.018, 4, 3),
      new THREE.MeshBasicMaterial({ color: 0xffd66d }),
      256,
    );
    this.decals = new THREE.InstancedMesh(
      new THREE.CircleGeometry(0.045, 8),
      new THREE.MeshBasicMaterial({
        color: 0x0b1014,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
      96,
    );
    for (const mesh of [this.tracers, this.shells, this.sparks, this.decals]) {
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      this.root.add(mesh);
    }
    this.update(0, 1 / 60);
  }
  private random(): number {
    let n = this.rng;
    n ^= n << 13;
    n ^= n >>> 17;
    n ^= n << 5;
    this.rng = n >>> 0;
    return this.rng / 4294967296;
  }
  shot(ox: number, oy: number, oz: number, ex: number, ey: number, ez: number, time: number): void {
    const o = (this.ti++ % 128) * 8;
    this.tracer[o] = ox;
    this.tracer[o + 1] = oy;
    this.tracer[o + 2] = oz;
    this.tracer[o + 3] = ex;
    this.tracer[o + 4] = ey;
    this.tracer[o + 5] = ez;
    this.tracer[o + 6] = time;
    this.tracer[o + 7] = 1;
    for (let i = 0; i < 5; i++) {
      const p = (this.pi++ % 256) * 8;
      this.spark[p] = ex;
      this.spark[p + 1] = ey;
      this.spark[p + 2] = ez;
      this.spark[p + 3] = (this.random() - 0.5) * 4;
      this.spark[p + 4] = this.random() * 3;
      this.spark[p + 5] = (this.random() - 0.5) * 4;
      this.spark[p + 6] = time;
      this.spark[p + 7] = 1;
    }
  }
  casing(x: number, y: number, z: number, yaw: number, time: number): void {
    const o = (this.si++ % 96) * 10;
    this.shell[o] = x;
    this.shell[o + 1] = y;
    this.shell[o + 2] = z;
    this.shell[o + 3] = Math.cos(yaw) * 2 + (this.random() - 0.5);
    this.shell[o + 4] = 1.5 + this.random();
    this.shell[o + 5] = Math.sin(yaw) * 2;
    this.shell[o + 6] = time;
    this.shell[o + 7] = this.random() * 6;
    this.shell[o + 8] = this.random() * 8;
    this.shell[o + 9] = 1;
  }
  impact(x: number, y: number, z: number, nx: number, ny: number, nz: number, time: number): void {
    const o = (this.di++ % 96) * 9;
    this.decal[o] = x + nx * 0.004;
    this.decal[o + 1] = y + ny * 0.004;
    this.decal[o + 2] = z + nz * 0.004;
    this.decal[o + 3] = nx;
    this.decal[o + 4] = ny;
    this.decal[o + 5] = nz;
    this.decal[o + 6] = time;
    this.decal[o + 7] = 1;
  }
  update(time: number, dt: number): void {
    const object = this.object;
    for (let i = 0; i < 128; i++) {
      const o = i * 8,
        age = time - this.tracer[o + 6]!;
      object.position.set(0, -1000, 0);
      object.scale.setScalar(0);
      if (this.tracer[o + 7] && age < 0.11) {
        this.origin.set(this.tracer[o]!, this.tracer[o + 1]!, this.tracer[o + 2]!);
        this.end.set(this.tracer[o + 3]!, this.tracer[o + 4]!, this.tracer[o + 5]!);
        this.direction.subVectors(this.end, this.origin);
        const length = this.direction.length(),
          progress = Math.min(1, age / 0.07);
        object.position.copy(this.origin).addScaledVector(this.direction, progress);
        object.quaternion.setFromUnitVectors(this.up, this.direction.normalize());
        object.scale.set(1, Math.min(5, length) * (1 - age / 0.11), 1);
      }
      object.updateMatrix();
      this.tracers.setMatrixAt(i, object.matrix);
    }
    this.tracers.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 96; i++) {
      const o = i * 10,
        age = time - this.shell[o + 6]!;
      object.scale.setScalar(0);
      object.position.set(0, -1000, 0);
      if (this.shell[o + 9] && age < 2.2) {
        this.shell[o] = this.shell[o]! + this.shell[o + 3]! * dt;
        this.shell[o + 1] = this.shell[o + 1]! + this.shell[o + 4]! * dt;
        this.shell[o + 2] = this.shell[o + 2]! + this.shell[o + 5]! * dt;
        this.shell[o + 4] = this.shell[o + 4]! - 9.8 * dt;
        if (this.shell[o + 1]! < 0.025) {
          this.shell[o + 1] = 0.025;
          this.shell[o + 4] = Math.abs(this.shell[o + 4]!) * 0.3;
          this.shell[o + 3] = this.shell[o + 3]! * 0.75;
          this.shell[o + 5] = this.shell[o + 5]! * 0.75;
        }
        object.position.set(this.shell[o]!, this.shell[o + 1]!, this.shell[o + 2]!);
        object.rotation.set(age * this.shell[o + 7]!, age * this.shell[o + 8]!, age * 7);
        object.scale.setScalar(1);
      }
      object.updateMatrix();
      this.shells.setMatrixAt(i, object.matrix);
    }
    this.shells.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 256; i++) {
      const o = i * 8,
        age = time - this.spark[o + 6]!;
      object.scale.setScalar(0);
      object.position.set(0, -1000, 0);
      if (this.spark[o + 7] && age < 0.35) {
        this.spark[o] = this.spark[o]! + this.spark[o + 3]! * dt;
        this.spark[o + 1] = this.spark[o + 1]! + this.spark[o + 4]! * dt;
        this.spark[o + 2] = this.spark[o + 2]! + this.spark[o + 5]! * dt;
        this.spark[o + 4] = this.spark[o + 4]! - 8 * dt;
        if (this.spark[o + 1]! < 0.02) {
          this.spark[o + 1] = 0.02;
          this.spark[o + 4] = Math.abs(this.spark[o + 4]!) * 0.4;
        }
        object.position.set(this.spark[o]!, this.spark[o + 1]!, this.spark[o + 2]!);
        object.scale.setScalar(1 - age / 0.35);
      }
      object.updateMatrix();
      this.sparks.setMatrixAt(i, object.matrix);
    }
    this.sparks.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < 96; i++) {
      const o = i * 9,
        age = time - this.decal[o + 6]!;
      object.scale.setScalar(0);
      object.position.set(0, -1000, 0);
      if (this.decal[o + 7] && age < 20) {
        object.position.set(this.decal[o]!, this.decal[o + 1]!, this.decal[o + 2]!);
        this.direction.set(this.decal[o + 3]!, this.decal[o + 4]!, this.decal[o + 5]!);
        object.quaternion.setFromUnitVectors(this.end.set(0, 0, 1), this.direction);
        object.scale.setScalar(1);
      }
      object.updateMatrix();
      this.decals.setMatrixAt(i, object.matrix);
    }
    this.decals.instanceMatrix.needsUpdate = true;
  }
}
