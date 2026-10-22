/** Explicit little-endian FNV-1a for diagnostics, not a security MAC. */
export class StateHasher {
  private value = 0x811c9dc5;
  byte(value: number): this {
    this.value = Math.imul(this.value ^ (value & 255), 0x01000193) >>> 0;
    return this;
  }
  uint16(value: number): this {
    return this.byte(value).byte(value >>> 8);
  }
  uint32(value: number): this {
    return this.uint16(value).uint16(value >>> 16);
  }
  integer(value: number): this {
    return this.uint32(value >>> 0).uint32(Math.floor(value / 0x1_0000_0000));
  }
  text(value: string): this {
    const bytes = new TextEncoder().encode(value);
    this.uint32(bytes.length);
    for (const byte of bytes) this.byte(byte);
    return this;
  }
  finish(): number {
    return this.value;
  }
}
