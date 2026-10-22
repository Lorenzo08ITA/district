export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  viewWidth = 1;
  viewHeight = 1;
  fit(width: number, height: number, viewWidth: number, viewHeight: number) {
    this.x = width / 2;
    this.y = height / 2;
    this.viewWidth = viewWidth;
    this.viewHeight = viewHeight;
    this.zoom = Math.min(viewWidth / width, viewHeight / height) * 0.9;
  }
  screenToWorld(x: number, y: number): readonly [number, number] {
    return [
      (x - this.viewWidth / 2) / this.zoom + this.x,
      (y - this.viewHeight / 2) / this.zoom + this.y,
    ];
  }
  worldToScreen(x: number, y: number): readonly [number, number] {
    return [
      (x - this.x) * this.zoom + this.viewWidth / 2,
      (y - this.y) * this.zoom + this.viewHeight / 2,
    ];
  }
  pan(dx: number, dy: number) {
    this.x -= dx / this.zoom;
    this.y -= dy / this.zoom;
  }
  zoomAt(x: number, y: number, factor: number) {
    const before = this.screenToWorld(x, y);
    this.zoom = Math.max(0.75, Math.min(50, this.zoom * factor));
    const after = this.screenToWorld(x, y);
    this.x += before[0] - after[0];
    this.y += before[1] - after[1];
  }
}
