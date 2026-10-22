import { BuildingKind, UnitKind } from '@district/rts-shared';
import { Camera } from './Camera.js';
import { PLAYER_COLORS, type RenderFrame } from './messages.js';
const VERTEX = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.0-1.0,0,1);}`;
const FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D tiles;uniform vec2 viewport;uniform vec2 center;uniform vec2 mapSize;uniform float zoom;uniform float time;
out vec4 color;
void main(){vec2 screen=vec2(gl_FragCoord.x,viewport.y-gl_FragCoord.y);vec2 world=(screen-viewport*.5)/zoom+center;
 if(any(lessThan(world,vec2(0)))||any(greaterThanEqual(world,mapSize))){color=vec4(.028,.048,.063,1);return;}
 vec3 terrain=texture(tiles,(floor(world)+.5)/mapSize).rgb;
 float water=step(terrain.r*1.5,terrain.b)*(1.0-step(.16,terrain.r));
 float wave=sin(world.x*.31+time*.4)*cos(world.y*.37-time*.32)*.012;
 float grid=zoom>13.0?smoothstep(.94,1.0,max(fract(world.x),fract(world.y)))*.06:0.;
 color=vec4(terrain+wave*water-grid,1.0);}`;
function shader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const result = gl.createShader(type);
  if (!result) throw new Error('Shader non disponibile');
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(result);
    gl.deleteShader(result);
    throw new Error(error ?? 'Shader compilation failed');
  }
  return result;
}
export class Renderer {
  readonly camera = new Camera();
  readonly owners: Uint16Array;
  readonly terrain: Uint8Array;
  readonly buildings: Uint32Array;
  private pixels: Uint8ClampedArray<ArrayBuffer>;
  private frame: RenderFrame | null = null;
  private previous: RenderFrame | null = null;
  private received = 0;
  private animation = 0;
  private observer: ResizeObserver;
  private gl: WebGL2RenderingContext | null;
  private context: CanvasRenderingContext2D | null = null;
  private overlay: CanvasRenderingContext2D;
  private program: WebGLProgram | null = null;
  private texture: WebGLTexture | null = null;
  private backing: HTMLCanvasElement;
  private backingContext: CanvasRenderingContext2D;
  hovered = -1;
  radius = 0;
  selected = -1;
  private lost = false;
  constructor(
    private canvas: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
    readonly width: number,
    readonly height: number,
    private onError: (message: string) => void,
  ) {
    this.owners = new Uint16Array(width * height);
    this.terrain = new Uint8Array(width * height);
    this.buildings = new Uint32Array(width * height);
    this.pixels = new Uint8ClampedArray(width * height * 4);
    const context = overlay.getContext('2d');
    if (!context) throw new Error('Canvas2D non disponibile');
    this.overlay = context;
    this.backing = document.createElement('canvas');
    this.backing.width = width;
    this.backing.height = height;
    this.backingContext = this.backing.getContext('2d')!;
    this.gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      powerPreference: 'low-power',
    });
    if (this.gl) {
      const gl = this.gl,
        program = gl.createProgram();
      if (!program) throw new Error('WebGL non disponibile');
      this.program = program;
      const vertex = shader(gl, gl.VERTEX_SHADER, VERTEX),
        fragment = shader(gl, gl.FRAGMENT_SHADER, FRAGMENT);
      gl.attachShader(program, vertex);
      gl.attachShader(program, fragment);
      gl.linkProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Shader link failed');
      this.texture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    } else {
      this.context = canvas.getContext('2d');
      if (!this.context) throw new Error('Renderer non disponibile');
    }
    canvas.addEventListener('webglcontextlost', this.contextLost);
    canvas.addEventListener('webglcontextrestored', this.contextRestored);
    this.observer = new ResizeObserver(() => this.resize(overlay));
    this.observer.observe(canvas);
    this.resize(overlay);
    this.camera.fit(width, height, this.camera.viewWidth, this.camera.viewHeight);
    this.animation = requestAnimationFrame(this.draw);
  }
  private contextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.onError('GPU interrotta. Ricarica per riprendere la partita salvata.');
  };
  private contextRestored = () => {
    this.onError('GPU ripristinata. Ricarica per ricreare il renderer.');
  };
  private resize(overlay: HTMLCanvasElement) {
    const rectangle = this.canvas.getBoundingClientRect(),
      ratio = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = overlay.width = Math.max(1, Math.round(rectangle.width * ratio));
    this.canvas.height = overlay.height = Math.max(1, Math.round(rectangle.height * ratio));
    this.camera.viewWidth = rectangle.width;
    this.camera.viewHeight = rectangle.height;
    this.overlay.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  update(frame: RenderFrame) {
    this.previous = this.frame;
    this.frame = frame;
    this.received = performance.now();
    const rows = new Map<number, [number, number]>();
    for (let n = 0; n < frame.indices.length; n++) {
      const i = frame.indices[n]!,
        x = i % this.width,
        y = Math.floor(i / this.width);
      this.owners[i] = frame.owners[n]!;
      this.terrain[i] = frame.terrain[n]!;
      this.buildings[i] = frame.buildings[n]!;
      this.pixels.set(frame.colors.subarray(n * 4, n * 4 + 4), i * 4);
      this.pixels[i * 4 + 3] = 255;
      const row = rows.get(y);
      if (row) {
        row[0] = Math.min(row[0], x);
        row[1] = Math.max(row[1], x);
      } else rows.set(y, [x, x]);
    }
    if (this.gl && !this.lost) {
      const gl = this.gl;
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      for (const [y, [start, end]] of rows)
        gl.texSubImage2D(
          gl.TEXTURE_2D,
          0,
          start,
          y,
          end - start + 1,
          1,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          this.pixels.subarray((y * this.width + start) * 4, (y * this.width + end + 1) * 4),
        );
    } else if (this.context) {
      const image = new ImageData(this.pixels, this.width, this.height);
      for (const [y, [start, end]] of rows)
        this.backingContext.putImageData(image, 0, 0, start, y, end - start + 1, 1);
    }
  }
  tileAt(x: number, y: number): number {
    const world = this.camera.screenToWorld(x, y),
      tx = Math.floor(world[0]),
      ty = Math.floor(world[1]);
    return tx < 0 || ty < 0 || tx >= this.width || ty >= this.height ? -1 : ty * this.width + tx;
  }
  private color(owner: number) {
    const c = PLAYER_COLORS[owner % PLAYER_COLORS.length]!;
    return 'rgb(' + c.join(',') + ')';
  }
  private point(tile: number): readonly [number, number] {
    return this.camera.worldToScreen(
      (tile % this.width) + 0.5,
      Math.floor(tile / this.width) + 0.5,
    );
  }
  private visible(x: number, y: number, pad = 40) {
    return (
      x >= -pad &&
      y >= -pad &&
      x <= this.camera.viewWidth + pad &&
      y <= this.camera.viewHeight + pad
    );
  }
  private draw = (now: number) => {
    this.animation = requestAnimationFrame(this.draw);
    if (this.lost) return;
    const camera = this.camera,
      gl = this.gl;
    if (gl && this.program) {
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.useProgram(this.program);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.uniform1i(gl.getUniformLocation(this.program, 'tiles'), 0);
      gl.uniform2f(
        gl.getUniformLocation(this.program, 'viewport'),
        this.canvas.width,
        this.canvas.height,
      );
      const ratio = this.canvas.width / camera.viewWidth;
      gl.uniform2f(gl.getUniformLocation(this.program, 'center'), camera.x, camera.y);
      gl.uniform2f(gl.getUniformLocation(this.program, 'mapSize'), this.width, this.height);
      gl.uniform1f(gl.getUniformLocation(this.program, 'zoom'), camera.zoom * ratio);
      gl.uniform1f(gl.getUniformLocation(this.program, 'time'), now / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else if (this.context) {
      const ctx = this.context,
        ratio = this.canvas.width / camera.viewWidth;
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.fillStyle = '#08111a';
      ctx.fillRect(0, 0, camera.viewWidth, camera.viewHeight);
      ctx.imageSmoothingEnabled = false;
      const origin = camera.worldToScreen(0, 0);
      ctx.drawImage(
        this.backing,
        origin[0],
        origin[1],
        this.width * camera.zoom,
        this.height * camera.zoom,
      );
    }
    const frame = this.frame,
      ctx = this.overlay;
    ctx.clearRect(0, 0, camera.viewWidth, camera.viewHeight);
    if (!frame) return;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#172c31';
    for (const rail of frame.world.rails) {
      ctx.beginPath();
      for (let n = 0; n < rail.tiles.length; n++) {
        const p = this.point(rail.tiles[n]!);
        if (n === 0) ctx.moveTo(p[0], p[1]);
        else ctx.lineTo(p[0], p[1]);
      }
      ctx.stroke();
    }
    for (const building of frame.world.buildings) {
      const p = this.point(building.tile);
      if (!this.visible(p[0], p[1])) continue;
      const size = Math.max(4, Math.min(11, camera.zoom * 1.25));
      ctx.save();
      ctx.translate(p[0], p[1]);
      ctx.fillStyle = '#10232c';
      ctx.strokeStyle = this.color(building.ownerId);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (building.kind === BuildingKind.City) {
        ctx.moveTo(-size, size);
        ctx.lineTo(-size, -size * 0.25);
        ctx.lineTo(0, -size);
        ctx.lineTo(size, -size * 0.25);
        ctx.lineTo(size, size);
        ctx.closePath();
      } else if (building.kind === BuildingKind.Factory) {
        ctx.rect(-size, -size * 0.2, size * 2, size * 1.2);
        ctx.rect(size * 0.25, -size, size * 0.4, size);
      } else if (building.kind === BuildingKind.Port) {
        ctx.arc(0, 0, size, 0, Math.PI);
        ctx.moveTo(0, -size);
        ctx.lineTo(0, size);
        ctx.moveTo(-size * 0.6, -size * 0.4);
        ctx.lineTo(size * 0.6, -size * 0.4);
      } else if (building.kind === BuildingKind.DefensePost) {
        ctx.moveTo(-size, -size);
        ctx.lineTo(size, -size);
        ctx.lineTo(size * 0.65, size * 0.5);
        ctx.lineTo(0, size);
        ctx.lineTo(-size * 0.65, size * 0.5);
        ctx.closePath();
      } else {
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.moveTo(0, -size * 1.4);
        ctx.lineTo(0, size * 1.4);
        ctx.moveTo(-size * 1.4, 0);
        ctx.lineTo(size * 1.4, 0);
      }
      ctx.fill();
      ctx.stroke();
      if (building.level > 1) {
        ctx.font = '9px monospace';
        ctx.fillStyle = '#fff';
        ctx.fillText(String(building.level), size + 2, 0);
      }
      ctx.restore();
    }
    const fraction = Math.min(1, (now - this.received) / 100),
      previous = new Map(this.previous?.world.units.map((u) => [u.id, u]) ?? []);
    for (const unit of frame.world.units) {
      const old = previous.get(unit.id),
        x = ((old?.xMilli ?? unit.xMilli) * (1 - fraction) + unit.xMilli * fraction) / 1000,
        y = ((old?.yMilli ?? unit.yMilli) * (1 - fraction) + unit.yMilli * fraction) / 1000,
        p = camera.worldToScreen(x, y);
      if (!this.visible(p[0], p[1])) continue;
      ctx.fillStyle = this.color(unit.ownerId);
      ctx.strokeStyle = '#071923';
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (unit.kind === UnitKind.Train) ctx.rect(p[0] - 4, p[1] - 2, 8, 4);
      else {
        ctx.moveTo(p[0] + 6, p[1]);
        ctx.lineTo(p[0] - 4, p[1] - 3);
        ctx.lineTo(p[0] - 4, p[1] + 3);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }
    for (const missile of frame.world.missiles) {
      const p = camera.worldToScreen(missile.xMilli / 1000, missile.yMilli / 1000),
        lift = Math.min(65, missile.altitudeMilli / 2500);
      ctx.strokeStyle = this.color(missile.ownerId);
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      const target = this.point(missile.targetTile);
      ctx.moveTo(p[0], p[1] - lift);
      ctx.quadraticCurveTo((p[0] + target[0]) / 2, p[1] - lift - 15, target[0], target[1]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffb274';
      ctx.beginPath();
      ctx.arc(p[0], p[1] - lift, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (const projectile of [...frame.world.interceptors, ...frame.world.projectiles]) {
      const p = camera.worldToScreen(projectile.xMilli / 1000, projectile.yMilli / 1000);
      ctx.fillStyle = '#e7f8d6';
      ctx.fillRect(p[0] - 1, p[1] - 1, 3, 3);
    }
    for (const player of frame.players) {
      if (player.eliminated || player.landSize < 1) continue;
      const p = camera.worldToScreen(player.center[0] + 0.5, player.center[1] + 0.5);
      if (!this.visible(p[0], p[1], 120)) continue;
      const size = Math.max(10, Math.min(21, 8 + Math.log2(player.landSize) * 0.8));
      ctx.textAlign = 'center';
      ctx.font = '600 ' + size + 'px system-ui';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0c1c27';
      ctx.fillStyle = this.color(player.id);
      ctx.strokeText(player.name, p[0], p[1]);
      ctx.fillText(player.name, p[0], p[1]);
      ctx.font = '11px monospace';
      const amount = compact(player.troops);
      ctx.strokeText(amount, p[0], p[1] + 15);
      ctx.fillStyle = '#f1f4ef';
      ctx.fillText(amount, p[0], p[1] + 15);
    }
    if (this.hovered >= 0) {
      const p = this.point(this.hovered);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.strokeRect(p[0] - camera.zoom / 2, p[1] - camera.zoom / 2, camera.zoom, camera.zoom);
      if (this.radius) {
        ctx.fillStyle = '#d5eab511';
        ctx.beginPath();
        ctx.arc(p[0], p[1], this.radius * camera.zoom, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    if (this.selected >= 0) {
      const p = this.point(this.selected);
      ctx.strokeStyle = '#fff';
      ctx.beginPath();
      ctx.arc(p[0], p[1], Math.max(12, camera.zoom * 2), 0, Math.PI * 2);
      ctx.stroke();
    }
  };
  destroy() {
    cancelAnimationFrame(this.animation);
    this.observer.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.contextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
    if (this.gl) {
      this.gl.deleteTexture(this.texture);
      this.gl.deleteProgram(this.program);
      this.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }
}
export function compact(value: number): string {
  return value >= 1e6
    ? (value / 1e6).toFixed(1) + 'M'
    : value >= 1000
      ? (value / 1000).toFixed(1) + 'K'
      : String(value);
}
