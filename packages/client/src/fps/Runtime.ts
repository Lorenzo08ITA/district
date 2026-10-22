import * as THREE from 'three';
import { batchStaticMeshes } from './Surfaces.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createArena, WeaponId, type ArenaName, Vec3, RayHit } from '@district/rts-shared/fps';
import { ProceduralWeaponFactory, type WeaponRig, type CharacterRig } from './Assets.js';
import { WorldBackdrop } from './Backdrop.js';
import { PosePresentation, RenderBudget } from './Presentation.js';
import { BallisticEffects } from './Effects.js';
import { ProceduralAudioEngine } from './Audio.js';
import { SecondOrderSpring3D } from './SecondOrderSpring3D.js';
export class FpsRuntime {
  readonly renderer: THREE.WebGLRenderer;
  readonly audio = new ProceduralAudioEngine();
  private scene = new THREE.Scene();
  private view = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(100, 1, 0.05, 650);
  private gunCamera = new THREE.PerspectiveCamera(68, 1, 0.015, 5);
  private scopeCamera = new THREE.PerspectiveCamera(17, 1, 0.05, 650);
  private target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private scopeTarget = new THREE.WebGLRenderTarget(512, 512);
  private environment: THREE.WebGLRenderTarget | null = null;
  private postScene = new THREE.Scene();
  private postCamera = new THREE.Camera();
  private post: THREE.ShaderMaterial;
  private factory = new ProceduralWeaponFactory();
  private guns: WeaponRig[] = [];
  private characters: CharacterRig[] = [];
  private effects = new BallisticEffects();
  private spring = new SecondOrderSpring3D(9, 0.75);
  private rotationSpring = new SecondOrderSpring3D(11, 0.8);
  private rayOrigin = new Vec3();
  private rayDirection = new Vec3();
  private rayHit = new RayHit();
  private footTimers = new Float64Array(12);
  private grounded = false;
  private shellTimer = 0;
  private local = new Float64Array(24);
  private presentation = new PosePresentation();
  private budget: RenderBudget;
  private backdrop: WorldBackdrop;
  private software = false;
  private qualityMode = 'auto';
  private shadowFrame = 0;
  private lookSerial = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private ackYaw = 0;
  private ackPitch = 0;
  private lookHistory = new Float64Array(256 * 3);
  frameMs = 0;
  resolutionScale = 1;
  private inspectActive = false;
  private weaponCache: Map<number, THREE.Group>[] = [];
  private remoteWeapons = new Uint8Array(12);
  private arena: ReturnType<typeof createArena>;
  private armLeft = new THREE.Group();
  private armRight = new THREE.Group();
  private history = new Float64Array(8 * 144);
  private ticks = new Float64Array(8).fill(-1);
  private remoteIndex = 0;
  private latestTick = 0;
  private remoteAt = 0;
  private playerId = 0;
  private previous = 0;
  private animation = 0;
  private resize: ResizeObserver;
  private flash: THREE.PointLight;
  private flashUntil = 0;
  private lastFoot = 0;
  private mouseX = 0;
  private mouseY = 0;
  private flags: THREE.Group[] = [];
  private zone: THREE.Mesh;
  private selected = -1;
  private disposed = false;
  private armed = false;
  private lastFrames = 0;
  private frames = 0;
  private now = 0;
  private muzzle = new THREE.Vector3();
  fps = 0;
  drawCalls = 0;
  private lastWeaponShot = 0;
  constructor(
    private host: HTMLElement,
    map: ArenaName,
  ) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    const gl = this.renderer.getContext(),
      debug = gl.getExtension('WEBGL_debug_renderer_info'),
      device = debug ? String(gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)) : '';
    const software = /swiftshader|llvmpipe|software/i.test(device);
    this.software = software;
    this.budget = new RenderBudget(
      software ? 0.55 : 0.65,
      software ? 1 : Math.min(devicePixelRatio, 1.5),
      software ? 0.75 : Math.min(devicePixelRatio, 1.25),
    );
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setPixelRatio(software ? 0.75 : Math.min(devicePixelRatio, 1.5));
    this.renderer.autoClear = false;
    this.renderer.shadowMap.enabled = !software;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (!software) {
      const generator = new THREE.PMREMGenerator(this.renderer),
        roomEnvironment = new RoomEnvironment();
      this.environment = generator.fromScene(roomEnvironment, 0.04);
      roomEnvironment.dispose();
      generator.dispose();
      this.scene.environment = this.view.environment = this.environment.texture;
      this.scene.environmentIntensity = 0.7;
      this.view.environmentIntensity = 1.1;
      this.target.samples = 0;
    }
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label', 'Arena Crossfire');
    const arena = createArena(map);
    this.arena = arena;
    this.scene.add(this.factory.buildArena(arena), this.effects.root);
    this.backdrop = new WorldBackdrop(map, software, this.factory.surfaces);
    this.scene.add(this.backdrop.root);
    this.scene.fog = new THREE.Fog(this.backdrop.fog, 95, 440);
    this.scene.add(new THREE.HemisphereLight(0xa8ddff, 0x222333, 2));
    const sun = new THREE.DirectionalLight(0xffedcf, 3.8);
    sun.position.copy(this.backdrop.sun).multiplyScalar(80);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -48;
    sun.shadow.camera.right = 48;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.normalBias = 0.03;
    this.scene.add(sun);
    this.view.add(new THREE.HemisphereLight(0xc8efff, 0x263244, 3));
    const key = new THREE.DirectionalLight(0xffffff, 4);
    key.position.set(-2, 4, 3);
    this.view.add(key);
    this.flash = new THREE.PointLight(0xffbd62, 0, 4);
    this.view.add(this.flash);
    for (const arm of [this.armLeft, this.armRight]) {
      const sleeve = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.042, 0.24, 5, 10),
          this.factory.cloth,
        ),
        glove = new THREE.Mesh(new THREE.CapsuleGeometry(0.043, 0.04, 5, 10), this.factory.grip);
      sleeve.rotation.x = -1.1;
      glove.position.set(0, 0.07, -0.12);
      arm.add(sleeve, glove);
      for (let finger = 0; finger < 4; finger++) {
        const joint = new THREE.Mesh(
          new THREE.CapsuleGeometry(0.009, 0.027, 3, 7),
          this.factory.grip,
        );
        joint.position.set(-0.027 + finger * 0.018, 0.065, -0.15);
        joint.rotation.x = -0.65;
        arm.add(joint);
        const knuckle = new THREE.Mesh(new THREE.SphereGeometry(0.011, 7, 5), this.factory.rubber);
        knuckle.position.set(-0.027 + finger * 0.018, 0.085, -0.155);
        arm.add(knuckle);
      }
      const wrist = new THREE.Mesh(
        new THREE.TorusGeometry(0.044, 0.006, 5, 20),
        this.factory.rubber,
      );
      wrist.rotation.x = -1.1;
      wrist.position.set(0, 0.05, -0.095);
      arm.add(wrist);
      batchStaticMeshes(arm);
      this.view.add(arm);
    }
    this.armLeft.position.set(-0.12, -0.37, -0.45);
    this.armLeft.rotation.z = -0.7;
    this.armRight.position.set(0.27, -0.38, -0.24);
    this.armRight.rotation.z = 0.35;
    for (let i = 0; i < 6; i++) {
      const gun = this.factory.create(i as WeaponId);
      gun.root.visible = false;
      this.view.add(gun.root);
      this.guns.push(gun);
      if (gun.lens) gun.lens.uniforms.scopeTexture!.value = this.scopeTarget.texture;
    }
    for (let i = 0; i < 12; i++) {
      const character = this.factory.createCharacter(i % 2);
      character.root.visible = false;
      this.scene.add(character.root);
      this.characters.push(character);
      this.weaponCache.push(new Map([[0, character.weapon]]));
    }
    for (let i = 0; i < 2; i++) {
      const flag = new THREE.Group(),
        material = new THREE.MeshStandardMaterial({
          color: i ? 0xff456b : 0x00f0ff,
          emissive: i ? 0xff1234 : 0x00b5d0,
          emissiveIntensity: 0.8,
        });
      const pole = new THREE.Mesh(
          new THREE.CylinderGeometry(0.035, 0.035, 2.5, 8),
          this.factory.metal,
        ),
        cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.65, 8, 2), material);
      pole.position.y = 1.25;
      cloth.position.set(0.55, 2, 0);
      material.side = THREE.DoubleSide;
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.09, 30, 8),
        new THREE.MeshBasicMaterial({
          color: i ? 0xff456b : 0x00f0ff,
          transparent: true,
          opacity: 0.3,
          depthWrite: false,
        }),
      );
      beam.position.y = 15;
      flag.add(pole, cloth, beam);
      flag.visible = false;
      this.flags.push(flag);
      this.scene.add(flag);
    }
    this.zone = new THREE.Mesh(
      new THREE.RingGeometry(4.85, 5, 64),
      new THREE.MeshBasicMaterial({
        color: 0x00eaff,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      }),
    );
    this.zone.rotation.x = -Math.PI / 2;
    this.zone.visible = false;
    this.scene.add(this.zone);
    this.post = new THREE.ShaderMaterial({
      uniforms: {
        image: { value: this.target.texture },
        pixel: { value: new THREE.Vector2(1, 1) },
        hurt: { value: 0 },
        hurtDirection: { value: new THREE.Vector2(0, 1) },
        time: { value: 0 },
      },
      vertexShader: 'varying vec2 v;void main(){v=uv;gl_Position=vec4(position.xy,0.,1.);}',
      fragmentShader: `precision highp float;uniform sampler2D image;uniform vec2 pixel;uniform float hurt;uniform vec2 hurtDirection;uniform float time;varying vec2 v;void main(){vec3 color=texture2D(image,v).rgb;vec3 glow=vec3(0.);for(int i=0;i<8;i++){float angle=float(i)*.785398;vec3 sampleColor=texture2D(image,v+vec2(cos(angle),sin(angle))*pixel*3.).rgb;glow+=max(sampleColor-vec3(1.),vec3(0.));}color+=glow*.045;float edge=smoothstep(.25,.72,length(v-.5));color*=1.-edge*.25;color=mix(color,vec3(1.,.015,.03),edge*hurt*.65*(.2+.8*max(0.,dot(normalize(v-.5+vec2(.0001)),hurtDirection))));color=(color*(2.51*color+.03))/(color*(2.43*color+.59)+.14);color=pow(clamp(color,0.,1.),vec3(1./2.2));gl_FragColor=vec4(color,1.);}`,
    });
    this.postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.post));
    this.resize = new ResizeObserver(() => this.resizeCanvas());
    this.resize.observe(host);
    this.resizeCanvas();
    this.camera.position.set(0, 6, 28);
    this.camera.lookAt(0, 1, 0);
    this.animation = requestAnimationFrame(this.render);
  }
  private resizeCanvas(): void {
    const width = Math.max(1, this.host.clientWidth),
      height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = this.gunCamera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.gunCamera.updateProjectionMatrix();
    const ratio = this.renderer.getPixelRatio();
    this.target.setSize(Math.round(width * ratio), Math.round(height * ratio));
    this.post.uniforms.pixel!.value.set(1 / (width * ratio), 1 / (height * ratio));
  }
  inspect(active: boolean): void {
    this.inspectActive = active;
  }
  identify(id: number): void {
    this.playerId = id;
  }
  frame(values: Float64Array, lookAck = 0): void {
    this.local.set(values);
    this.presentation.push(values, performance.now());
    const index = (lookAck % 256) * 3;
    if (this.lookHistory[index] === lookAck) {
      this.ackYaw = this.lookHistory[index + 1]!;
      this.ackPitch = this.lookHistory[index + 2]!;
    }
    this.armed = true;
  }
  remote(tick: number, values: Float64Array): void {
    this.remoteIndex = (this.remoteIndex + 1) % 8;
    this.history.set(values, this.remoteIndex * 144);
    for (let i = 0; i < 12; i++) {
      const id = values[i * 12 + 8]!;
      if (values[i * 12]! && id !== this.remoteWeapons[i]) {
        const rig = this.characters[i]!;
        rig.root.remove(rig.weapon);
        let gun = this.weaponCache[i]!.get(id);
        if (!gun) {
          gun = this.factory.create(id as WeaponId, false).root;
          this.weaponCache[i]!.set(id, gun);
        }
        gun.position.set(0.18, 1.22, -0.31);
        gun.scale.setScalar(0.7);
        rig.root.add(gun);
        rig.weapon = gun;
        this.remoteWeapons[i] = id;
      }
    }
    this.ticks[this.remoteIndex] = tick;
    this.latestTick = tick;
    this.remoteAt = performance.now();
  }
  look(dx: number, dy: number): number {
    this.mouseX += dx;
    this.mouseY += dy;
    this.lookYaw += dx * 0.002;
    this.lookPitch -= dy * 0.002;
    const sequence = ++this.lookSerial,
      o = (sequence % 256) * 3;
    this.lookHistory[o] = sequence;
    this.lookHistory[o + 1] = this.lookYaw;
    this.lookHistory[o + 2] = this.lookPitch;
    return sequence;
  }
  setQuality(mode: 'auto' | 'performance' | 'quality'): void {
    this.qualityMode = mode;
    const scale =
      mode === 'performance'
        ? 0.65
        : mode === 'quality'
          ? Math.min(devicePixelRatio, this.software ? 1 : 1.5)
          : this.budget.scale;
    this.renderer.setPixelRatio(scale);
    this.resolutionScale = scale;
    this.renderer.shadowMap.enabled = !this.software && mode !== 'performance';
    this.renderer.shadowMap.needsUpdate = true;
    this.resizeCanvas();
  }
  localShot(values: Float64Array): void {
    const id = values[0]!;
    this.spring.impulse(0, -values[1]! * 0.4, 0.9);
    this.rotationSpring.impulse(values[1]! * 15, values[2]! * 15, 0);
    this.lastWeaponShot = performance.now();
    this.flashUntil = performance.now() + 45;
    this.shellTimer = performance.now() + 450;
    this.audio.shot(id);
    this.effects.casing(
      this.local[1]!,
      this.local[2]! + this.local[7]! - 0.15,
      this.local[3]!,
      this.local[8]!,
      this.now,
    );
    const gun = this.guns[id];
    if (gun) gun.drum.rotation.z += Math.PI / 3;
  }
  events(data: ArrayLike<number>): void {
    for (let o = 0; o < data.length; o += 16) {
      const kind = data[o]!,
        actor = data[o + 1]!,
        target = data[o + 2]!,
        weapon = data[o + 3]!;
      if (kind === 1) {
        if (actor === this.playerId) {
          this.guns[this.selected < 0 ? 0 : this.selected]!.muzzle.getWorldPosition(this.muzzle);
          this.muzzle.applyQuaternion(this.camera.quaternion).add(this.camera.position);
        } else this.muzzle.set(data[o + 4]!, data[o + 5]!, data[o + 6]!);
        this.effects.shot(
          this.muzzle.x,
          this.muzzle.y,
          this.muzzle.z,
          data[o + 7]!,
          data[o + 8]!,
          data[o + 9]!,
          this.now,
        );
        if (!target) {
          this.rayOrigin.set(data[o + 4]!, data[o + 5]!, data[o + 6]!);
          this.rayDirection.set(
            data[o + 7]! - data[o + 4]!,
            data[o + 8]! - data[o + 5]!,
            data[o + 9]! - data[o + 6]!,
          );
          const distance = this.rayDirection.length();
          this.rayDirection.normalize();
          if (
            this.arena.world.raycast(
              this.rayHit,
              this.rayOrigin,
              this.rayDirection,
              distance + 0.02,
            )
          ) {
            const p = this.rayHit.point,
              n = this.rayHit.normal;
            this.effects.impact(p.x, p.y, p.z, n.x, n.y, n.z, this.now);
          }
        }
        if (actor !== this.playerId)
          this.audio.shot(weapon, data[o + 4], data[o + 5], data[o + 6], true);
      } else if (kind === 2) {
        if (actor === this.playerId) this.audio.hit(!!(data[o + 11]! & 1), !!(data[o + 11]! & 2));
        if (target === this.playerId) {
          this.post.uniforms.hurt!.value = 0.9;
          const angle =
            Math.atan2(data[o + 4]! - this.local[1]!, -(data[o + 6]! - this.local[3]!)) -
            this.local[8]!;
          this.post.uniforms.hurtDirection!.value.set(Math.sin(angle), Math.cos(angle));
        }
      }
    }
  }
  state(value: {
    mode: string;
    hardpoint: number;
    flagPosition: number[];
    players: { id: number; team: number }[];
  }): void {
    const arena = this.arena.hardpoints;
    for (const p of value.players)
      this.characters[p.id - 1]?.armor.color.setHex(p.team ? 0x82715c : 0x4c625d);
    for (let i = 0; i < 2; i++) {
      const flag = this.flags[i]!;
      flag.visible = value.mode === 'ctf';
      flag.position.set(
        value.flagPosition[i * 3]!,
        value.flagPosition[i * 3 + 1]!,
        value.flagPosition[i * 3 + 2]!,
      );
    }
    this.zone.visible = value.mode === 'hardpoint';
    if (this.zone.visible && arena)
      this.zone.position.set(
        arena[value.hardpoint * 3]!,
        arena[value.hardpoint * 3 + 1]! + 0.04,
        arena[value.hardpoint * 3 + 2]!,
      );
  }
  private render = (timestamp: number): void => {
    if (this.disposed) return;
    this.animation = requestAnimationFrame(this.render);
    if (document.hidden) {
      this.previous = timestamp;
      return;
    }
    const frameTime = Math.max(1, timestamp - (this.previous || timestamp - 16)),
      dt = Math.min(0.05, frameTime / 1000);
    this.frameMs = frameTime;
    if (this.qualityMode === 'auto' && this.budget.sample(frameTime, timestamp)) {
      this.renderer.setPixelRatio(this.budget.scale);
      this.resolutionScale = this.budget.scale;
      this.resizeCanvas();
    }
    this.renderer.info.reset();
    this.renderer.shadowMap.needsUpdate = this.shadowFrame++ % 2 === 0;
    this.previous = timestamp;
    this.now = timestamp / 1000;
    if (!this.lastFrames) this.lastFrames = timestamp;
    this.frames++;
    if (timestamp - this.lastFrames >= 1000) {
      this.fps = (this.frames * 1000) / (timestamp - this.lastFrames);
      this.frames = 0;
      this.lastFrames = timestamp;
    }
    const v = this.presentation.sample(timestamp),
      speed = Math.hypot(v[4]!, v[6]!),
      id = Math.max(0, Math.min(5, v[11]! | 0)),
      ads = !!v[18] && v[17]! <= 0,
      dead = v[10]! <= 0;
    if (this.armed) {
      this.camera.position.set(v[1]!, v[2]! + v[7]!, v[3]!);
      this.camera.rotation.set(
        Math.max(-1.55, Math.min(1.55, this.local[9]! + this.lookPitch - this.ackPitch)),
        -(this.local[8]! + this.lookYaw - this.ackYaw),
        0,
        'YXZ',
      );
      const fov = ads ? (id === 1 ? 70 : 76) : 100 + Math.min(16, speed * 0.8);
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 12);
      this.camera.updateProjectionMatrix();
      this.audio.listener(v[1]!, v[2]! + v[7]!, v[3]!, v[8]!, v[9]!);
      if (v[15] && speed > 2 && timestamp - this.lastFoot > Math.max(180, 420 - speed * 10)) {
        this.audio.foot(v[1]!, v[2]!, v[3]!, false);
        this.lastFoot = timestamp;
      }
    }
    const desired = this.latestTick - 6 + Math.min(6, (timestamp - this.remoteAt) * 0.06);
    let left = -1,
      right = -1;
    for (let n = 0; n < 8; n++) {
      const tick = this.ticks[n]!;
      if (tick < 0) continue;
      if (tick <= desired && (left < 0 || tick > this.ticks[left]!)) left = n;
      if (tick >= desired && (right < 0 || tick < this.ticks[right]!)) right = n;
    }
    if (left < 0) left = right;
    if (right < 0) right = left;
    if (left >= 0 && right >= 0) {
      const mix =
        this.ticks[right] === this.ticks[left]
          ? 0
          : Math.max(
              0,
              Math.min(1, (desired - this.ticks[left]!) / (this.ticks[right]! - this.ticks[left]!)),
            );
      for (let i = 0; i < 12; i++) {
        const a = left * 144 + i * 12,
          b = right * 144 + i * 12,
          rig = this.characters[i]!,
          present = this.history[b]! > 0 && this.history[b + 6]! > 0;
        rig.root.visible = present && i + 1 !== this.playerId;
        if (!rig.root.visible) continue;
        const blend =
          this.history[a + 6]! <= 0 ||
          Math.hypot(
            this.history[b + 1]! - this.history[a + 1]!,
            this.history[b + 3]! - this.history[a + 3]!,
          ) > 8
            ? 1
            : mix;
        rig.root.position.set(
          this.history[a + 1]! + (this.history[b + 1]! - this.history[a + 1]!) * blend,
          this.history[a + 2]! + (this.history[b + 2]! - this.history[a + 2]!) * blend,
          this.history[a + 3]! + (this.history[b + 3]! - this.history[a + 3]!) * blend,
        );
        const angle = Math.atan2(
          Math.sin(this.history[b + 4]! - this.history[a + 4]!),
          Math.cos(this.history[b + 4]! - this.history[a + 4]!),
        );
        rig.root.rotation.y = -(this.history[a + 4]! + angle * mix);
        rig.root.scale.y = this.history[b + 7] ? 0.58 : 1;
        rig.head.rotation.x = this.history[b + 5]!;
        const stride =
          Math.sin(timestamp * 0.012 + i) *
          Math.min(0.6, Math.hypot(this.history[b + 9]!, this.history[b + 10]!) * 0.045);
        rig.leftLeg.rotation.x = stride;
        rig.rightLeg.rotation.x = -stride;
        if (Math.abs(stride) > 0.2 && timestamp - this.footTimers[i]! > 320) {
          this.audio.foot(rig.root.position.x, rig.root.position.y, rig.root.position.z, true);
          this.footTimers[i] = timestamp;
        }
      }
    }
    if (this.selected !== id) {
      for (let n = 0; n < 6; n++) this.guns[n]!.root.visible = n === id;
      this.selected = id;
      this.spring.impulse(0.02, -0.5, 0.2);
    }
    this.view.visible = this.armed && !dead;
    const gun = this.guns[id]!,
      reload = v[17]! > 0;
    this.spring.target.set(this.mouseX * 0.0003, this.mouseY * 0.0003, 0);
    this.spring.update(dt);
    this.rotationSpring.target.set(
      this.mouseY * 0.0004,
      this.mouseX * 0.0004,
      Math.max(-0.113, Math.min(0.113, -v[4]! * 0.008)),
    );
    if (v[15] && !this.grounded) {
      this.spring.impulse(0, -Math.min(0.8, v[23]! * 0.04), 0);
      this.rotationSpring.impulse(Math.min(0.8, v[23]! * 0.04), 0, 0);
    }
    this.grounded = !!v[15];
    this.rotationSpring.update(dt);
    const bob =
      Math.abs(Math.sin(timestamp * 0.011)) * Math.min(0.012, speed * 0.001) * (v[15] ? 1 : 0);
    gun.root.position.set(
      (ads ? 0 : 0.23) +
        Math.cos(timestamp * 0.0055) * Math.min(0.008, speed * 0.0007) * (v[15] ? 1 : 0) +
        this.spring.position.x,
      (ads ? (id === 1 ? -0.225 : -0.205) : -0.25) + bob + this.spring.position.y,
      (ads ? -0.55 : -0.6) + this.spring.position.z - (reload ? 0.12 : 0),
    );
    gun.root.rotation.set(
      (reload ? -0.61 : 0) + this.rotationSpring.position.x,
      (reload ? -0.25 : 0) + this.rotationSpring.position.y,
      this.inspectActive
        ? Math.sin(timestamp * 0.007) * 1.8
        : v[14]
          ? -0.314
          : this.rotationSpring.position.z,
    );
    gun.magazine.position.y =
      -0.14 - (reload ? Math.sin(Math.min(1, v[17]! / 2) * Math.PI) * 0.24 : 0);
    gun.bolt.position.z =
      0.01 +
      (id === 1 && timestamp - this.lastWeaponShot < 900
        ? Math.sin(Math.max(0, (timestamp - this.lastWeaponShot - 200) / 700) * Math.PI) * 0.1
        : Math.min(0.1, Math.abs(this.spring.velocity.z) * 0.015));
    this.mouseX *= Math.exp(-dt * 12);
    this.mouseY *= Math.exp(-dt * 12);
    gun.muzzle.getWorldPosition(this.muzzle);
    this.flash.position.copy(this.muzzle);
    this.flash.intensity = timestamp < this.flashUntil ? 4 : 0;
    this.armLeft.position.y = -0.37 + (reload ? -0.15 : 0) + bob;
    this.armRight.position.y = -0.38 + bob;
    if (this.shellTimer && timestamp > this.shellTimer) {
      this.audio.casing();
      this.shellTimer = 0;
    }
    this.backdrop.update(
      this.now,
      this.camera.position.x,
      this.camera.position.y,
      this.camera.position.z,
    );
    this.effects.update(this.now, dt);
    this.post.uniforms.hurt!.value *= Math.exp(-dt * 3);
    if (this.armed && ads && id === 1 && !dead) {
      this.scopeCamera.position.copy(this.camera.position);
      this.scopeCamera.quaternion.copy(this.camera.quaternion);
      this.scopeCamera.fov = 100 / 6;
      this.scopeCamera.updateProjectionMatrix();
      this.renderer.setRenderTarget(this.scopeTarget);
      this.renderer.clear();
      this.renderer.render(this.scene, this.scopeCamera);
    }
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    if (this.view.visible) {
      this.renderer.clearDepth();
      this.renderer.render(this.view, this.gunCamera);
    }
    this.renderer.setRenderTarget(null);
    this.renderer.clear();
    this.renderer.render(this.postScene, this.postCamera);
    this.drawCalls = this.renderer.info.render.calls;
  };
  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animation);
    this.resize.disconnect();
    const geometries = new Set<THREE.BufferGeometry>(),
      materials = new Set<THREE.Material>();
    for (const root of [
      this.scene,
      this.view,
      this.postScene,
      ...this.weaponCache.flatMap((cache) => [...cache.values()]),
    ])
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            materials.add(material);
        }
      });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    this.target.dispose();
    this.scopeTarget.dispose();
    this.environment?.dispose();
    this.factory.surfaces.dispose();
    this.backdrop.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    void this.audio.destroy();
  }
}
