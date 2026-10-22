import {
  createArena,
  MAX_FPS_PLAYERS,
  SpawnSelector,
  KinematicController,
  PlayerInput,
  InputRingBuffer,
  InputButtons,
  WeaponController,
  WeaponId,
  WEAPONS,
  FireResult,
  Vec3,
  Quaternion,
  RayHit,
  ObbRaycaster,
  pelletDirection,
  weaponDamage,
  HitZone,
  clamp,
  type ArenaName,
  type GameMode,
} from '@district/rts-shared/fps';
import { WorldHistoryBuffer, POSE_STRIDE } from './History.js';
export enum FpsEvent {
  Shot = 1,
  Hit = 2,
  Kill = 3,
  Respawn = 4,
  Flag = 5,
  Zone = 6,
  Reload = 7,
}
export class EventTape {
  readonly data = new Float64Array(512 * 16);
  count = 0;
  dropped = 0;
  emit(
    kind: number,
    actor: number,
    target: number,
    weapon: number,
    origin: Vec3,
    end: Vec3,
    damage = 0,
    flags = 0,
    tick = 0,
    sequence = 0,
    subTick = 0,
  ): void {
    if (this.count >= 512) {
      this.dropped++;
      return;
    }
    const o = this.count++ * 16;
    this.data[o] = kind;
    this.data[o + 1] = actor;
    this.data[o + 2] = target;
    this.data[o + 3] = weapon;
    this.data[o + 4] = origin.x;
    this.data[o + 5] = origin.y;
    this.data[o + 6] = origin.z;
    this.data[o + 7] = end.x;
    this.data[o + 8] = end.y;
    this.data[o + 9] = end.z;
    this.data[o + 10] = damage;
    this.data[o + 11] = flags;
    this.data[o + 12] = tick;
    this.data[o + 13] = sequence;
    this.data[o + 14] = subTick;
    this.data[o + 15] = 0;
  }
  clear(): void {
    this.count = 0;
    this.dropped = 0;
  }
}
export class FpsPlayer {
  active = false;
  name = '';
  accountId = '';
  sessionKey = '';
  bot = false;
  team = 0;
  hp = 100;
  generation = 0;
  yaw = 0;
  pitch = 0;
  weapon: WeaponId = WeaponId.Vanguard;
  kills = 0;
  deaths = 0;
  score = 0;
  damage = 0;
  headshots = 0;
  shotsFired = 0;
  captures = 0;
  timeOnPoint = 0;
  respawnAt = 0;
  protectedUntil = 0;
  lastProcessed = 0;
  lastAccepted = 0;
  rttMs = 0;
  reactionTicks = 18;
  botTarget = -1;
  botSeen = 0;
  waypoint = 0;
  botDirection = 1;
  stuck = 0;
  lastBotX = 0;
  lastBotZ = 0;
  carrying = -1;
  connected = false;
  readonly input = new PlayerInput();
  readonly queue = new InputRingBuffer();
  readonly receivedTicks = new Float64Array(128);
  readonly controller: KinematicController;
  readonly weapons: WeaponController;
  constructor(
    readonly id: number,
    arena: ReturnType<typeof createArena>,
    seed: number,
  ) {
    this.controller = new KinematicController(arena.world, arena.pads);
    this.weapons = new WeaponController(seed + id);
  }
}
export class GameRoom {
  readonly arena: ReturnType<typeof createArena>;
  readonly players: FpsPlayer[];
  readonly history = new WorldHistoryBuffer(MAX_FPS_PLAYERS);
  readonly events = new EventTape();
  readonly teamScores = new Int32Array(2);
  readonly flagCarrier = new Int16Array(2).fill(-1);
  readonly flagPosition = new Float64Array(6);
  readonly flagDroppedAt = new Int32Array(2).fill(-1);
  readonly flagHome = new Uint8Array(2).fill(1);
  readonly alive = new Uint8Array(MAX_FPS_PLAYERS);
  readonly positions = new Float64Array(MAX_FPS_PLAYERS * 3);
  readonly teams = new Uint8Array(MAX_FPS_PLAYERS);
  tickNumber = 0;
  ended = false;
  winnerId = -1;
  winnerTeam = -1;
  hardpoint = 0;
  private rng: number;
  private spawnSelector = new SpawnSelector();
  private spawn = new Vec3();
  private origin = new Vec3();
  private target = new Vec3();
  private direction = new Vec3();
  private hitPoint = new Vec3();
  private wallHit = new RayHit();
  private exitHit = new RayHit();
  private bodyHit = new RayHit();
  private ray = new ObbRaycaster();
  private center = new Vec3();
  private half = new Vec3();
  private rotation = new Quaternion();
  private pose = new Float64Array(POSE_STRIDE);
  private shot = new FireResult();
  private aim = { ads: false, grounded: true, sliding: false, speed: 0 };
  constructor(
    map: ArenaName,
    readonly mode: GameMode,
    seed: number,
    readonly maxTicks = 28800,
  ) {
    this.arena = createArena(map);
    this.rng = seed >>> 0 || 1;
    this.players = Array.from(
      { length: MAX_FPS_PLAYERS },
      (_, id) => new FpsPlayer(id + 1, this.arena, seed),
    );
    this.flagPosition.set(this.arena.flags);
  }
  random(): number {
    let x = this.rng;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rng = x >>> 0;
    return this.rng;
  }
  add(
    name: string,
    accountId: string,
    sessionKey: string,
    bot = false,
    reactionMs = 300,
  ): FpsPlayer {
    for (let i = 0; i < this.players.length; i++) {
      const existing = this.players[i]!;
      if (existing.active && existing.sessionKey === sessionKey) {
        existing.connected = true;
        return existing;
      }
    }
    let free: FpsPlayer | null = null,
      cyan = 0,
      red = 0;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]!;
      if (!p.active && !free) free = p;
      if (p.active) {
        if (p.team === 0) cyan++;
        else red++;
      }
    }
    if (!free) throw new Error('Lobby piena');
    const p = free;
    p.kills =
      p.deaths =
      p.score =
      p.damage =
      p.headshots =
      p.shotsFired =
      p.captures =
      p.timeOnPoint =
      p.lastProcessed =
      p.lastAccepted =
        0;
    p.queue.clear();
    p.input.copy(new PlayerInput());
    p.weapon = WeaponId.Vanguard;
    p.botTarget = -1;
    p.botSeen = p.stuck = 0;
    p.name = name.slice(0, 32);
    p.accountId = accountId;
    p.sessionKey = sessionKey;
    p.bot = bot;
    p.team = cyan <= red ? 0 : 1;
    p.active = true;
    p.connected = !bot;
    p.reactionTicks = Math.round((clamp(reactionMs, 100, 2000) / 1000) * 60);
    p.waypoint = this.random() % (this.arena.waypoints.length / 3);
    this.teams[p.id - 1] = p.team;
    this.respawn(p);
    this.history.record(this.tickNumber, this.players);
    return p;
  }
  enqueue(player: FpsPlayer, input: PlayerInput, receiveTick = this.tickNumber): void {
    if (!player.active || this.ended) throw new Error('Partita non attiva');
    if (input.sequenceNumber <= player.lastAccepted) throw new Error('Sequenza duplicata');
    if (input.sequenceNumber > player.lastAccepted + 256)
      throw new Error('Sequenza fuori finestra');
    if (player.queue.length >= 120) throw new Error('Input in attesa eccessivi');
    player.queue.push(input);
    player.receivedTicks[input.sequenceNumber & 127] = receiveTick;
    player.lastAccepted = input.sequenceNumber;
  }
  private respawn(player: FpsPlayer): void {
    this.spawnSelector.choose(
      this.spawn,
      this.arena,
      this.positions,
      this.alive,
      this.teams,
      player.team,
      this.mode !== 'ffa',
      this.random(),
    );
    player.controller.reset(this.spawn.x, this.spawn.y, this.spawn.z);
    player.controller.state.tick = this.tickNumber;
    player.hp = 100;
    player.generation++;
    player.yaw = Math.atan2(-this.spawn.x, this.spawn.z);
    player.pitch = 0;
    player.input.yaw = player.yaw;
    player.input.pitch = 0;
    player.input.buttons = 0;
    player.input.moveX = player.input.moveZ = 0;
    player.weapons.reset();
    player.protectedUntil = this.tickNumber + 60;
    player.carrying = -1;
    this.alive[player.id - 1] = 1;
    const o = (player.id - 1) * 3;
    this.positions[o] = this.spawn.x;
    this.positions[o + 1] = this.spawn.y;
    this.positions[o + 2] = this.spawn.z;
    this.events.emit(
      FpsEvent.Respawn,
      player.id,
      0,
      player.weapon,
      this.spawn,
      this.spawn,
      0,
      0,
      this.tickNumber,
    );
  }
  step(): void {
    if (this.ended) return;
    this.tickNumber++;
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]!;
      if (!p.active) continue;
      if (p.hp <= 0) {
        if (this.tickNumber >= p.respawnAt) this.respawn(p);
        else continue;
      }
      if (p.bot) this.brain(p);
      else {
        while (p.queue.length > 5) p.queue.acknowledge(p.queue.at(0).sequenceNumber);
        if (p.queue.length) {
          p.input.copy(p.queue.at(0));
          p.queue.acknowledge(p.input.sequenceNumber);
          p.lastProcessed = p.input.sequenceNumber;
        }
      }
      p.weapon =
        p.carrying >= 0 && p.input.weapon !== WeaponId.Karambit ? WeaponId.Sheriff : p.input.weapon;
      p.yaw = p.input.yaw;
      p.pitch = p.input.pitch;
      const state = p.controller.state;
      p.controller.step(p.input, WEAPONS[p.weapon]!.movementMultiplier);
      state.tick = this.tickNumber;
      if (
        state.position.y < -12 ||
        Math.abs(state.position.x) > 48 ||
        Math.abs(state.position.z) > 38
      ) {
        this.kill(p, null);
        continue;
      }
      const o = i * 3;
      this.positions[o] = state.position.x;
      this.positions[o + 1] = state.position.y;
      this.positions[o + 2] = state.position.z;
    }
    this.history.record(this.tickNumber, this.players);
    for (let i = 0; i < this.players.length; i++) {
      const p = this.players[i]!;
      if (!p.active || p.hp <= 0) continue;
      const now = this.tickNumber / 60;
      p.weapons.update(now, 1 / 60);
      if (p.input.buttons & InputButtons.Reload) {
        if (p.weapons.reload(p.weapon, now))
          this.events.emit(
            FpsEvent.Reload,
            p.id,
            0,
            p.weapon,
            p.controller.state.position,
            p.controller.state.position,
            0,
            0,
            this.tickNumber,
          );
      }
      this.aim.ads = !!(p.input.buttons & InputButtons.Ads);
      this.aim.grounded = p.controller.state.grounded;
      this.aim.sliding = p.controller.state.sliding;
      this.aim.speed = Math.hypot(p.controller.state.velocity.x, p.controller.state.velocity.z);
      if (
        p.weapons.trigger(
          this.shot,
          p.weapon,
          now,
          !!(p.input.buttons & InputButtons.Fire),
          this.aim,
        )
      ) {
        p.protectedUntil = this.tickNumber;
        p.shotsFired++;
        this.shoot(p);
      }
    }
    if (this.mode === 'ctf') this.flags();
    if (this.mode === 'hardpoint') this.zone();
    if (this.tickNumber >= this.maxTicks && !this.ended) {
      if (this.mode === 'ffa') {
        let best = -1;
        for (let i = 0; i < this.players.length; i++)
          if (
            this.players[i]!.active &&
            (best < 0 || this.players[i]!.kills > this.players[best]!.kills)
          )
            best = i;
        this.winnerId = best + 1;
      } else this.winnerTeam = this.teamScores[0]! >= this.teamScores[1]! ? 0 : 1;
      this.ended = true;
    }
  }
  private kill(victim: FpsPlayer, killer: FpsPlayer | null): void {
    if (victim.hp <= 0) return;
    victim.hp = 0;
    victim.queue.clear();
    victim.lastProcessed = victim.lastAccepted;
    victim.input.buttons = 0;
    victim.deaths++;
    victim.respawnAt = this.tickNumber + 90;
    this.alive[victim.id - 1] = 0;
    victim.controller.state.velocity.set(0, 0, 0);
    if (victim.carrying >= 0) {
      const flag = victim.carrying,
        o = flag * 3,
        pos = victim.controller.state.position;
      this.flagCarrier[flag] = -1;
      this.flagDroppedAt[flag] = this.tickNumber;
      this.flagPosition[o] = pos.x;
      this.flagPosition[o + 1] = pos.y;
      this.flagPosition[o + 2] = pos.z;
      victim.carrying = -1;
    }
    if (killer) {
      killer.kills++;
      killer.score += 100;
      if (this.mode === 'ffa' && killer.kills >= 25) {
        this.winnerId = killer.id;
        this.ended = true;
      }
      if (this.mode === 'tdm') {
        this.teamScores[killer.team] = this.teamScores[killer.team]! + 1;
        if (this.teamScores[killer.team]! >= 50) {
          this.winnerTeam = killer.team;
          this.ended = true;
        }
      }
    }
    this.events.emit(
      FpsEvent.Kill,
      killer?.id ?? 0,
      victim.id,
      killer?.weapon ?? 0,
      victim.controller.state.position,
      victim.controller.state.position,
      0,
      0,
      this.tickNumber,
    );
  }
  private shoot(shooter: FpsPlayer): void {
    const state = shooter.controller.state;
    this.origin.copy(state.position);
    this.origin.y += state.eyeHeight;
    const weapon = WEAPONS[shooter.weapon]!;
    const receive = shooter.bot
        ? this.tickNumber
        : shooter.receivedTicks[shooter.input.sequenceNumber & 127]!,
      time = clamp(
        receive - (shooter.rttMs / 1000) * 30 - 6 + shooter.input.subTickFraction,
        Math.max(0, this.tickNumber - 63),
        this.tickNumber,
      );
    for (let pellet = 0; pellet < weapon.pellets; pellet++) {
      pelletDirection(this.direction, shooter.yaw, shooter.pitch, this.shot, pellet);
      let best = shooter.weapon === WeaponId.Karambit ? 2.6 : 250,
        victim: FpsPlayer | null = null,
        zone = HitZone.Chest;
      for (let id = 0; id < this.players.length; id++) {
        const p = this.players[id]!;
        if (
          !p.active ||
          p.hp <= 0 ||
          p === shooter ||
          (this.mode !== 'ffa' && p.team === shooter.team) ||
          p.protectedUntil > this.tickNumber
        )
          continue;
        if (!this.history.sample(this.pose, id, time, p.generation)) continue;
        for (let box = 0; box < 6; box++) {
          const o = box * 10;
          this.center.set(this.pose[o]!, this.pose[o + 1]!, this.pose[o + 2]!);
          this.half.set(this.pose[o + 3]!, this.pose[o + 4]!, this.pose[o + 5]!);
          this.rotation.set(
            this.pose[o + 6]!,
            this.pose[o + 7]!,
            this.pose[o + 8]!,
            this.pose[o + 9]!,
          );
          if (
            this.ray.cast(
              this.bodyHit,
              this.origin,
              this.direction,
              this.center,
              this.half,
              this.rotation,
              best,
            ) &&
            this.bodyHit.distance < best
          ) {
            best = this.bodyHit.distance;
            victim = p;
            zone =
              box === 0
                ? HitZone.Head
                : box === 1
                  ? HitZone.Chest
                  : box === 2
                    ? HitZone.Stomach
                    : HitZone.Limbs;
          }
        }
      }
      let multiplier = 1,
        blocked = false,
        travel = 0,
        penetration = weapon.penetration;
      this.target.copy(this.origin);
      for (let layer = 0; layer <= 4; layer++) {
        if (!this.arena.world.raycast(this.wallHit, this.target, this.direction, best - travel))
          break;
        this.hitPoint.copy(this.wallHit.point);
        if (penetration <= 0 || layer === 4) {
          best = travel + this.wallHit.distance;
          blocked = true;
          break;
        }
        this.center.copy(this.wallHit.point).addScaled(this.direction, 0.002);
        if (!this.arena.world.raycast(this.exitHit, this.center, this.direction, penetration)) {
          best = travel + this.wallHit.distance;
          blocked = true;
          break;
        }
        const thickness = this.exitHit.distance + 0.002;
        if (thickness > penetration) {
          best = travel + this.wallHit.distance;
          blocked = true;
          break;
        }
        travel += this.wallHit.distance + thickness + 0.002;
        penetration -= thickness;
        multiplier *= 0.65;
        this.target.copy(this.exitHit.point).addScaled(this.direction, 0.002);
        if (travel >= best) break;
      }
      this.hitPoint.copy(this.origin).addScaled(this.direction, best);
      this.events.emit(
        FpsEvent.Shot,
        shooter.id,
        blocked ? 0 : (victim?.id ?? 0),
        shooter.weapon,
        this.origin,
        this.hitPoint,
        0,
        0,
        this.tickNumber,
        shooter.lastProcessed,
        shooter.input.subTickFraction,
      );
      if (victim && !blocked) {
        let damage = weaponDamage(weapon, zone, best) * multiplier;
        if (shooter.weapon === WeaponId.Karambit) {
          const vx = shooter.controller.state.position.x - victim.controller.state.position.x,
            vz = shooter.controller.state.position.z - victim.controller.state.position.z;
          damage = vx * Math.sin(victim.yaw) + vz * -Math.cos(victim.yaw) < 0 ? 200 : 100;
        }
        damage = Math.min(victim.hp, Math.round(damage));
        victim.hp -= damage;
        shooter.damage += damage;
        shooter.score += damage;
        if (zone === HitZone.Head) shooter.headshots++;
        const killed = victim.hp <= 0;
        this.events.emit(
          FpsEvent.Hit,
          shooter.id,
          victim.id,
          shooter.weapon,
          this.origin,
          this.hitPoint,
          damage,
          (zone === HitZone.Head ? 1 : 0) | (killed ? 2 : 0),
          this.tickNumber,
          shooter.lastProcessed,
          shooter.input.subTickFraction,
        );
        this.events.data[(this.events.count - 1) * 16 + 15] = zone;
        if (killed) {
          victim.hp = 1;
          this.kill(victim, shooter);
        }
      }
    }
  }
  private flags(): void {
    for (let flag = 0; flag < 2; flag++) {
      const carrier = this.flagCarrier[flag]!,
        o = flag * 3;
      if (carrier >= 0) {
        const player = this.players[carrier]!,
          p = player.controller.state.position;
        this.flagPosition[o] = p.x;
        this.flagPosition[o + 1] = p.y;
        this.flagPosition[o + 2] = p.z;
        const home = player.team * 3;
        if (
          this.flagHome[player.team] &&
          Math.hypot(p.x - this.arena.flags[home]!, p.z - this.arena.flags[home + 2]!) < 2.3
        ) {
          player.captures++;
          player.score += 500;
          this.teamScores[player.team] = this.teamScores[player.team]! + 1;
          this.returnFlag(flag);
          if (this.teamScores[player.team]! >= 3) {
            this.winnerTeam = player.team;
            this.ended = true;
          }
        }
        continue;
      }
      if (this.flagDroppedAt[flag]! >= 0 && this.tickNumber - this.flagDroppedAt[flag]! >= 900)
        this.returnFlag(flag);
      for (let id = 0; id < this.players.length; id++) {
        const p = this.players[id]!;
        if (!p.active || p.hp <= 0) continue;
        const pos = p.controller.state.position;
        if (
          Math.hypot(pos.x - this.flagPosition[o]!, pos.z - this.flagPosition[o + 2]!) > 1.8 ||
          Math.abs(pos.y - this.flagPosition[o + 1]!) > 2
        )
          continue;
        if (p.team === flag) {
          if (!this.flagHome[flag]) this.returnFlag(flag);
        } else if (p.carrying < 0) {
          p.carrying = flag;
          this.flagCarrier[flag] = id;
          this.flagHome[flag] = 0;
          this.flagDroppedAt[flag] = -1;
          this.events.emit(FpsEvent.Flag, p.id, flag, 0, pos, pos, 0, 1, this.tickNumber);
          break;
        }
      }
    }
  }
  private returnFlag(flag: number): void {
    this.flagCarrier[flag] = -1;
    this.flagHome[flag] = 1;
    this.flagDroppedAt[flag] = -1;
    for (let n = 0; n < 3; n++) this.flagPosition[flag * 3 + n] = this.arena.flags[flag * 3 + n]!;
    for (let i = 0; i < this.players.length; i++)
      if (this.players[i]!.carrying === flag) this.players[i]!.carrying = -1;
  }
  private zone(): void {
    this.hardpoint = Math.floor(this.tickNumber / 2700) % (this.arena.hardpoints.length / 3);
    const o = this.hardpoint * 3;
    let cyan = 0,
      red = 0;
    for (let id = 0; id < this.players.length; id++) {
      const p = this.players[id]!;
      if (!p.active || p.hp <= 0) continue;
      const pos = p.controller.state.position;
      if (
        Math.hypot(pos.x - this.arena.hardpoints[o]!, pos.z - this.arena.hardpoints[o + 2]!) < 5 &&
        Math.abs(pos.y - this.arena.hardpoints[o + 1]!) < 2
      ) {
        if (p.team === 0) cyan++;
        else red++;
      }
    }
    if (this.tickNumber % 60 === 0 && !!cyan !== !!red) {
      const team = cyan ? 0 : 1;
      this.teamScores[team] = this.teamScores[team]! + 1;
      for (let id = 0; id < this.players.length; id++) {
        const p = this.players[id]!;
        if (
          p.active &&
          p.hp > 0 &&
          p.team === team &&
          Math.hypot(
            p.controller.state.position.x - this.arena.hardpoints[o]!,
            p.controller.state.position.z - this.arena.hardpoints[o + 2]!,
          ) < 5
        ) {
          p.timeOnPoint++;
          p.score += 10;
        }
      }
      if (this.teamScores[team]! >= 150) {
        this.winnerTeam = team;
        this.ended = true;
      }
    }
  }
  private brain(p: FpsPlayer): void {
    const input = p.input,
      pos = p.controller.state.position;
    input.sequenceNumber++;
    input.clientTick = this.tickNumber;
    input.weapon = p.weapon;
    input.subTickFraction = 0.5;
    input.buttons = InputButtons.Sprint;
    let nearest = Infinity,
      target = -1;
    for (let id = 0; id < this.players.length; id++) {
      const other = this.players[id]!;
      if (
        !other.active ||
        other.hp <= 0 ||
        other === p ||
        (this.mode !== 'ffa' && other.team === p.team)
      )
        continue;
      const otherPos = other.controller.state.position,
        d = Math.hypot(otherPos.x - pos.x, otherPos.z - pos.z);
      if (d >= nearest) continue;
      this.origin.copy(pos);
      this.origin.y += 1.5;
      this.direction
        .set(otherPos.x - pos.x, otherPos.y + 1.2 - this.origin.y, otherPos.z - pos.z)
        .normalize();
      if (!this.arena.world.raycast(this.wallHit, this.origin, this.direction, d - 0.3)) {
        nearest = d;
        target = id;
      }
    }
    if (target !== p.botTarget) {
      p.botTarget = target;
      p.botSeen = this.tickNumber;
    }
    if (target >= 0) {
      const other = this.players[target]!,
        op = other.controller.state.position,
        dx = op.x - pos.x,
        dz = op.z - pos.z;
      input.yaw = Math.atan2(dx, -dz);
      input.pitch = Math.atan2(
        op.y + 1.25 - (pos.y + p.controller.state.eyeHeight),
        Math.hypot(dx, dz),
      );
      input.moveX = Math.floor(this.tickNumber / 45 + p.id) % 2 ? 1 : -1;
      input.moveZ = nearest > 12 ? 1 : nearest < 6 ? -1 : 0;
      if (this.tickNumber - p.botSeen >= p.reactionTicks) input.buttons |= InputButtons.Fire;
      if (p.weapons.ammo[p.weapon] === 0) input.buttons |= InputButtons.Reload;
    } else {
      let o = p.waypoint * 3;
      let dx = this.arena.waypoints[o]! - pos.x,
        dz = this.arena.waypoints[o + 2]! - pos.z;
      if (Math.hypot(dx, dz) < 2 || p.stuck > 45) {
        p.waypoint =
          (p.waypoint + 7 + (this.random() % 3) - 1 + this.arena.waypoints.length / 3) %
          (this.arena.waypoints.length / 3);
        p.stuck = 0;
        o = p.waypoint * 3;
        dx = this.arena.waypoints[o]! - pos.x;
        dz = this.arena.waypoints[o + 2]! - pos.z;
      }
      input.yaw = Math.atan2(dx, -dz);
      input.pitch = 0;
      input.moveZ = 1;
      input.moveX = p.stuck > 12 ? (p.id % 2 ? 1 : -1) : 0;
    }
    if (this.tickNumber % 90 === p.id * 3) input.buttons |= InputButtons.Jump;
    if (
      this.tickNumber % 120 > 88 ||
      (this.arena.name === 'sandstorm' && Math.abs(pos.x) < 6 && Math.abs(pos.z) < 14)
    )
      input.buttons |= InputButtons.Crouch;
    if (Math.hypot(pos.x - p.lastBotX, pos.z - p.lastBotZ) < 0.01) p.stuck++;
    else p.stuck = 0;
    p.lastBotX = pos.x;
    p.lastBotZ = pos.z;
    p.lastProcessed = input.sequenceNumber;
  }
}
