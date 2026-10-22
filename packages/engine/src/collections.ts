export class Uint32List {
  private storage = new Uint32Array(16);
  private count = 0;
  get length(): number {
    return this.count;
  }
  push(value: number): number {
    if (this.count === this.storage.length) {
      const next = new Uint32Array(this.storage.length * 2);
      next.set(this.storage);
      this.storage = next;
    }
    const index = this.count++;
    this.storage[index] = value;
    return index;
  }
  removeSwap(index: number): number | null {
    const last = this.storage[--this.count]!;
    if (index < this.count) {
      this.storage[index] = last;
      return last;
    }
    return null;
  }
  view(): Uint32Array {
    return this.storage.subarray(0, this.count);
  }
}
