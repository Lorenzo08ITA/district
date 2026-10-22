import { TerrainType } from '@district/rts-shared';
import { GameMap } from './GameMap.js';
import { GameEngine } from './GameEngine.js';
import { Mulberry32 } from './prng.js';
import {WORLD_WIDTH,WORLD_HEIGHT,WORLD_LAND_RUNS} from './world-land.js';
export type MapName = 'world' | 'continents' | 'archipelago' | 'strait';
export const MAP_NAMES: readonly MapName[] = ['world','continents', 'archipelago', 'strait'];
/** Integer height noise and three curated coast layouts; seed also fixes spawn ordering. */
export function createScenario(
  seed: number,
  names: readonly string[],
  bots: readonly number[],
  layout: MapName = 'world',
): GameEngine {
  if (names.length < 1 || names.length > 12 || !MAP_NAMES.includes(layout))
    throw new RangeError('Invalid scenario');
  const width = layout==='world'?WORLD_WIDTH:192,
    height = layout==='world'?WORLD_HEIGHT:128,
    terrainType = new Uint8Array(width * height),
    elevation = new Uint8Array(width * height);
  const land=layout==='world'?new Uint8Array(width*height):null;
  if(land)for(let n=0;n<WORLD_LAND_RUNS.length;n+=2)land.fill(1,WORLD_LAND_RUNS[n]!,WORLD_LAND_RUNS[n]!+WORLD_LAND_RUNS[n+1]!);
  const noiseWidth=(width>>4)+1;
  const random = new Mulberry32(seed),
    noise = new Uint8Array(noiseWidth*((height>>4)+1));
  for (let i = 0; i < noise.length; i++) noise[i] = random.nextUint32() % 256;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const tile = y * width + x,
        gx = x >> 4,
        gy = y >> 4,
        fx = x & 15,
        fy = y & 15;
      const n =
        ((noise[gy * noiseWidth + gx]! * (16 - fx) + noise[gy * noiseWidth + gx + 1]! * fx) * (16 - fy) +
          (noise[(gy + 1) * noiseWidth + gx]! * (16 - fx) + noise[(gy + 1) * noiseWidth + gx + 1]! * fx) * fy) >>
        8;
      const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
      let h = n + Math.min(48, edge * 4) - 75;
      if (layout === 'strait' && Math.abs(x - width / 2) < 7 + ((y >> 4) % 3)) h -= 150;
      if (layout === 'archipelago' && (x % 48 < 6 || y % 48 < 6)) h -= 120;
      elevation[tile] = Math.max(0, Math.min(255, h + 60));
      if(land){terrainType[tile]=land[tile]?(n>205?TerrainType.Mountains:n>170?TerrainType.Hills:TerrainType.Plains):TerrainType.DeepWater;elevation[tile]=land[tile]?Math.max(40,n):0;continue;}
      terrainType[tile] =
        edge < 3 || h < 30
          ? TerrainType.DeepWater
          : h < 45
            ? TerrainType.ShallowWater
            : h < 55
              ? TerrainType.Coast
              : h < 145
                ? TerrainType.Plains
                : h < 175
                  ? TerrainType.Hills
                  : TerrainType.Mountains;
    }
  // Coastal classification follows actual four-neighbour water, so ports work on every shore.
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const t = y * width + x;
      if (
        terrainType[t]! >= 2 &&
        [t - 1, t + 1, t - width, t + width].some((n) => terrainType[n]! < 2)
      )
        terrainType[t] = TerrainType.Coast;
    }
  const map = new GameMap(width, height, {
    terrainType,
    elevation,
    ownerId: new Uint16Array(width * height),
    buildingId: new Uint32Array(width * height),
    defenseCoverage: new Uint8Array(width * height),
  });
  const spawns: number[] = [];
  for (let p = 0; p < names.length; p++) {
    let best = -1,
      distance = -1;
    for (let t = width * 4; t < map.length - width * 4; t++) {
      const x = t % width,
        y = Math.floor(t / width);
      if (
        (layout==='world'&&y>height*5/6)||
        x < 4 ||
        x >= width - 4 ||
        !map.isLand(t) ||
        !map.isLand(t - 1) ||
        !map.isLand(t + 1) ||
        !map.isLand(t - width) ||
        !map.isLand(t + width)
      )
        continue;
      const d = spawns.length
        ? Math.min(...spawns.map((s) => (x - (s % width)) ** 2 + (y - Math.floor(s / width)) ** 2))
        : Math.min(x, width - x, y, height - y) ** 2;
      if (d > distance) {
        best = t;
        distance = d;
      }
    }
    if (best < 0 || distance < 36) throw new Error('No valid spawn');
    spawns.push(best);
  }
  return new GameEngine({
    map,
    seed,
    players: names.map((name, i) => ({
      id: i + 1,
      name,
      spawnTile: spawns[i]!,
      spawnRadius: 3,
      initialTroops: 100000,
    })),
    bots,
  });
}
