import { UINT32_MAX } from '@district/rts-shared';
export function assertInteger(value: number, min: number, max: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`${label} must be an integer in [${min}, ${max}]`);
}
export class Mulberry32 {
  private state: number;
  constructor(seed: number) {
    assertInteger(seed, 0, UINT32_MAX, 'seed');
    this.state = seed;
  }
  nextUint32(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }
  nextFloat(): number {
    return this.nextUint32() / 0x1_0000_0000;
  }
  nextInt(exclusiveMax: number): number {
    assertInteger(exclusiveMax, 1, 0x1_0000_0000, 'exclusiveMax');
    const limit = Math.floor(0x1_0000_0000 / exclusiveMax) * exclusiveMax;
    let value: number;
    do {
      value = this.nextUint32();
    } while (value >= limit);
    return value % exclusiveMax;
  }
  getState(): number {
    return this.state;
  }
  setState(state: number): void {
    assertInteger(state, 0, UINT32_MAX, 'PRNG state');
    this.state = state;
  }
}
