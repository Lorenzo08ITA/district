import * as THREE from 'three';
import type { SurfaceLibrary } from './Surfaces.js';
import type { ArenaName } from '@district/rts-shared/fps';
const vertex = `varying vec3 direction;void main(){direction=position;vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.);gl_Position=p.xyww;}`;
const fragment = `precision highp float;uniform sampler2D cloudNoise;varying vec3 direction;uniform float time;uniform float detail;uniform vec3 sun;uniform vec3 horizon;uniform vec3 zenith;float noise(vec2 p){return texture2D(cloudNoise,p/128.).r;}void main(){vec3 d=normalize(direction);float altitude=max(0.,d.y);vec3 color=mix(horizon,zenith,pow(altitude,.45));float s=max(0.,dot(d,sun));color+=vec3(1.,.63,.3)*pow(s,24.)*.45+vec3(4.,2.8,1.5)*smoothstep(.9995,.99985,s);vec2 p=d.xz/max(.16,d.y+.18)*2.4+vec2(time*.003,0.);float cloud=0.,amp=.55;for(int i=0;i<4;i++){if(float(i)>=detail)break;cloud+=noise(p)*amp;p=p*2.07+7.1;amp*=.5;}float cover=smoothstep(.4,.67,cloud)*(1.-smoothstep(.0,.08,-d.y));vec3 lit=mix(vec3(.33,.39,.46),vec3(1.1,.98,.8),smoothstep(.45,.8,cloud));color=mix(color,lit,cover*.85);color=mix(color,horizon,smoothstep(.1,-.2,d.y)*.55);gl_FragColor=vec4(color,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
export class WorldBackdrop {
  readonly root = new THREE.Group();
  private sky: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private water: THREE.ShaderMaterial | null = null;
  private leafTexture: THREE.DataTexture | null = null;
  private cloudNoise: THREE.DataTexture;
  readonly sun = new THREE.Vector3();
  readonly fog: THREE.Color;
  constructor(map: ArenaName, software: boolean, surfaces: SurfaceLibrary) {
    const coast = map === 'bastion',
      forest = map === 'cedar',
      desert = map === 'sandstorm';
    this.sun.set(coast ? -0.6 : -0.42, coast ? 0.3 : 0.5, -0.65).normalize();
    this.fog = new THREE.Color(coast ? 0xc7b4a0 : desert ? 0xc8b08c : 0x94afbf);
    const noiseBytes = new Uint8Array(128 * 128 * 4);
    let noiseSeed = 57231;
    for (let i = 0; i < noiseBytes.length; i += 4) {
      noiseSeed ^= noiseSeed << 13;
      noiseSeed ^= noiseSeed >>> 17;
      noiseSeed ^= noiseSeed << 5;
      noiseBytes[i] = noiseBytes[i + 1] = noiseBytes[i + 2] = (noiseSeed >>> 0) % 256;
      noiseBytes[i + 3] = 255;
    }
    this.cloudNoise = new THREE.DataTexture(noiseBytes, 128, 128);
    this.cloudNoise.wrapS = this.cloudNoise.wrapT = THREE.RepeatWrapping;
    this.cloudNoise.magFilter = this.cloudNoise.minFilter = THREE.LinearFilter;
    this.cloudNoise.needsUpdate = true;
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: {
        cloudNoise: { value: this.cloudNoise },
        time: { value: 0 },
        detail: { value: software ? 0 : 4 },
        sun: { value: this.sun },
        horizon: { value: this.fog },
        zenith: { value: new THREE.Color(coast ? 0x426e91 : desert ? 0x527d96 : 0x305a86) },
      },
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(490, 24, 12), this.material);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.root.add(this.sky);
    const positions: number[] = [],
      colors: number[] = [],
      uv: number[] = [],
      indices: number[] = [],
      segments = software ? 48 : 96,
      size = 800,
      c = new THREE.Color();
    function hash(x: number, z: number): number {
      let n = (Math.imul(x, 374761393) ^ Math.imul(z, 668265263)) | 0;
      n = Math.imul(n ^ (n >>> 13), 1274126177);
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    }
    function noise(x: number, z: number): number {
      const ix = Math.floor(x),
        iz = Math.floor(z),
        fx = x - ix,
        fz = z - iz,
        u = fx * fx * (3 - 2 * fx),
        v = fz * fz * (3 - 2 * fz);
      return (
        (hash(ix, iz) * (1 - u) + hash(ix + 1, iz) * u) * (1 - v) +
        (hash(ix, iz + 1) * (1 - u) + hash(ix + 1, iz + 1) * u) * v
      );
    }
    for (let row = 0; row <= segments; row++)
      for (let column = 0; column <= segments; column++) {
        const x = (column / segments - 0.5) * size,
          z = (row / segments - 0.5) * size,
          d = Math.hypot(x, z),
          rise = THREE.MathUtils.smoothstep(d, 75, 210),
          large = noise(x * 0.009 + 19, z * 0.009 - 7),
          ridge = Math.pow(1 - Math.abs(large * 2 - 1), 2),
          detail = noise(x * 0.045, z * 0.045) * 9 + noise(x * 0.11, z * 0.11) * 3,
          coastal = coast ? THREE.MathUtils.smoothstep(z + x * 0.3, -120, 120) : 1,
          height =
            -5 +
            rise * (12 + ridge * (forest ? 70 : desert ? 55 : 110) + large * 35 + detail) * coastal;
        positions.push(x, height, z);
        uv.push(x * 0.2, z * 0.2);
        const snow = !coast && !desert && height > 90;
        c.setHex(
          snow ? 0xc2c7c6 : forest ? 0x5c6a52 : desert ? 0xa88e6b : coast ? 0x7d806e : 0x7e8c8d,
        );
        c.multiplyScalar(0.75 + noise(x * 0.065, z * 0.065) * 0.28);
        colors.push(c.r, c.g, c.b);
      }
    for (let row = 0; row < segments; row++)
      for (let column = 0; column < segments; column++) {
        const a = row * (segments + 1) + column,
          b = a + segments + 1,
          x = (column / segments - 0.5) * size,
          z = (row / segments - 0.5) * size;
        if (Math.hypot(x, z) < 65) continue;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
    const mountain = new THREE.BufferGeometry();
    mountain.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    mountain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    mountain.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    mountain.setIndex(indices);
    mountain.computeVertexNormals();
    const mountainMaterial = new THREE.MeshLambertMaterial({ color: 0xd6dad6 });
    mountainMaterial.vertexColors = true;
    mountainMaterial.side = THREE.DoubleSide;
    this.root.add(new THREE.Mesh(mountain, mountainMaterial));
    if (coast) {
      this.water = new THREE.ShaderMaterial({
        uniforms: {
          time: { value: 0 },
          sun: { value: this.sun },
          eye: { value: new THREE.Vector3() },
        },
        vertexShader:
          'varying vec3 p;void main(){p=(modelMatrix*vec4(position,1.)).xyz;gl_Position=projectionMatrix*viewMatrix*vec4(p,1.);}',
        fragmentShader: `precision highp float;varying vec3 p;uniform float time;uniform vec3 sun;uniform vec3 eye;void main(){float a=sin(p.x*.18+time*.45),b=cos(p.z*.13+time*.37);vec3 n=normalize(vec3(a*.06,1.,b*.05));vec3 v=normalize(eye-p);float f=pow(1.-max(0.,dot(n,v)),3.);float shine=pow(max(0.,dot(reflect(-sun,n),v)),100.);vec3 color=mix(vec3(.035,.18,.22),vec3(.32,.49,.54),f);color+=vec3(1.3,.85,.4)*shine;gl_FragColor=vec4(color,1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`,
      });
      const sea = new THREE.Mesh(
        new THREE.PlaneGeometry(1200, 1200),
        software ? new THREE.MeshBasicMaterial({ color: 0x709eae }) : this.water,
      );
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = -4;
      this.root.add(sea);
    }
    const count = coast
      ? software
        ? 12
        : 18
      : forest
        ? software
          ? 24
          : 48
        : desert
          ? 0
          : software
            ? 16
            : 24;
    if (count) {
      const size = 128,
        pixels = new Uint8Array(size * size * 4),
        centers = new Float64Array(36 * 4);
      for (let n = 0; n < 36; n++) {
        centers[n * 4] = (hash(n, 8) - 0.5) * 0.72;
        centers[n * 4 + 1] = (hash(n, 13) - 0.5) * 0.72;
        centers[n * 4 + 2] = 0.045 + hash(n, 17) * 0.035;
        centers[n * 4 + 3] = 0.07 + hash(n, 20) * 0.04;
      }
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const u = x / size - 0.5,
            v = y / size - 0.5,
            o = (y * size + x) * 4;
          let alpha = 0;
          for (let n = 0; n < 36; n++) {
            const dx = (u - centers[n * 4]!) / centers[n * 4 + 2]!,
              dy = (v - centers[n * 4 + 1]!) / centers[n * 4 + 3]!;
            if (dx * dx + dy * dy < 1) {
              alpha = 255;
              break;
            }
          }
          const shade = 0.65 + hash(x, y) * 0.35;
          pixels[o] = Math.round(73 * shade);
          pixels[o + 1] = Math.round(108 * shade);
          pixels[o + 2] = Math.round(48 * shade);
          pixels[o + 3] = alpha;
        }
      this.leafTexture = new THREE.DataTexture(pixels, size, size);
      this.leafTexture.colorSpace = THREE.SRGBColorSpace;
      this.leafTexture.magFilter = THREE.LinearFilter;
      this.leafTexture.minFilter = THREE.LinearMipmapLinearFilter;
      this.leafTexture.generateMipmaps = true;
      this.leafTexture.needsUpdate = true;
      const branches = software ? 9 : 18,
        trunk = new THREE.InstancedMesh(
          new THREE.CylinderGeometry(0.15, 0.25, 1, 9),
          surfaces.material('wood', 0x6b5742),
          count,
        ),
        leaves = new THREE.InstancedMesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshStandardMaterial({
            map: this.leafTexture,
            alphaTest: 0.45,
            side: THREE.DoubleSide,
            roughness: 1,
          }),
          count * branches,
        ),
        transform = new THREE.Object3D();
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2,
          radius = 57 + (i % 7) * 5,
          x = Math.sin(angle) * radius,
          z = Math.cos(angle) * radius,
          height = 5 + (i % 4);
        transform.position.set(x, height / 2 - 1, z);
        transform.scale.set(1, height, 1);
        transform.rotation.set(0, angle, 0.03);
        transform.updateMatrix();
        trunk.setMatrixAt(i, transform.matrix);
        for (let branch = 0; branch < branches; branch++) {
          const a = (branch / branches) * Math.PI * 6 + angle;
          transform.position.set(
            x + Math.sin(a) * (branch % 3) * 0.65,
            height - 2 + (branch % 4) * 0.65,
            z + Math.cos(a) * (branch % 3) * 0.65,
          );
          transform.scale.set(2.2, 2.6, 1);
          transform.rotation.set(((branch % 3) - 1) * 0.5, a, ((branch % 2) - 0.5) * 0.6);
          transform.updateMatrix();
          leaves.setMatrixAt(i * branches + branch, transform.matrix);
        }
      }
      trunk.computeBoundingSphere();
      leaves.computeBoundingSphere();
      this.root.add(trunk, leaves);
    }
  }
  dispose(): void {
    this.water?.dispose();
    this.leafTexture?.dispose();
    this.cloudNoise.dispose();
  }

  update(time: number, x: number, y: number, z: number): void {
    this.material.uniforms.time!.value = time;
    this.sky.position.set(x, 0, z);
    if (this.water) {
      this.water.uniforms.time!.value = time;
      this.water.uniforms.eye!.value.set(x, y, z);
    }
  }
}
