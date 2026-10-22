import * as THREE from 'three';
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
  readonly metal = new THREE.MeshStandardMaterial({
    color: 0x1a1d24,
    metalness: 0.92,
    roughness: 0.22,
  });
  readonly polymer = new THREE.MeshStandardMaterial({
    color: 0x2b303c,
    metalness: 0.15,
    roughness: 0.75,
  });
  readonly neon = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    emissive: 0x00f0ff,
    emissiveIntensity: 2.5,
  });
  readonly grip = new THREE.MeshStandardMaterial({ color: 0x11151c, roughness: 0.95 });
  readonly brass = new THREE.MeshStandardMaterial({
    color: 0xc6a569,
    metalness: 0.85,
    roughness: 0.3,
  });
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
          i % 2 ? this.neon : this.grip,
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
      return { root, magazine, bolt, drum, muzzle, lens: null };
    }
    this.mesh(
      root,
      this.rounded(revolver ? 0.09 : 0.12, revolver ? 0.12 : 0.16, revolver ? 0.2 : 0.34),
      this.polymer,
      0,
      0,
      0,
    );
    const barrel = this.mesh(
      root,
      new THREE.CylinderGeometry(0.024, 0.028, barrelLength, 12),
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
    bolt.position.set(0.07, 0.03, 0.01);
    this.mesh(bolt, this.rounded(0.018, 0.025, 0.13), this.metal, 0, 0, 0);
    this.mesh(bolt, new THREE.SphereGeometry(0.018, 8, 6), this.grip, 0.035, 0, 0.02);
    if (!revolver) {
      this.mesh(root, this.rounded(0.055, 0.045, 0.21), this.metal, 0, 0, 0.26);
      this.mesh(root, this.rounded(0.09, 0.18, 0.055), this.polymer, 0, -0.035, 0.38);
      for (let i = 0; i < 5; i++)
        this.mesh(root, this.rounded(0.13, 0.012, 0.026), this.metal, 0, 0.098, -0.13 + i * 0.055);
    }
    this.mesh(root, this.rounded(0.014, 0.025, 0.12), this.neon, 0.063, 0.045, -0.02);
    this.mesh(root, this.rounded(0.014, 0.012, 0.065), this.neon, -0.063, -0.025, 0.06);
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
    return { root, magazine, bolt, drum, muzzle, lens };
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
    leftArm.position.set(-0.33, 1.34, 0);
    rightArm.position.set(0.33, 1.34, 0);
    leftLeg.position.set(-0.13, 0.8, 0);
    rightLeg.position.set(0.13, 0.8, 0);
    const armor = new THREE.MeshStandardMaterial({
      color: team === 0 ? 0xb5d4dd : 0x9c8794,
      metalness: 0.65,
      roughness: 0.35,
    });
    this.mesh(head, new THREE.SphereGeometry(0.19, 16, 12), armor, 0, 0, 0).scale.set(
      1,
      1.08,
      0.95,
    );
    const visor = this.mesh(
      head,
      new THREE.SphereGeometry(0.174, 16, 8, 0, Math.PI * 2, Math.PI * 0.25, Math.PI * 0.45),
      team === 0
        ? this.neon
        : new THREE.MeshStandardMaterial({
            color: 0xff456b,
            emissive: 0xff2348,
            emissiveIntensity: 2,
          }),
      0,
      0.025,
      -0.035,
    );
    visor.scale.z = 1.08;
    this.mesh(chest, new THREE.CapsuleGeometry(0.225, 0.27, 6, 12), armor, 0, -0.02, 0).scale.z =
      0.7;
    this.mesh(root, new THREE.CapsuleGeometry(0.2, 0.12, 6, 12), this.grip, 0, 0.9, 0).scale.z =
      0.75;
    for (const arm of [leftArm, rightArm]) {
      this.mesh(arm, new THREE.CapsuleGeometry(0.085, 0.25, 4, 10), armor, 0, -0.16, 0);
      const forearm = this.mesh(
        arm,
        new THREE.CapsuleGeometry(0.075, 0.24, 4, 10),
        this.polymer,
        0,
        -0.29,
        -0.12,
      );
      forearm.rotation.x = -1;
      this.mesh(arm, new THREE.SphereGeometry(0.075, 8, 6), this.neon, 0, -0.3, -0.28);
    }
    for (const leg of [leftLeg, rightLeg]) {
      this.mesh(leg, new THREE.CapsuleGeometry(0.095, 0.28, 4, 10), armor, 0, -0.18, 0);
      this.mesh(leg, new THREE.CapsuleGeometry(0.08, 0.27, 4, 10), this.polymer, 0, -0.55, 0);
      this.mesh(leg, this.rounded(0.15, 0.09, 0.28), this.grip, 0, -0.76, -0.06);
    }
    const gun = this.create(WeaponId.Vanguard, false).root;
    gun.position.set(0.18, 1.22, -0.31);
    gun.scale.setScalar(0.7);
    root.add(gun);
    return { root, head, chest, leftArm, rightArm, leftLeg, rightLeg, weapon: gun, armor };
  }
  buildArena(arena: Arena): THREE.Group {
    const root = new THREE.Group(),
      desert = arena.name === 'sandstorm',
      white = new THREE.MeshStandardMaterial({
        color: desert ? 0xb8986c : 0xc5d4dc,
        metalness: desert ? 0.25 : 0.6,
        roughness: 0.48,
      }),
      floor = new THREE.MeshStandardMaterial({
        color: desert ? 0x77614c : 0x26333d,
        metalness: 0.45,
        roughness: 0.32,
      }),
      dark = new THREE.MeshStandardMaterial({
        color: desert ? 0x444349 : 0x172737,
        metalness: 0.7,
        roughness: 0.36,
      }),
      container = new THREE.MeshStandardMaterial({
        color: 0x936746,
        metalness: 0.65,
        roughness: 0.65,
      }),
      materials = [white, floor, dark, container];
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
        const mesh = this.mesh(
          root,
          this.rounded(X - x, Y - y, Z - z),
          material,
          (x + X) / 2,
          (y + Y) / 2,
          (z + Z) / 2,
        );
        if (Y - y > 0.5 && Y > 0) {
          const trim = this.mesh(
            root,
            this.rounded(X - x + 0.02, 0.035, Z - z + 0.02),
            this.neon,
            (x + X) / 2,
            Y + 0.02,
            (z + Z) / 2,
          );
          trim.castShadow = false;
          if (Y - y > 1.8) {
            for (let panel = 0; panel < Math.min(8, Math.floor((X - x) / 1.8)); panel++)
              this.mesh(
                root,
                this.rounded(0.035, Math.min(2, Y - y - 0.2), 0.025),
                dark,
                x + 0.5 + panel * 1.7,
                (y + Y) / 2,
                Z + 0.025,
              );
          }
        }
        mesh.receiveShadow = true;
      } else {
        const lo = kind === 2 ? Y : y,
          hi = kind === 2 ? y : Y,
          positions = new Float32Array([
            x,
            lo,
            z,
            x,
            hi,
            Z,
            X,
            hi,
            Z,
            x,
            lo,
            z,
            X,
            hi,
            Z,
            X,
            lo,
            z,
          ]),
          g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        g.computeVertexNormals();
        this.mesh(root, g, white, 0, 0, 0).material = new THREE.MeshStandardMaterial({
          color: desert ? 0x96754e : 0x708794,
          metalness: 0.6,
          roughness: 0.35,
          side: THREE.DoubleSide,
        });
        for (const edge of [x, X]) {
          const rail = this.mesh(
            root,
            new THREE.CylinderGeometry(0.04, 0.04, Math.hypot(Z - z, Y - y), 8),
            this.neon,
            edge,
            (y + Y) / 2 + 0.05,
            (z + Z) / 2,
          );
          rail.rotation.x = Math.atan2(Z - z, hi - lo);
        }
      }
    }
    for (let i = 0; i < arena.pads.records.length; i += 9) {
      const p = arena.pads.records,
        ring = this.mesh(
          root,
          new THREE.TorusGeometry(1.6, 0.09, 8, 48),
          this.neon,
          (p[i]! + p[i + 3]!) / 2,
          0.06,
          (p[i + 2]! + p[i + 5]!) / 2,
        );
      ring.rotation.x = Math.PI / 2;
      this.mesh(
        root,
        new THREE.CylinderGeometry(1.6, 1.8, 0.1, 32),
        dark,
        ring.position.x,
        0,
        ring.position.z,
      );
    }
    for (const side of [-1, 1])
      for (const z of [-28, 28]) {
        const tower = this.mesh(
          root,
          new THREE.CylinderGeometry(1.5, 2.2, 7, 16),
          dark,
          side * 39,
          3.5,
          z,
        );
        this.mesh(
          root,
          new THREE.TorusGeometry(1.52, 0.06, 8, 32),
          this.neon,
          tower.position.x,
          6,
          z,
        ).rotation.x = Math.PI / 2;
        const dish = this.mesh(
          root,
          new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.5),
          white,
          side * 39,
          7.3,
          z,
        );
        dish.rotation.z = side * 0.5;
      }
    if (desert) {
      for (let i = 0; i < 15; i++) {
        const dune = this.mesh(
          root,
          new THREE.SphereGeometry(8 + (i % 3), 12, 6),
          container,
          -55 + (i % 5) * 26,
          -3,
          ((i / 5) | 0) * 48 - 48,
        );
        dune.scale.y = 0.5;
      }
    }
    return root;
  }
}
