import {
  HitConfirm,
  KinematicController,
  PlayerInput,
  InputRingBuffer,
  PacketWriter,
  PacketReader,
  PlayerSnapshot,
  FpsPacketKind,
  WeaponController,
  FireResult,
  InputButtons,
  WEAPONS,
  createArena,
  quantizeInput,
  Vec3,
  clamp,
  type ArenaName,
} from '@district/rts-shared/fps';
import { encodeWire, decodeWire, WireKind } from '@district/rts-shared';
interface Scope {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(value: unknown): void;
}
const scope = self as unknown as Scope;
const confirmation = new HitConfirm();
let socket: WebSocket | null = null,
  controller: KinematicController | null = null,
  arenaName: ArenaName = 'nexus',
  playerId = 0,
  carrying = false,
  started = false,
  initialized = false,
  sequence = 1,
  buttons = 0,
  latchedButtons = 0,
  moveX = 0,
  moveZ = 0,
  yaw = 0,
  pitch = 0,
  weapon = 0,
  hp = 100,
  serverTick = 0,
  stopped = false,
  last = performance.now(),
  accumulator = 0,
  retry = 0,
  code = '',
  configuration: Record<string, unknown> = {},
  reconnect: ReturnType<typeof setTimeout> | null = null;
const ring = new InputRingBuffer(),
  input = new PlayerInput(),
  quantized = new PlayerInput(),
  writer = new PacketWriter(),
  reader = new PacketReader(),
  snapshot = new PlayerSnapshot(),
  weapons = new WeaponController(123),
  shot = new FireResult(),
  errorOffset = new Vec3(),
  before = new Vec3();
const localValues = new Float64Array(24),
  localEnvelope = { type: 'frame', values: localValues, lookSequence: 0 },
  remoteValues = new Float64Array(12 * 12),
  remoteEnvelope = { type: 'remote', tick: 0, values: remoteValues },
  shotValues = new Float64Array(4),
  shotEnvelope = { type: 'localShot', values: shotValues };
function control(value: unknown) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(encodeWire(WireKind.Control, value));
}
function post(type: string, value: unknown) {
  scope.postMessage({ type, value });
}
function sendResync() {
  initialized = false;
  ring.clear();
  control({ type: 'resync' });
  post('status', 'Sincronizzazione…');
}
function simulate(value: Readonly<PlayerInput>, replay: boolean) {
  if (!controller) return;
  controller.step(value, WEAPONS[value.weapon]!.movementMultiplier);
  const state = controller.state,
    now = state.tick / 60;
  weapons.update(now, 1 / 60);
  if (value.buttons & InputButtons.Reload) weapons.reload(value.weapon, now);
  aim.ads = !!(value.buttons & InputButtons.Ads);
  aim.grounded = state.grounded;
  aim.sliding = state.sliding;
  aim.speed = Math.hypot(state.velocity.x, state.velocity.z);
  if (
    weapons.trigger(shot, value.weapon, now, !!(value.buttons & InputButtons.Fire), aim) &&
    !replay
  ) {
    yaw += shot.recoilYaw;
    pitch = clamp(pitch + shot.recoilPitch, -1.55, 1.55);
    shotValues[0] = value.weapon;
    shotValues[1] = shot.recoilPitch;
    shotValues[2] = shot.recoilYaw;
    shotValues[3] = value.sequenceNumber;
    scope.postMessage(shotEnvelope);
  }
}
const aim = { ads: false, grounded: true, sliding: false, speed: 0 };
function reconcile(record: PlayerSnapshot) {
  if (!controller) return;
  const wasDead = hp <= 0;
  hp = record.hp;
  serverTick = record.state.tick;
  weapons.ammo[record.weapon] = record.ammo;
  weapons.reserve[record.weapon] = record.reserve;
  weapons.nextFire[record.weapon] = record.nextFire;
  weapons.reloadUntil[record.weapon] = record.reloadUntil;
  weapons.bloom[record.weapon] = record.bloom;
  weapons.shots[record.weapon] = record.shots;
  if (!initialized || (wasDead && hp > 0)) {
    weapon = record.weapon;
    controller.state.copy(record.state);
    ring.clear();
    yaw = record.yaw;
    pitch = record.pitch;
    initialized = true;
    errorOffset.set(0, 0, 0);
    sequence = Math.max(sequence, record.lastProcessedSeq + 1);
  } else {
    before.copy(controller.state.position).add(errorOffset);
    ring.acknowledge(record.lastProcessedSeq);
    controller.state.copy(record.state);
    weapons.ammo[record.weapon] = record.ammo;
    weapons.reserve[record.weapon] = record.reserve;
    weapons.nextFire[record.weapon] = record.nextFire;
    weapons.reloadUntil[record.weapon] = record.reloadUntil;
    weapons.bloom[record.weapon] = record.bloom;
    weapons.shots[record.weapon] = record.shots;
    for (let n = 0; n < ring.length; n++) simulate(ring.at(n), true);
    errorOffset.set(
      before.x - controller.state.position.x,
      before.y - controller.state.position.y,
      before.z - controller.state.position.z,
    );
    if (errorOffset.lengthSquared() < 0.0001) errorOffset.set(0, 0, 0);
  }
  if (hp <= 0) {
    ring.clear();
    buttons &= ~InputButtons.Fire;
    latchedButtons &= ~InputButtons.Fire;
  }
}
function connect() {
  if (stopped) return;
  socket = new WebSocket(String(configuration.origin).replace(/^http/, 'ws') + '/fps/socket');
  socket.binaryType = 'arraybuffer';
  post('status', retry ? 'Riconnessione…' : 'Connessione…');
  socket.onmessage = (event) => {
    try {
      const bytes = new Uint8Array(event.data as ArrayBuffer);
      if (bytes[0] === 0x46 && bytes[1] === 0x50 && bytes[2] === 0x53 && bytes[3] === 0x31) {
        reader.reset(bytes);
        if (reader.kind === FpsPacketKind.HitConfirm) {
          for (let n = 0; n < reader.count; n++) {
            reader.hit(confirmation);
            post('hit', {
              damage: confirmation.damageDealt,
              head: confirmation.isHeadshot,
              kill: confirmation.isKill,
            });
          }
          return;
        }
        if (reader.kind !== FpsPacketKind.Snapshot) throw new Error('Snapshot atteso');
        remoteValues.fill(0);
        for (let i = 0; i < reader.count; i++) {
          reader.snapshot(snapshot);
          const o = (snapshot.playerId - 1) * 12;
          remoteValues[o] = snapshot.playerId;
          remoteValues[o + 1] = snapshot.state.position.x;
          remoteValues[o + 2] = snapshot.state.position.y;
          remoteValues[o + 3] = snapshot.state.position.z;
          remoteValues[o + 4] = snapshot.yaw;
          remoteValues[o + 5] = snapshot.pitch;
          remoteValues[o + 6] = snapshot.hp;
          remoteValues[o + 7] = snapshot.state.crouched ? 1 : 0;
          remoteValues[o + 8] = snapshot.weapon;
          remoteValues[o + 9] = snapshot.state.velocity.x;
          remoteValues[o + 10] = snapshot.state.velocity.z;
          remoteValues[o + 11] = snapshot.state.sliding ? 1 : 0;
          if (snapshot.playerId === playerId) reconcile(snapshot);
          remoteEnvelope.tick = snapshot.state.tick;
        }
        scope.postMessage(remoteEnvelope);
        return;
      }
      const packet = decodeWire(bytes);
      if (packet.kind !== WireKind.Control) return;
      const value = packet.value as Record<string, unknown>;
      if (value.type === 'ready') {
        retry = 0;
        if (code)
          control({ type: 'join', code, debug: configuration.debug, tabId: configuration.tabId });
        else control(configuration.join);
      } else if (value.type === 'welcome') {
        playerId = Number(value.playerId);
        sequence = Number(value.nextSequence);
        code = String(value.code);
        started = !!value.started;
        const map = value.map as ArenaName;
        if (!controller || arenaName !== map) {
          arenaName = map;
          const arena = createArena(map);
          controller = new KinematicController(arena.world, arena.pads);
        }
        ring.clear();
        initialized = false;
        weapons.reset();
        serverTick = Number(value.tick);
        post('welcome', value);
      } else if (value.type === 'lobby') {
        started = !!value.started;
        post('lobby', value);
      } else if (value.type === 'ping') control({ type: 'pong', nonce: value.nonce });
      else if (value.type === 'result') {
        started = false;
        post('result', value.result);
      } else if (value.type === 'error') post('error', value.message);
      else {
        if (value.type === 'state') {
          const own = (value.players as { id: number; carrying: number }[]).find(
            (p) => p.id === playerId,
          );
          carrying = !!own && own.carrying >= 0;
          if (carrying && weapon !== 5) weapon = 4;
        }
        post(String(value.type), value);
      }
    } catch (error) {
      post('error', error instanceof Error ? error.message : 'Pacchetto non valido');
      sendResync();
    }
  };
  socket.onclose = (event) => {
    if (stopped) return;
    initialized = false;
    started = false;
    post(
      'status',
      event.code === 1008
        ? 'Sessione terminata: accedi o abilita debug in una nuova lobby.'
        : 'Connessione interrotta · riconnessione',
    );
    if (event.code !== 1008 && event.code !== 1000)
      reconnect = setTimeout(connect, Math.min(5000, 500 * 2 ** Math.min(retry++, 4)));
  };
  socket.onerror = () => post('status', 'Rete non disponibile');
}
const timer = setInterval(() => {
  const now = performance.now(),
    elapsed = now - last;
  last = now;
  if (elapsed > 250 && initialized) {
    sendResync();
    accumulator = 0;
    return;
  }
  accumulator += Math.min(100, elapsed);
  let count = 0;
  while (accumulator >= 1000 / 60 && count++ < 4) {
    accumulator -= 1000 / 60;
    if (!controller || !started || !initialized || socket?.readyState !== WebSocket.OPEN) continue;
    if (hp > 0) {
      input.sequenceNumber = sequence++;
      input.clientTick = controller.state.tick + 1;
      input.subTickFraction = fraction;
      fraction = 0;
      input.moveX = moveX;
      input.moveZ = moveZ;
      input.yaw = yaw;
      input.pitch = pitch;
      input.buttons = buttons | latchedButtons;
      latchedButtons = 0;
      input.weapon = weapon;
      quantizeInput(quantized, input);
      try {
        ring.push(quantized);
      } catch {
        sendResync();
        continue;
      }
      simulate(quantized, false);
      socket.send(writer.begin(FpsPacketKind.Inputs).input(quantized).finish());
    }
    errorOffset.scale(Math.exp(-(1 / 60) / 0.08));
    const s = controller.state;
    localValues[0] = s.tick;
    localValues[1] = s.position.x + errorOffset.x;
    localValues[2] = s.position.y + errorOffset.y;
    localValues[3] = s.position.z + errorOffset.z;
    localValues[4] = s.velocity.x;
    localValues[5] = s.velocity.y;
    localValues[6] = s.velocity.z;
    localValues[7] = s.eyeHeight;
    localValues[8] = yaw;
    localValues[9] = pitch;
    localValues[10] = hp;
    localValues[11] = weapon;
    localValues[12] = weapons.ammo[weapon]!;
    localValues[13] = weapons.reserve[weapon]!;
    localValues[14] = s.sliding ? 1 : 0;
    localValues[15] = s.grounded ? 1 : 0;
    localValues[16] = s.crouched ? 1 : 0;
    localValues[17] = Math.max(0, weapons.reloadUntil[weapon]! - s.tick / 60);
    localValues[18] = buttons & InputButtons.Ads ? 1 : 0;
    localValues[19] = weapons.bloom[weapon]!;
    localValues[20] = serverTick;
    localValues[21] = sequence;
    localValues[22] = ring.length;
    localValues[23] = s.impactVelocity;
    scope.postMessage(localEnvelope);
  }
}, 4);
let fraction = 0;
scope.onmessage = (event) => {
  const message = event.data as { type: string; [key: string]: unknown };
  switch (message.type) {
    case 'connect':
      configuration = message;
      stopped = false;
      code = String(message.code ?? '');
      connect();
      break;
    case 'input':
      moveX = Number(message.moveX);
      moveZ = Number(message.moveZ);
      if (Number(message.buttons) & ~buttons) {
        latchedButtons |= Number(message.buttons) & ~buttons;
        fraction = clamp((performance.now() - last + accumulator) / (1000 / 60), 0, 1);
      }
      buttons = Number(message.buttons);
      weapon = carrying && Number(message.weapon) !== 5 ? 4 : Number(message.weapon);
      break;
    case 'release':
      buttons = latchedButtons = moveX = moveZ = 0;
      fraction = 0;
      break;
    case 'look':
      localEnvelope.lookSequence = Number(message.sequence) || 0;
      yaw += Number(message.dx) * 0.002;
      pitch = clamp(pitch - Number(message.dy) * 0.002, -1.55, 1.55);
      break;
    case 'control':
      control(message.value);
      break;
    case 'stop':
      stopped = true;
      clearInterval(timer);
      if (reconnect) clearTimeout(reconnect);
      socket?.close();
      break;
  }
};
