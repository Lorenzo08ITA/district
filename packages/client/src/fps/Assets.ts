import * as THREE from 'three';
import { SurfaceLibrary, batchStaticMeshes } from './Surfaces.js';
import { WeaponId, type Arena } from '@district/rts-shared/fps';
export interface WeaponRig {
  root: THREE.Group;
  magazine: THREE.Object3D;
  bolt: THREE.Object3D;
  drum: THREE.Object3D;
  muzzle: THREE.Object3D;
  lens: THREE.ShaderMaterial | null;
}
export interface CharacterRig {
  root: THREE.Group;
  head: THREE.Group;
  chest: THREE.Group;
  leftArm: THREE.Group;
  rightArm: THREE.Group;
  leftLeg: THREE.Group;
  rightLeg: THREE.Group;
  weapon: THREE.Group;
  armor: THREE.MeshStandardMaterial;
}
const lensVertex = `varying vec2 uvLens;varying vec3 viewPosition;void main(){uvLens=uv;vec4 p=modelViewMatrix*vec4(position,1.);viewPosition=p.xyz;gl_Position=projectionMatrix*p;}`;
const lensFragment = `precision highp float;varying vec2 uvLens;varying vec3 viewPosition;uniform sampler2D scopeTexture;uniform float scoped;void main(){vec2 p=uvLens*2.-1.;if(length(p)>1.)discard;vec2 angular=viewPosition.xy/max(.01,-viewPosition.z);float dotLight=1.-smoothstep(.002,.004,length(angular));float ring=1.-smoothstep(.001,.002,abs(length(angular)-.018));vec3 glass=vec3(.02,.16,.18);if(scoped>.5){glass=texture2D(scopeTexture,uvLens).rgb;float crosshair=1.-smoothstep(.003,.006,min(abs(p.x),abs(p.y)));glass=mix(glass,vec3(.02),crosshair*.8);gl_FragColor=vec4(glass,1.);}else gl_FragColor=vec4(glass+vec3(2.8,.13,.03)*(dotLight+ring*.35),.36+dotLight*.64+ring*.3);}`;
export class ProceduralWeaponFactory {
  readonly surfaces = new SurfaceLibrary();
  readonly metal = this.surfaces.material('steel', 0x43494d, 0.88, 0.32);
  readonly polymer = this.surfaces.material('polymer', 0x333a3a, 0.05, 0.7);
  readonly grip = this.surfaces.material('fabric', 0x252825, 0, 0.95);
  readonly brass = this.surfaces.material('steel', 0xc49a52, 0.82, 0.3);
  readonly neon = new THREE.MeshStandardMaterial({
    color: 0x69bdd2,
    emissive: 0x34859a,
    emissiveIntensity: 1.3,
  });
  readonly cloth = this.surfaces.material('fabric', 0x4c5448, 0, 0.9);
  readonly skin = new THREE.MeshStandardMaterial({ color: 0x9d765a, roughness: 0.82 });
  readonly rubber = this.surfaces.material('polymer', 0x121515, 0, 0.98);
  private geometry = new Map<string, THREE.BufferGeometry>();
  rounded(w: number, h: number, d: number): THREE.BufferGeometry {
    const key = w + ':' + h + ':' + d;
    const old = this.geometry.get(key);
    if (old) return old;
    const shape = new THREE.Shape(),
      r = Math.min(w, h) * 0.17,
      x = -w / 2,
      y = -h / 2;
    shape.moveTo(x + r, y);
    shape.lineTo(x + w - r, y);
    shape.quadraticCurveTo(x + w, y, x + w, y + r);
    shape.lineTo(x + w, y + h - r);
    shape.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    shape.lineTo(x + r, y + h);
    shape.quadraticCurveTo(x, y + h, x, y + h - r);
    shape.lineTo(x, y + r);
    shape.quadraticCurveTo(x, y, x + r, y);
    const g = new THREE.ExtrudeGeometry(shape, {
      depth: d,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.004,
      bevelThickness: 0.004,
      curveSegments: 4,
    });
    g.translate(0, 0, -d / 2);
    this.geometry.set(key, g);
    return g;
  }
  private mesh(
    root: THREE.Object3D,
    g: THREE.BufferGeometry,
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  }
  create(id: WeaponId, viewmodel = true): WeaponRig {
    const root = new THREE.Group();
    root.name = 'Weapon ' + id;
    const long = id === WeaponId.Kraber,
      small = id === WeaponId.Vector,
      revolver = id === WeaponId.Sheriff,
      knife = id === WeaponId.Karambit,
      shotgun = id === WeaponId.Cerberus;
    const barrelLength = long ? 0.62 : small ? 0.27 : revolver ? 0.24 : shotgun ? 0.5 : 0.4;
    const magazine = new THREE.Group(),
      bolt = new THREE.Group(),
      drum = new THREE.Group(),
      muzzle = new THREE.Group();
    root.add(magazine, bolt, drum, muzzle);
    if (knife) {
      const blade = new THREE.Shape();
      blade.moveTo(-0.02, 0.04);
      blade.bezierCurveTo(-0.2, -0.06, -0.25, -0.26, -0.12, -0.33);
      blade.bezierCurveTo(-0.17, -0.17, -0.05, -0.12, 0.035, -0.04);
      blade.closePath();
      const g = new THREE.ExtrudeGeometry(blade, {
        depth: 0.012,
        bevelEnabled: true,
        bevelSize: 0.003,
        bevelThickness: 0.003,
        bevelSegments: 2,
        steps: 1,
      });
      const b = this.mesh(root, g, this.metal, 0, 0, -0.1);
      b.rotation.y = Math.PI / 2;
      for (let i = 0; i < 10; i++)
        this.mesh(
          root,
          this.rounded(0.035, 0.012, 0.025),
          i % 2 ? this.polymer : this.grip,
          0.0,
          -i * 0.013,
          0.03,
        );
      const ring = this.mesh(
        root,
        new THREE.TorusGeometry(0.045, 0.009, 8, 24),
        this.metal,
        0,
        0.06,
        0.04,
      );
      ring.rotation.y = Math.PI / 2;
      for (let i = 0; i < 6; i++) {
        const stud = this.mesh(
          root,
          new THREE.SphereGeometry(0.008, 6, 4),
          this.brass,
          Math.sin(i) * 0.025,
          -i * 0.017,
          0.045,
        );
        stud.scale.y = 0.6;
      }
      muzzle.position.set(0, -0.12, -0.32);
      batchStaticMeshes(root);
      return { root, magazine, bolt, drum, muzzle, lens: null };
    }
    const outline = long
      ? [
          [-0.16, 0.045],
          [0.16, 0.045],
          [0.16, -0.015],
          [0.09, -0.035],
          [-0.1, -0.06],
          [-0.16, -0.035],
        ]
      : small
        ? [
            [-0.12, 0.06],
            [0.13, 0.06],
            [0.14, -0.02],
            [0.04, -0.02],
            [0.04, -0.1],
            [-0.05, -0.1],
            [-0.05, -0.04],
            [-0.12, -0.04],
          ]
        : shotgun
          ? [
              [-0.16, 0.035],
              [0.14, 0.035],
              [0.14, -0.03],
              [0.05, -0.05],
              [-0.14, -0.06],
              [-0.16, -0.035],
            ]
          : revolver
            ? [
                [-0.1, 0.05],
                [0.06, 0.05],
                [0.1, 0.02],
                [0.065, -0.045],
                [-0.02, -0.07],
                [-0.08, -0.04],
              ]
            : [
                [-0.17, 0.045],
                [0.16, 0.045],
                [0.175, 0.015],
                [0.11, -0.035],
                [0.03, -0.035],
                [-0.01, -0.07],
                [-0.1, -0.07],
                [-0.115, -0.04],
                [-0.17, -0.035],
              ];
    const silhouette = new THREE.Shape();
    silhouette.moveTo(outline[0]![0]!, outline[0]![1]!);
    for (let i = 1; i < outline.length; i++) silhouette.lineTo(outline[i]![0]!, outline[i]![1]!);
    silhouette.closePath();
    const receiver = new THREE.ExtrudeGeometry(silhouette, {
      depth: revolver ? 0.075 : 0.085,
      steps: 1,
      bevelEnabled: true,
      bevelSize: 0.003,
      bevelThickness: 0.003,
      bevelSegments: 2,
    });
    receiver.translate(0, 0, -(revolver ? 0.075 : 0.085) / 2);
    receiver.rotateY(Math.PI / 2);
    this.mesh(root, receiver, this.metal, 0, 0, 0);
    const barrel = this.mesh(
      root,
      new THREE.CylinderGeometry(long ? 0.016 : 0.012, long ? 0.022 : 0.017, barrelLength, 24),
      this.metal,
      0,
      0.025,
      -0.17 - barrelLength / 2,
    );
    barrel.rotation.x = Math.PI / 2;
    for (let i = 0; i < (long ? 5 : 4); i++) {
      this.mesh(
        root,
        new THREE.TorusGeometry(0.03, 0.006, 6, 16),
        this.metal,
        0,
        0.025,
        -0.19 - (i * barrelLength) / 5,
      );
    }
    const profile = [
        new THREE.Vector2(0.027, 0),
        new THREE.Vector2(0.04, 0.01),
        new THREE.Vector2(0.04, 0.065),
        new THREE.Vector2(0.029, 0.08),
      ],
      brake = this.mesh(
        root,
        new THREE.LatheGeometry(profile, 16),
        this.metal,
        0,
        0.025,
        -0.2 - barrelLength,
      );
    brake.rotation.x = -Math.PI / 2;
    muzzle.position.set(0, 0.025, -0.29 - barrelLength);
    for (let i = 0; i < 4; i++)
      this.mesh(
        root,
        this.rounded(0.012, 0.018, 0.055),
        this.grip,
        Math.cos((i * Math.PI) / 2) * 0.043,
        0.025 + Math.sin((i * Math.PI) / 2) * 0.043,
        -0.23 - barrelLength,
      );
    const handle = this.mesh(root, this.rounded(0.075, 0.2, 0.11), this.grip, 0, -0.15, 0.085);
    handle.rotation.x = -0.2;
    const guard = this.mesh(
      root,
      new THREE.TorusGeometry(0.05, 0.008, 6, 16),
      this.metal,
      0,
      -0.105,
      0.04,
    );
    guard.scale.set(0.65, 1, 1);
    guard.rotation.y = Math.PI / 2;
    this.mesh(
      root,
      new THREE.CylinderGeometry(0.006, 0.006, 0.05, 6),
      this.brass,
      0,
      -0.11,
      0.045,
    ).rotation.x = 0.4;
    if (revolver) {
      const cylinder = this.mesh(
        drum,
        new THREE.CylinderGeometry(0.057, 0.057, 0.11, 12),
        this.metal,
        0,
        0.015,
        -0.035,
      );
      cylinder.rotation.x = Math.PI / 2;
      for (let i = 0; i < 6; i++)
        this.mesh(
          drum,
          new THREE.CylinderGeometry(0.012, 0.012, 0.07, 6),
          this.brass,
          Math.cos((i * Math.PI) / 3) * 0.038,
          0.015 + Math.sin((i * Math.PI) / 3) * 0.038,
          -0.035,
        ).rotation.x = Math.PI / 2;
    } else {
      magazine.position.set(0, -0.14, -0.045);
      const mag = this.mesh(
        magazine,
        this.rounded(0.065, shotgun ? 0.1 : 0.22, 0.11),
        this.metal,
        0,
        -0.05,
        0,
      );
      mag.rotation.x = 0.12;
      for (let i = 0; i < 4; i++)
        this.mesh(magazine, this.rounded(0.068, 0.007, 0.112), this.grip, 0, -i * 0.035, 0);
      if (shotgun) {
        const tube = this.mesh(
          root,
          new THREE.CylinderGeometry(0.025, 0.025, 0.42, 12),
          this.metal,
          0,
          -0.035,
          -0.37,
        );
        tube.rotation.x = Math.PI / 2;
      }
    }
    bolt.position.set(0.052, 0.03, 0.01);
    this.mesh(bolt, this.rounded(0.018, 0.025, 0.13), this.metal, 0, 0, 0);
    this.mesh(bolt, new THREE.SphereGeometry(0.018, 8, 6), this.grip, 0.035, 0, 0.02);
    if (!revolver) {
      this.mesh(root, this.rounded(0.075, 0.045, 0.26), this.metal, 0, 0.08, -0.015);
      this.mesh(root, this.rounded(0.045, 0.045, 0.055), this.metal, 0, 0.112, -0.045);
      this.mesh(root, this.rounded(0.055, 0.045, 0.21), this.metal, 0, 0, 0.26);
      this.mesh(root, this.rounded(0.09, 0.18, 0.055), this.polymer, 0, -0.035, 0.38);
      for (let i = 0; i < 5; i++)
        this.mesh(root, this.rounded(0.13, 0.012, 0.026), this.metal, 0, 0.098, -0.13 + i * 0.055);
    }
    this.mesh(root, this.rounded(0.014, 0.025, 0.12), this.metal, 0.063, 0.045, -0.02);
    this.mesh(root, this.rounded(0.014, 0.012, 0.065), this.metal, -0.063, -0.025, 0.06);
    let lens: THREE.ShaderMaterial | null = null;
    if (!revolver) {
      this.mesh(root, this.rounded(0.075, 0.03, 0.13), this.metal, 0, 0.125, -0.045);
      const optic = this.mesh(
        root,
        new THREE.TorusGeometry(long ? 0.07 : 0.06, long ? 0.019 : 0.012, 8, 24),
        this.metal,
        0,
        long ? 0.225 : 0.205,
        -0.04,
      );
      if (long) {
        const housing = this.mesh(
          root,
          new THREE.CylinderGeometry(0.075, 0.064, 0.24, 16, 1, true),
          this.metal,
          0,
          0.225,
          -0.08,
        );
        housing.rotation.x = Math.PI / 2;
        this.mesh(
          root,
          new THREE.CylinderGeometry(0.018, 0.018, 0.06, 8),
          this.metal,
          0,
          0.31,
          -0.08,
        );
      }
      lens = viewmodel
        ? new THREE.ShaderMaterial({
            vertexShader: lensVertex,
            fragmentShader: lensFragment,
            uniforms: { scopeTexture: { value: null }, scoped: { value: long ? 1 : 0 } },
            transparent: true,
            side: THREE.DoubleSide,
            depthWrite: false,
          })
        : null;
      this.mesh(
        root,
        new THREE.CircleGeometry(long ? 0.066 : 0.052, 32),
        lens ?? this.neon,
        0,
        long ? 0.225 : 0.205,
        long ? 0.045 : -0.027,
      );
      optic.castShadow = false;
    }
    this.detailWeapon(root, id, viewmodel);
    batchStaticMeshes(root);
    return { root, magazine, bolt, drum, muzzle, lens };
  }
  private detailWeapon(root: THREE.Group, id: WeaponId, full: boolean): void {
    const sniper = id === WeaponId.Kraber,
      smg = id === WeaponId.Vector,
      shotgun = id === WeaponId.Cerberus,
      revolver = id === WeaponId.Sheriff;
    // Machined handguards, barrel shrouds and stock silhouette distinguish the weapon families.
    if (!revolver) {
      const length = sniper ? 0.42 : smg ? 0.18 : shotgun ? 0.3 : 0.28;
      this.mesh(
        root,
        this.rounded(0.085, 0.095, length),
        this.polymer,
        0,
        0.005,
        -0.19 - length / 2,
      );
      for (let n = 0; n < (full ? 9 : 4); n++) {
        const z = -0.22 - (n * length) / (full ? 9 : 4);
        for (const side of [-1, 1]) {
          this.mesh(root, this.rounded(0.004, 0.028, 0.015), this.rubber, side * 0.045, 0.025, z);
          if (full)
            this.mesh(root, this.rounded(0.004, 0.008, 0.012), this.metal, side * 0.048, -0.022, z);
        }
      }
      if (sniper) {
        for (const side of [-1, 1]) {
          const leg = this.mesh(
            root,
            new THREE.CylinderGeometry(0.009, 0.011, 0.27, 8),
            this.metal,
            side * 0.065,
            -0.14,
            -0.57,
          );
          leg.rotation.z = side * 0.22;
        }
        this.mesh(root, this.rounded(0.12, 0.055, 0.2), this.grip, 0, 0.08, 0.22);
      } else if (smg) {
        this.mesh(root, this.rounded(0.07, 0.14, 0.1), this.polymer, 0, -0.105, -0.2);
        this.mesh(root, this.rounded(0.035, 0.075, 0.19), this.metal, 0, -0.015, 0.23);
      } else if (shotgun) {
        const pump = this.mesh(
          root,
          new THREE.CylinderGeometry(0.045, 0.045, 0.2, 16),
          this.grip,
          0,
          -0.025,
          -0.39,
        );
        pump.rotation.x = Math.PI / 2;
        for (let n = 0; n < 7; n++)
          this.mesh(
            root,
            new THREE.TorusGeometry(0.046, 0.003, 5, 16),
            this.polymer,
            0,
            -0.025,
            -0.32 - n * 0.025,
          );
      }
    }
    this.mesh(root, this.rounded(0.006, 0.035, 0.085), this.rubber, 0.049, 0.016, -0.012);
    this.mesh(root, this.rounded(0.008, 0.014, 0.04), this.metal, -0.052, -0.022, 0.06).rotation.x =
      0.3;
    if (full) {
      for (const side of [-1, 1])
        for (const z of [-0.1, 0.09]) {
          const pin = this.mesh(
            root,
            new THREE.CylinderGeometry(0.005, 0.005, 0.004, 8),
            this.brass,
            side * 0.051,
            -0.02,
            z,
          );
          pin.rotation.z = Math.PI / 2;
        }
      for (let n = 0; n < 6; n++)
        this.mesh(root, this.rounded(0.045, 0.003, 0.006), this.rubber, 0, -0.07 - n * 0.02, 0.13);
    }
  }
  createCharacter(team: number): CharacterRig {
    const root = new THREE.Group(),
      head = new THREE.Group(),
      chest = new THREE.Group(),
      leftArm = new THREE.Group(),
      rightArm = new THREE.Group(),
      leftLeg = new THREE.Group(),
      rightLeg = new THREE.Group();
    root.add(head, chest, leftArm, rightArm, leftLeg, rightLeg);
    head.position.y = 1.63;
    chest.position.y = 1.24;
    leftArm.position.set(-0.3, 1.37, 0);
    rightArm.position.set(0.3, 1.37, 0);
    leftLeg.position.set(-0.12, 0.8, 0);
    rightLeg.position.set(0.12, 0.8, 0);
    const armor = this.surfaces.material('fabric', team ? 0x82715c : 0x4c625d, 0, 0.86),
      patch = new THREE.MeshStandardMaterial({
        color: team ? 0xa94436 : 0x437f98,
        roughness: 0.85,
      });
    this.mesh(head, new THREE.SphereGeometry(0.147, 20, 14), this.skin, 0, -0.01, -0.012).scale.set(
      1,
      1.16,
      0.94,
    );
    const helmet = this.mesh(
      head,
      new THREE.SphereGeometry(0.166, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.63),
      armor,
      0,
      0.055,
      0.005,
    );
    helmet.scale.z = 1.06;
    this.mesh(head, this.rounded(0.26, 0.012, 0.2), armor, 0, 0.075, -0.055);
    this.mesh(head, this.rounded(0.245, 0.05, 0.04), this.rubber, 0, 0.003, -0.148);
    this.mesh(head, this.rounded(0.22, 0.034, 0.007), this.metal, 0, 0.006, -0.172);
    this.mesh(
      head,
      new THREE.CapsuleGeometry(0.109, 0.075, 5, 12),
      this.grip,
      0,
      -0.082,
      -0.035,
    ).scale.z = 0.8;
    this.mesh(root, new THREE.CylinderGeometry(0.06, 0.07, 0.11, 12), this.skin, 0, 1.48, 0);
    this.mesh(
      chest,
      new THREE.CapsuleGeometry(0.22, 0.27, 6, 14),
      this.cloth,
      0,
      -0.01,
      0,
    ).scale.z = 0.67;
    this.mesh(chest, this.rounded(0.41, 0.38, 0.095), armor, 0, -0.025, -0.14);
    this.mesh(chest, this.rounded(0.35, 0.35, 0.085), armor, 0, -0.025, 0.14);
    for (const x of [-0.13, 0, 0.13]) {
      this.mesh(chest, this.rounded(0.105, 0.17, 0.06), armor, x, -0.075, -0.205);
      this.mesh(chest, this.rounded(0.085, 0.012, 0.065), this.grip, x, 0.01, -0.208);
    }
    for (const x of [-0.16, 0.16])
      this.mesh(chest, this.rounded(0.045, 0.12, 0.18), armor, x, 0.19, 0);
    this.mesh(chest, this.rounded(0.2, 0.06, 0.012), patch, 0, 0.115, -0.192);
    this.mesh(root, new THREE.CapsuleGeometry(0.18, 0.1, 6, 12), this.cloth, 0, 0.89, 0).scale.z =
      0.72;
    this.mesh(root, this.rounded(0.38, 0.04, 0.24), this.grip, 0, 0.89, 0);
    for (const arm of [leftArm, rightArm]) {
      this.mesh(arm, new THREE.CapsuleGeometry(0.075, 0.22, 5, 12), this.cloth, 0, -0.15, 0);
      this.mesh(arm, new THREE.SphereGeometry(0.08, 12, 8), armor, 0, -0.045, 0);
      const forearm = this.mesh(
        arm,
        new THREE.CapsuleGeometry(0.063, 0.19, 5, 12),
        this.cloth,
        0,
        -0.32,
        -0.105,
      );
      forearm.rotation.x = -0.9;
      this.mesh(arm, new THREE.SphereGeometry(0.065, 12, 8), this.grip, 0, -0.36, -0.23).scale.set(
        0.8,
        1,
        1.15,
      );
      this.mesh(arm, this.rounded(0.09, 0.055, 0.015), patch, 0, -0.06, -0.08);
    }
    for (const leg of [leftLeg, rightLeg]) {
      this.mesh(leg, new THREE.CapsuleGeometry(0.09, 0.26, 5, 12), this.cloth, 0, -0.16, 0);
      this.mesh(leg, new THREE.CapsuleGeometry(0.073, 0.25, 5, 12), this.cloth, 0, -0.53, 0);
      this.mesh(leg, this.rounded(0.12, 0.12, 0.055), armor, 0, -0.36, -0.066);
      this.mesh(leg, this.rounded(0.14, 0.12, 0.24), this.grip, 0, -0.73, -0.045);
      this.mesh(leg, this.rounded(0.145, 0.035, 0.25), this.rubber, 0, -0.795, -0.045);
    }
    batchStaticMeshes(root);
    const gun = this.create(WeaponId.Vanguard, false).root;
    gun.position.set(0.18, 1.22, -0.31);
    gun.scale.setScalar(0.7);
    root.add(gun);
    return { root, head, chest, leftArm, rightArm, leftLeg, rightLeg, weapon: gun, armor };
  }
  buildArena(arena: Arena): THREE.Group {
    const root = new THREE.Group(),
      desert = arena.name === 'sandstorm',
      town = arena.name === 'cedar' || arena.name === 'bastion',
      cedar = arena.name === 'cedar',
      coast = arena.name === 'bastion';
    const materials = [
      this.surfaces.material('stone', desert ? 0xb89d77 : 0xb3b9b5, 0, 0.8),
      this.surfaces.material(
        cedar ? 'grass' : coast ? 'stone' : 'asphalt',
        cedar ? 0x718057 : coast ? 0xb4a28a : desert ? 0x8c775e : 0x42494b,
        0,
        0.9,
      ),
      this.surfaces.material('steel', 0x414b4f, 0.65, 0.55),
      this.surfaces.material('steel', 0x826a52, 0.4, 0.65),
      this.surfaces.material('plaster', 0xd6b78c),
      this.surfaces.material('siding', 0x6c98a7),
      this.surfaces.material('roof', cedar ? 0x7d5f52 : 0xb17051),
      this.surfaces.material('brick', 0x8a8071),
      this.surfaces.material('fence', 0x9d9f92),
      this.surfaces.material('steel', 0xd9a647, 0.45, 0.5),
      this.surfaces.material('siding', 0xbba37e),
      this.surfaces.material('wood', 0x7e654d),
      this.surfaces.material('steel', 0x294044, 0.8, 0.15),
      this.surfaces.material('asphalt', 0x5b6060),
    ];
    materials[6]!.side = THREE.DoubleSide;
    const records = arena.surfaces;
    for (let i = 0; i < records.length; i += 8) {
      const x = records[i]!,
        y = records[i + 1]!,
        z = records[i + 2]!,
        X = records[i + 3]!,
        Y = records[i + 4]!,
        Z = records[i + 5]!,
        kind = records[i + 6]!,
        material = materials[records[i + 7]!]!;
      if (kind === 0) {
        this.mesh(
          root,
          this.rounded(X - x, Y - y, Z - z),
          material,
          (x + X) / 2,
          (y + Y) / 2,
          (z + Z) / 2,
        );
        if (!town && arena.name === 'nexus' && Y - y > 0.8 && Y > 0)
          this.mesh(
            root,
            this.rounded(X - x + 0.01, 0.018, Z - z + 0.01),
            this.neon,
            (x + X) / 2,
            Y + 0.01,
            (z + Z) / 2,
          );
      } else {
        const lo = kind === 2 ? Y : y,
          hi = kind === 2 ? y : Y,
          g = new THREE.BufferGeometry();
        g.setAttribute(
          'position',
          new THREE.Float32BufferAttribute(
            [x, lo, z, x, hi, Z, X, hi, Z, x, lo, z, X, hi, Z, X, lo, z],
            3,
          ),
        );
        g.setAttribute(
          'uv',
          new THREE.Float32BufferAttribute([x, z, x, Z, X, Z, x, z, X, Z, X, z], 2),
        );
        g.computeVertexNormals();
        this.mesh(root, g, town && y > 5 ? materials[6]! : materials[0]!, 0, 0, 0);
      }
    }
    if (town) {
      for (const cx of [-24, 24]) {
        const framing = cedar ? materials[10]! : materials[7]!;
        for (const wallZ of [-8.05, 8.05])
          for (const level of [0, 3.2])
            for (const side of [-1, 1]) {
              const center = cx + side * 4.8;
              this.mesh(root, this.rounded(3.3, 0.1, 0.42), framing, center, level + 1.1, wallZ);
              this.mesh(root, this.rounded(3.3, 0.12, 0.35), framing, center, level + 2.4, wallZ);
              for (const edge of [-1.6, 1.6])
                this.mesh(
                  root,
                  this.rounded(0.1, 1.3, 0.35),
                  framing,
                  center + edge,
                  level + 1.75,
                  wallZ,
                );
            }
        for (const x of [cx - 6.8, cx + 6.8])
          this.mesh(root, new THREE.CylinderGeometry(0.06, 0.06, 3, 10), this.metal, x, 1.5, 10.7);
        this.mesh(root, this.rounded(13.6, 0.07, 0.08), this.metal, cx, 4.2, 10.8);
        for (let n = 0; n < 18; n++)
          this.mesh(
            root,
            new THREE.CylinderGeometry(0.025, 0.025, 0.9, 6),
            this.metal,
            cx - 6.4 + n * 0.75,
            3.7,
            10.8,
          );
        // Interior partitions, floor-level skirting and roof fascia use the authored building footprint.
        for (const y of [0.2, 3.4, 6.15])
          for (const z of [-8.15, 8.15])
            this.mesh(root, this.rounded(14.4, 0.12, 0.13), framing, cx, y, z);
      }
      if (cedar) {
        const glass = materials[12]!;
        for (const x of [-2.61, 2.61]) {
          this.mesh(root, this.rounded(0.04, 0.85, 7.7), glass, x, 1.72, 0.5);
          for (let n = 0; n < 7; n++)
            this.mesh(
              root,
              this.rounded(0.065, 0.92, 0.045),
              materials[9]!,
              x,
              1.72,
              -3.05 + n * 1.14,
            );
          for (const z of [-2.7, 3.6]) {
            const tire = this.mesh(
              root,
              new THREE.CylinderGeometry(0.55, 0.55, 0.3, 20),
              this.rubber,
              x,
              0.55,
              z,
            );
            tire.rotation.z = Math.PI / 2;
            const hub = this.mesh(
              root,
              new THREE.CylinderGeometry(0.29, 0.29, 0.31, 16),
              this.metal,
              x,
              0.55,
              z,
            );
            hub.rotation.z = Math.PI / 2;
          }
          this.mesh(root, this.rounded(0.08, 0.07, 8.5), this.rubber, x, 0.96, 0.5);
        }
        for (const z of [-4.02, 5.02]) {
          this.mesh(root, this.rounded(4.4, 0.85, 0.04), glass, 0, 1.75, z);
          for (const x of [-1.8, 1.8])
            this.mesh(root, new THREE.SphereGeometry(0.13, 12, 8), this.brass, x, 0.85, z);
        }
        this.mesh(root, this.rounded(5.15, 0.16, 8.95), materials[9]!, 0, 2.67, 0.5);
        this.mesh(root, this.rounded(2.2, 0.5, 2.5), materials[12]!, 0, 1.3, -17.5);
        for (const x of [-1.24, 1.24])
          for (const z of [-19, -16])
            this.mesh(
              root,
              new THREE.CylinderGeometry(0.35, 0.35, 0.2, 16),
              this.rubber,
              x,
              0.35,
              z,
            ).rotation.z = Math.PI / 2;
        for (const x of [-5.8, 5.8])
          for (let z = -29; z < 30; z += 5)
            this.mesh(root, this.rounded(0.1, 0.012, 2.6), materials[10]!, x, 0.035, z);
      } else {
        for (const cx of [-12, 12])
          for (const z of [-19, 17]) {
            const canvas = new THREE.MeshStandardMaterial({
              color: cx < 0 ? 0x8a6249 : 0x8a9281,
              roughness: 0.95,
            });
            this.mesh(root, this.rounded(4.6, 0.06, 3), canvas, cx, 2.65, z);
            for (const dx of [-1.8, 1.8])
              this.mesh(
                root,
                new THREE.CylinderGeometry(0.035, 0.035, 2.5, 8),
                materials[11]!,
                cx + dx,
                1.25,
                z - 1.2,
              );
            for (let n = 0; n < 4; n++)
              this.mesh(
                root,
                new THREE.SphereGeometry(0.13, 8, 5),
                n % 2 ? this.brass : materials[10]!,
                cx - 1 + n * 0.65,
                1.25,
                z,
              );
          }
      }
    } else {
      for (let i = 0; i < arena.pads.records.length; i += 9) {
        const p = arena.pads.records,
          ring = this.mesh(
            root,
            new THREE.TorusGeometry(1.6, 0.06, 8, 32),
            this.neon,
            (p[i]! + p[i + 3]!) / 2,
            0.08,
            (p[i + 2]! + p[i + 5]!) / 2,
          );
        ring.rotation.x = Math.PI / 2;
        this.mesh(
          root,
          new THREE.CylinderGeometry(1.6, 1.8, 0.1, 24),
          materials[2]!,
          ring.position.x,
          0,
          ring.position.z,
        );
      }
      for (const side of [-1, 1])
        for (const z of [-28, 28]) {
          this.mesh(
            root,
            new THREE.CylinderGeometry(1.5, 2.2, 7, 16),
            materials[2]!,
            side * 39,
            3.5,
            z,
          );
          const dish = this.mesh(
            root,
            new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
            materials[0]!,
            side * 39,
            7.3,
            z,
          );
          dish.rotation.z = side * 0.5;
        }
    }
    batchStaticMeshes(root);
    return root;
  }
}
