import {
  BALANCE,
  CommandKind,
  MAX_PLAYERS,
  MAX_RESOURCE,
  TICK_MS,
  UINT32_MAX,
  commandSchema,
  compareCommands,
  encodeCommands,
  type CommandRejection,
  type EngineEvent,
  type GameCommand,
  type CommandPayload,
  type PlayerState,
  type TickResult,
} from '@district/rts-shared';
import { WorldSystem } from './WorldSystem.js';
import type { WorldSnapshot } from './world-types.js';
import { GameMap, type MapSnapshot } from './GameMap.js';
import { AttackExecution, type AttackSnapshot, type AttackHost } from './AttackExecution.js';
import { Mulberry32, assertInteger } from './prng.js';
import { StateHasher } from './hash.js';
import type { MutablePlayer, PlayerSetup, SerializedPlayer } from './state.js';
export interface EngineConfig {
  readonly map: GameMap;
  readonly seed: number;
  readonly players: readonly PlayerSetup[];
  readonly bots?: readonly number[];
}
export interface EngineSnapshot {
  readonly version: 2;
  readonly world: WorldSnapshot;
  readonly tick: number;
  readonly rngState: number;
  readonly nextAttackId: number;
  readonly winnerId: number | null;
  readonly map: MapSnapshot;
  readonly players: readonly SerializedPlayer[];
  readonly attacks: readonly AttackSnapshot[];
  readonly commands: readonly GameCommand[];
  readonly sequences: readonly (readonly [number, number])[];
}
export type LegacyEngineSnapshot = Omit<EngineSnapshot, 'version' | 'world'> & {
  readonly version: 1;
};
export type EnqueueResult =
  { readonly accepted: true } | { readonly accepted: false; readonly reason: CommandRejection };
const allocationOf = (troops: number, bps: number): number =>
  Number((BigInt(troops) * BigInt(bps)) / 10_000n);
export function growTroops(troops: number, cap: number): number {
  assertInteger(troops, 0, MAX_RESOURCE, 'troops');
  assertInteger(cap, 0, MAX_RESOURCE, 'troop cap');
  if (cap === 0) return 0;
  if (troops >= cap) return cap;
  const population = BigInt(troops),
    maximum = BigInt(cap);
  const growth = Number(
    (4n * population * (maximum - population) * BigInt(BALANCE.growthBasisPointsPerTick)) /
      (maximum * 10_000n),
  );
  return Math.min(cap, troops + Math.max(1, growth));
}
export class GameEngine implements AttackHost {
  readonly map: GameMap;
  readonly rng: Mulberry32;
  private readonly states = new Map<number, MutablePlayer>();
  private readonly attacks = new Map<number, AttackExecution>();
  private readonly commands: GameCommand[] = [];
  private readonly sequences = new Map<number, number>();
  private nextAttackId = 1;
  private tickNumber = 0;
  private winner: number | null = null;
  private readonly world: WorldSystem;
  constructor(config: EngineConfig) {
    this.map = config.map;
    this.rng = new Mulberry32(config.seed);
    if (config.players.length < 1 || config.players.length > MAX_PLAYERS)
      throw new RangeError('Invalid player count');
    const setups = [...config.players].sort((a, b) => a.id - b.id);
    // Validate before placing any spawn so invalid configuration cannot partially claim the map.
    for (const setup of setups) {
      assertInteger(setup.id, 1, MAX_PLAYERS, 'player ID');
      if (this.states.has(setup.id)) throw new RangeError('Duplicate player ID');
      if (
        typeof setup.name !== 'string' ||
        setup.name.trim().length === 0 ||
        setup.name.length > 32
      )
        throw new RangeError('Invalid player name');
      assertInteger(
        setup.initialTroops ?? BALANCE.initialTroops,
        0,
        MAX_RESOURCE,
        'initial troops',
      );
      assertInteger(setup.initialGold ?? BALANCE.initialGold, 0, MAX_RESOURCE, 'initial gold');
      assertInteger(setup.cityLevels ?? 0, 0, 1_000_000, 'city levels');
      assertInteger(setup.spawnRadius ?? 1, 0, 8, 'spawn radius');
      if (setup.spawnTile !== undefined) {
        this.map.assertTile(setup.spawnTile);
        if (!this.map.isLand(setup.spawnTile)) throw new RangeError('Spawn must be on land');
      }
      this.states.set(setup.id, {
        id: setup.id,
        name: setup.name,
        troops: 0,
        maxTroops: 0,
        gold: setup.initialGold ?? BALANCE.initialGold,
        landSize: 0,
        cityLevels: setup.cityLevels ?? 0,
        alliances: new Set(setup.alliances ?? []),
        eliminated: false,
      });
    }
    for (const state of this.states.values()) {
      for (const ally of state.alliances)
        if (ally === state.id || !this.states.get(ally)?.alliances.has(state.id))
          throw new RangeError('Initial alliances must be valid and reciprocal');
    }
    for (let tile = 0; tile < this.map.length; tile++)
      if (this.map.ownerId[tile]! > 0 && !this.states.has(this.map.ownerId[tile]!))
        throw new RangeError('Map contains an unknown player');
    if (config.bots && new Set(config.bots).size !== config.bots.length)
      throw new RangeError('Duplicate bot ID');
    for (const id of config.bots ?? [])
      if (!this.states.has(id)) throw new RangeError('Unknown bot');
    const claims = new Map<number, number>();
    for (const setup of setups)
      if (setup.spawnTile !== undefined) {
        const radius = setup.spawnRadius ?? 1,
          cx = this.map.x(setup.spawnTile),
          cy = this.map.y(setup.spawnTile);
        for (let dy = -radius; dy <= radius; dy++)
          for (let dx = -radius; dx <= radius; dx++) {
            const x = cx + dx,
              y = cy + dy;
            if (
              dx * dx + dy * dy > radius * radius ||
              x < 0 ||
              y < 0 ||
              x >= this.map.width ||
              y >= this.map.height
            )
              continue;
            const tile = y * this.map.width + x;
            if (!this.map.isLand(tile)) continue;
            if (claims.has(tile) || this.map.ownerId[tile] !== 0)
              throw new RangeError('Overlapping spawn territory');
            claims.set(tile, setup.id);
          }
      }
    for (const [tile, owner] of claims) this.map.setOwner(tile, owner);
    for (const setup of setups) {
      const state = this.states.get(setup.id)!;
      this.refreshPlayer(state);
      state.troops = Math.min(state.maxTroops, setup.initialTroops ?? BALANCE.initialTroops);
    }
    this.world = new WorldSystem(this, config.bots ?? []);
  }
  nextCommandSequence(playerId: number): number {
    if (!this.states.has(playerId)) throw new RangeError('Unknown player');
    const next = (this.sequences.get(playerId) ?? -1) + 1;
    if (next > UINT32_MAX) throw new RangeError('Command sequence exhausted');
    return next;
  }
  playerIds(): readonly number[] {
    return [...this.states.keys()];
  }
  activeAttacksFor(id: number): number {
    return [...this.attacks.values()].filter((a) => a.attackerId === id).length;
  }
  getWorldSnapshot(): WorldSnapshot {
    return this.world.snapshot();
  }
  issueBotCommand(playerId: number, command: CommandPayload): void {
    const sequence = (this.sequences.get(playerId) ?? -1) + 1;
    if (sequence <= UINT32_MAX && this.tickNumber < UINT32_MAX)
      this.enqueue({
        ...command,
        playerId,
        sequence,
        executeTick: this.tickNumber + 1,
      });
  }
  get currentTick(): number {
    return this.tickNumber;
  }
  get elapsedMs(): number {
    return this.tickNumber * TICK_MS;
  }
  get winnerId(): number | null {
    return this.winner;
  }
  get activeAttackCount(): number {
    return this.attacks.size;
  }
  getPlayer(id: number): PlayerState | undefined {
    const p = this.states.get(id);
    return p ? { ...p, alliances: new Set(p.alliances) } : undefined;
  }
  getPlayers(): readonly PlayerState[] {
    return [...this.states.keys()].map((id) => this.getPlayer(id)!);
  }
  getAttacks(): readonly AttackSnapshot[] {
    return [...this.attacks.values()].map((attack) => attack.snapshot());
  }
  /** Internal simulation access; external consumers should use getPlayer(). */
  player(id: number): MutablePlayer | undefined {
    return this.states.get(id);
  }
  enqueue(input: GameCommand): EnqueueResult {
    const command = commandSchema.parse(input);
    if (this.winner !== null) return { accepted: false, reason: 'MATCH_FINISHED' };
    const state = this.states.get(command.playerId);
    if (!state) return { accepted: false, reason: 'UNKNOWN_PLAYER' };
    if (state.eliminated) return { accepted: false, reason: 'ELIMINATED' };
    if (command.executeTick <= this.tickNumber) return { accepted: false, reason: 'STALE_TICK' };
    if (command.executeTick - this.tickNumber > BALANCE.maxInputLeadTicks)
      return { accepted: false, reason: 'TICK_TOO_FAR' };
    if (command.sequence <= (this.sequences.get(command.playerId) ?? -1))
      return { accepted: false, reason: 'DUPLICATE_SEQUENCE' };
    if (
      this.commands.length >= BALANCE.maxQueuedCommands ||
      this.commands.filter((c) => c.playerId === command.playerId).length >=
        BALANCE.maxQueuedCommandsPerPlayer
    )
      return { accepted: false, reason: 'QUEUE_FULL' };
    this.commands.push(command);
    this.sequences.set(command.playerId, command.sequence);
    return { accepted: true };
  }
  tick(): TickResult {
    if (this.winner !== null) throw new Error('Match has already finished');
    if (this.tickNumber === UINT32_MAX) throw new RangeError('Tick counter exhausted');
    this.tickNumber++;
    const events: EngineEvent[] = [];
    this.world.beginTick(events);
    for (const player of this.states.values()) {
      this.refreshPlayer(player);
      if (!player.eliminated) player.troops = growTroops(player.troops, player.maxTroops);
    }
    this.commands.sort(compareCommands);
    while (this.commands[0]?.executeTick === this.tickNumber) {
      const command = this.commands.shift()!;
      const reason = this.execute(command, events);
      if (reason)
        events.push({
          kind: 'commandRejected',
          playerId: command.playerId,
          sequence: command.sequence,
          reason,
        });
    }
    for (const attack of this.attacks.values())
      if (attack.step(this)) this.endAttack(attack, events);
    this.world.advance();
    for (const player of this.states.values()) {
      const wasEliminated = player.eliminated;
      this.refreshPlayer(player);
      if (!wasEliminated && player.eliminated)
        events.push({ kind: 'playerEliminated', playerId: player.id });
      if (
        this.winner === null &&
        !player.eliminated &&
        this.map.totalLandTiles > 0 &&
        player.landSize * 100 >= this.map.totalLandTiles * BALANCE.victoryPercent
      ) {
        this.winner = player.id;
        events.push({ kind: 'victory', playerId: player.id });
      }
    }
    return {
      tick: this.tickNumber,
      elapsedMs: this.elapsedMs,
      events,
      dirtyTiles: this.map.consumeDirtyTiles(),
      winnerId: this.winner,
    };
  }
  tileCost(index: number): number {
    const base = Math.ceil((BALANCE.baseTileCost * (255 + this.map.elevation[index]!)) / 255);
    const owner = this.map.ownerId[index]!;
    const defender = this.states.get(owner);
    const resistance = defender
      ? Math.ceil(defender.troops / Math.max(1, this.map.landSize(owner)))
      : 0;
    return Math.min(
      MAX_RESOURCE,
      (base + resistance) *
        (owner > 0 && this.map.defenseCoverage[index]! > 0 ? BALANCE.defenseCostMultiplier : 1),
    );
  }
  capture(index: number, attackerId: number): void {
    const oldOwner = this.map.ownerId[index]!,
      defender = this.states.get(oldOwner);
    if (defender)
      defender.troops = Math.max(
        0,
        defender.troops - Math.ceil(defender.troops / Math.max(1, this.map.landSize(oldOwner))),
      );
    this.map.setOwner(index, attackerId);
    this.world.onOwnerChanged(index, attackerId);
    this.world.flushCoverage();
    for (const attack of this.attacks.values())
      if (attack.attackerId === attackerId) attack.addNeighbors(this.map, index);
  }
  snapshot(): EngineSnapshot {
    return {
      version: 2,
      world: this.world.snapshot(),
      tick: this.tickNumber,
      rngState: this.rng.getState(),
      nextAttackId: this.nextAttackId,
      winnerId: this.winner,
      map: this.map.snapshot(),
      players: [...this.states.values()].map((p) => ({
        id: p.id,
        name: p.name,
        troops: p.troops,
        gold: p.gold,
        cityLevels: p.cityLevels,
        alliances: [...p.alliances].sort((a, b) => a - b),
      })),
      attacks: this.getAttacks(),
      commands: this.commands.map((command) => ({ ...command })).sort(compareCommands),
      sequences: [...this.sequences.entries()].sort((a, b) => a[0] - b[0]),
    };
  }
  static fromSnapshot(snapshot: EngineSnapshot | LegacyEngineSnapshot): GameEngine {
    if (snapshot.version !== 1 && snapshot.version !== 2)
      throw new RangeError('Unsupported engine snapshot');
    assertInteger(snapshot.tick, 0, UINT32_MAX, 'snapshot tick');
    assertInteger(snapshot.nextAttackId, 1, UINT32_MAX, 'next attack ID');
    const map = new GameMap(snapshot.map.width, snapshot.map.height, snapshot.map);
    const engine = new GameEngine({
      map,
      seed: snapshot.rngState,
      players: snapshot.players.map((p) => ({
        id: p.id,
        name: p.name,
        initialTroops: 0,
        initialGold: p.gold,
        cityLevels: p.cityLevels,
        alliances: p.alliances,
      })),
    });
    engine.tickNumber = snapshot.tick;
    engine.nextAttackId = snapshot.nextAttackId;
    if (snapshot.winnerId !== null && !engine.states.has(snapshot.winnerId))
      throw new RangeError('Unknown snapshot winner');
    engine.winner = snapshot.winnerId;
    if (
      engine.winner !== null &&
      engine.map.landSize(engine.winner) * 100 < engine.map.totalLandTiles * BALANCE.victoryPercent
    )
      throw new RangeError('Invalid snapshot victory');
    for (const [id, sequence] of snapshot.sequences) {
      if (!engine.states.has(id) || engine.sequences.has(id))
        throw new RangeError('Invalid snapshot sequence owner');
      assertInteger(sequence, 0, UINT32_MAX, 'snapshot sequence');
      engine.sequences.set(id, sequence);
    }
    if (snapshot.commands.length > BALANCE.maxQueuedCommands)
      throw new RangeError('Snapshot command queue too large');
    const pending = new Set<string>();
    const queuedCounts = new Map<number, number>();
    for (const input of snapshot.commands) {
      const command = commandSchema.parse(input),
        key = `${command.playerId}:${command.sequence}`;
      if (
        !engine.states.has(command.playerId) ||
        command.executeTick <= snapshot.tick ||
        command.executeTick - snapshot.tick > BALANCE.maxInputLeadTicks ||
        command.sequence > (engine.sequences.get(command.playerId) ?? -1) ||
        pending.has(key)
      )
        throw new RangeError('Invalid queued snapshot command');
      pending.add(key);
      const count = (queuedCounts.get(command.playerId) || 0) + 1;
      if (count > BALANCE.maxQueuedCommandsPerPlayer)
        throw new RangeError('Too many queued player commands');
      queuedCounts.set(command.playerId, count);
      engine.commands.push(command);
    }
    if (snapshot.attacks.length > MAX_PLAYERS * BALANCE.maxAttacksPerPlayer)
      throw new RangeError('Too many snapshot attacks');
    for (const attack of snapshot.attacks) {
      assertInteger(attack.id, 1, snapshot.nextAttackId - 1, 'attack ID');
      assertInteger(attack.targetOwnerId, 0, MAX_PLAYERS, 'target owner');
      map.assertTile(attack.targetTile);
      assertInteger(attack.committed, 1, MAX_RESOURCE, 'committed troops');
      assertInteger(attack.troops, 0, attack.committed, 'attack troops');
      assertInteger(attack.createdTick, 0, snapshot.tick, 'attack start tick');
      assertInteger(attack.captured, 0, MAX_RESOURCE, 'captured tiles');
      if (
        !engine.states.has(attack.attackerId) ||
        attack.targetOwnerId === attack.attackerId ||
        (attack.targetOwnerId > 0 && !engine.states.has(attack.targetOwnerId)) ||
        engine.attacks.has(attack.id) ||
        !(attack.frontier instanceof Uint32Array) ||
        attack.frontier.length > map.length
      )
        throw new RangeError('Invalid snapshot attack');
      if (new Set(attack.frontier).size !== attack.frontier.length)
        throw new RangeError('Duplicate frontier entries');
      for (const tile of attack.frontier) map.assertTile(tile);
      const restored = new AttackExecution(
        attack.id,
        attack.attackerId,
        attack.targetOwnerId,
        attack.targetTile,
        attack.committed,
        attack.createdTick,
      );
      restored.restore(attack);
      engine.attacks.set(attack.id, restored);
    }
    if (engine.attacks.size > MAX_PLAYERS * BALANCE.maxAttacksPerPlayer)
      throw new RangeError('Too many snapshot attacks');
    for (const player of engine.states.values())
      if (
        [...engine.attacks.values()].filter((a) => a.attackerId === player.id).length >
        BALANCE.maxAttacksPerPlayer
      )
        throw new RangeError('Too many player attacks');
    if (snapshot.version === 2) engine.world.restore(snapshot.world);
    for (const saved of snapshot.players) {
      const player = engine.states.get(saved.id)!;
      if (player.cityLevels !== saved.cityLevels) throw new RangeError('City level mismatch');
      engine.refreshPlayer(player);
      assertInteger(saved.troops, 0, player.maxTroops, 'snapshot troops');
      player.troops = saved.troops;
    }
    // Restored renderers request a full initial map; diagnostic hash excludes dirty transport metadata.
    return engine;
  }
  stateHash(): number {
    const hash = new StateHasher()
      .uint32(this.tickNumber)
      .uint32(this.rng.getState())
      .uint32(this.nextAttackId)
      .uint16(this.winner ?? 0)
      .uint32(this.map.width)
      .uint32(this.map.height);
    for (let tile = 0; tile < this.map.length; tile++)
      hash
        .byte(this.map.terrainType[tile]!)
        .byte(this.map.elevation[tile]!)
        .uint16(this.map.ownerId[tile]!)
        .byte(this.map.isBorder[tile]!)
        .uint32(this.map.buildingId[tile]!)
        .byte(this.map.defenseCoverage[tile]!)
        .uint32(this.map.contaminationUntil[tile]!);
    hash.uint16(this.states.size);
    for (const p of this.states.values()) {
      hash
        .uint16(p.id)
        .text(p.name)
        .integer(p.troops)
        .integer(p.maxTroops)
        .integer(p.gold)
        .uint32(p.landSize)
        .uint32(p.cityLevels)
        .byte(Number(p.eliminated));
      const allies = [...p.alliances].sort((a, b) => a - b);
      hash.uint16(allies.length);
      for (const id of allies) hash.uint16(id);
    }
    const attacks = [...this.attacks.values()].sort((a, b) => a.id - b.id);
    hash.uint16(attacks.length);
    for (const attack of attacks) {
      const a = attack.snapshot();
      hash
        .uint32(a.id)
        .uint16(a.attackerId)
        .uint16(a.targetOwnerId)
        .uint32(a.targetTile)
        .integer(a.troops)
        .integer(a.committed)
        .integer(a.captured)
        .uint32(a.createdTick)
        .uint32(a.frontier.length);
      for (const tile of a.frontier) hash.uint32(tile);
    }
    const sequences = [...this.sequences.entries()].sort((a, b) => a[0] - b[0]);
    hash.uint16(sequences.length);
    for (const [id, value] of sequences) hash.uint16(id).uint32(value);
    for (const byte of new Uint8Array(encodeCommands([...this.commands].sort(compareCommands))))
      hash.byte(byte);
    this.world.hash(hash);
    return hash.finish();
  }

  neutralize(tile: number): void {
    if (this.map.ownerId[tile] !== 0) this.map.setOwner(tile, 0);
    this.world.onOwnerChanged(tile, 0);
  }
  startLandingAttack(
    playerId: number,
    tile: number,
    troops: number,
    events: EngineEvent[],
  ): boolean {
    const player = this.states.get(playerId);
    if (
      !player ||
      player.eliminated ||
      this.map.contaminationUntil[tile]! > this.tickNumber ||
      this.activeAttacksFor(playerId) >= BALANCE.maxAttacksPerPlayer ||
      this.nextAttackId >= UINT32_MAX
    )
      return false;
    const targetOwner = this.map.ownerId[tile]!;
    if (targetOwner === playerId || player.alliances.has(targetOwner)) return false;
    const cost = this.tileCost(tile);
    if (cost > troops) return false;
    const attack = new AttackExecution(
      this.nextAttackId++,
      playerId,
      targetOwner,
      tile,
      troops,
      this.tickNumber,
    );
    attack.troops -= cost;
    attack.captured = 1;
    this.attacks.set(attack.id, attack);
    this.capture(tile, playerId);
    attack.seed(this.map);
    events.push({
      kind: 'attackStarted',
      attackId: attack.id,
      playerId,
      targetOwnerId: targetOwner,
      troops,
    });
    return true;
  }

  private refreshPlayer(player: MutablePlayer): void {
    player.landSize = this.map.landSize(player.id);
    player.maxTroops = Math.min(
      MAX_RESOURCE,
      player.landSize * BALANCE.baseTroopsPerTile +
        (player.landSize > 0 ? player.cityLevels * BALANCE.troopsPerCityLevel : 0),
    );
    player.troops = Math.min(player.troops, player.maxTroops);
    player.eliminated = player.landSize === 0;
  }
  private execute(command: GameCommand, events: EngineEvent[]): CommandRejection | null {
    const player = this.states.get(command.playerId)!;
    if (player.eliminated || this.map.landSize(player.id) === 0) return 'ELIMINATED';
    if (command.kind === CommandKind.CancelAttack) {
      const attack = this.attacks.get(command.attackId);
      if (!attack || attack.attackerId !== player.id) return 'UNKNOWN_ATTACK';
      this.endAttack(attack, events);
      return null;
    }
    if (command.kind !== CommandKind.Attack) return this.world.execute(command);
    if (command.targetTile >= this.map.length || !this.map.isLand(command.targetTile))
      return 'INVALID_TILE';
    if (this.map.contaminationUntil[command.targetTile]! > this.tickNumber) return 'CONTAMINATED';
    const targetOwner = this.map.ownerId[command.targetTile]!;
    if (targetOwner === player.id) return 'OWN_TERRITORY';
    if (player.alliances.has(targetOwner)) return 'ALLIED_TARGET';
    if (!this.map.adjacentTo(command.targetTile, player.id)) return 'NOT_ADJACENT';
    if (
      this.activeAttacksFor(player.id) + this.world.transportCount(player.id) >=
        BALANCE.maxAttacksPerPlayer ||
      this.nextAttackId === UINT32_MAX
    )
      return 'ATTACK_LIMIT';
    const troops = allocationOf(player.troops, command.allocationBps);
    if (troops < this.tileCost(command.targetTile)) return 'INSUFFICIENT_TROOPS';
    const attack = new AttackExecution(
      this.nextAttackId++,
      player.id,
      targetOwner,
      command.targetTile,
      troops,
      this.tickNumber,
    );
    player.troops -= troops;
    attack.seed(this.map);
    this.attacks.set(attack.id, attack);
    events.push({
      kind: 'attackStarted',
      attackId: attack.id,
      playerId: player.id,
      targetOwnerId: targetOwner,
      troops,
    });
    return null;
  }
  private endAttack(attack: AttackExecution, events: EngineEvent[]): void {
    const player = this.states.get(attack.attackerId)!;
    const cap = Math.min(
      MAX_RESOURCE,
      this.map.landSize(player.id) * BALANCE.baseTroopsPerTile +
        player.cityLevels * BALANCE.troopsPerCityLevel,
    );
    const refunded =
      this.map.landSize(player.id) > 0
        ? Math.min(attack.troops, Math.max(0, cap - player.troops))
        : 0;
    player.troops += refunded;
    this.attacks.delete(attack.id);
    events.push({
      kind: 'attackEnded',
      attackId: attack.id,
      playerId: player.id,
      captured: attack.captured,
      refunded,
    });
  }
}
