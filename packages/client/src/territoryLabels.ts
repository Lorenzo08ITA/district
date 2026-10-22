/** One flood-fill per refresh; anchors stay on the largest connected land component. */
export class TerritoryLabels {
  private visited: Uint8Array;
  private queue: Uint32Array;
  private anchors = new Map<number, readonly [number, number]>();
  constructor(
    private width: number,
    private height: number,
  ) {
    this.visited = new Uint8Array(width * height);
    this.queue = new Uint32Array(width * height);
  }
  refresh(owners: Uint16Array): void {
    if (owners.length !== this.visited.length) throw new RangeError('Label map size');
    this.visited.fill(0);
    this.anchors.clear();
    const largest = new Uint32Array(65);
    for (let start = 0; start < owners.length; start++) {
      const owner = owners[start]!;
      if (!owner || this.visited[start]) continue;
      let head = 0,
        tail = 1,
        sumX = 0,
        sumY = 0;
      this.queue[0] = start;
      this.visited[start] = 1;
      while (head < tail) {
        const tile = this.queue[head++]!,
          x = tile % this.width,
          y = Math.floor(tile / this.width);
        sumX += x;
        sumY += y;
        const visit = (next: number) => {
          if (!this.visited[next] && owners[next] === owner) {
            this.visited[next] = 1;
            this.queue[tail++] = next;
          }
        };
        if (x > 0) visit(tile - 1);
        if (x + 1 < this.width) visit(tile + 1);
        if (y > 0) visit(tile - this.width);
        if (y + 1 < this.height) visit(tile + this.width);
      }
      if (tail <= largest[owner]!) continue;
      largest[owner] = tail;
      const cx = sumX / tail,
        cy = sumY / tail;
      let best = start,
        distance = Infinity;
      for (let i = 0; i < tail; i++) {
        const tile = this.queue[i]!,
          d = ((tile % this.width) - cx) ** 2 + (Math.floor(tile / this.width) - cy) ** 2;
        if (d < distance) {
          best = tile;
          distance = d;
        }
      }
      this.anchors.set(owner, [best % this.width, Math.floor(best / this.width)]);
    }
  }
  get(owner: number, fallback: readonly [number, number]): readonly [number, number] {
    return this.anchors.get(owner) ?? fallback;
  }
}
