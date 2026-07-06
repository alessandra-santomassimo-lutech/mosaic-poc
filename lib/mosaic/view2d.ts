// 2D view state: a center point in mosaic UV + a zoom level. Converts screen
// gestures into pan/zoom, applies inertia, exposes the visible region (for the
// chunk loader) and a screen->tile hit test.

import { GRID, type Region } from "./types";

const FRICTION = 0.9;

export class View2D {
  centerX = 0.5;
  centerY = 0.5;
  zoom = 1;
  private velX = 0; // UV / frame
  private velY = 0;

  constructor(private w: number, private h: number) {
    this.zoom = this.minZoom();
    this.clamp();
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.zoom = Math.max(this.zoom, this.minZoom());
    this.clamp();
  }

  private aspect(): number {
    return this.w / this.h;
  }
  private minZoom(): number {
    return Math.max(1, this.aspect());
  }
  private maxZoom(): number {
    return (GRID / 10) * this.aspect();
  }

  get spanX(): number {
    return this.aspect() / this.zoom;
  }
  get spanY(): number {
    return 1 / this.zoom;
  }
  get pxPerTile(): number {
    return (this.h * this.zoom) / GRID;
  }

  get region(): Region {
    return {
      minX: this.centerX - this.spanX / 2,
      minY: this.centerY - this.spanY / 2,
      spanX: this.spanX,
      spanY: this.spanY,
    };
  }

  pan(dx: number, dy: number): void {
    this.centerX -= (dx / this.w) * this.spanX;
    this.centerY -= (dy / this.h) * this.spanY;
    this.clamp();
  }

  flingStart(vx: number, vy: number): void {
    this.velX = -(vx / this.w) * this.spanX;
    this.velY = -(vy / this.h) * this.spanY;
  }

  stopFling(): void {
    this.velX = this.velY = 0;
  }

  zoomAt(factor: number, px: number, py: number): void {
    const before = this.screenToMosaic(px, py);
    this.zoom = Math.min(this.maxZoom(), Math.max(this.minZoom(), this.zoom * factor));
    // Keep the mosaic point under the cursor fixed.
    this.centerX = before.x - (px / this.w - 0.5) * this.spanX;
    this.centerY = before.y - (py / this.h - 0.5) * this.spanY;
    this.clamp();
  }

  update(): void {
    if (Math.abs(this.velX) < 1e-6 && Math.abs(this.velY) < 1e-6) return;
    this.centerX += this.velX;
    this.centerY += this.velY;
    this.velX *= FRICTION;
    this.velY *= FRICTION;
    if (Math.abs(this.velX) < 1e-5) this.velX = 0;
    if (Math.abs(this.velY) < 1e-5) this.velY = 0;
    this.clamp();
  }

  screenToMosaic(px: number, py: number): { x: number; y: number } {
    const r = this.region;
    return { x: r.minX + (px / this.w) * r.spanX, y: r.minY + (py / this.h) * r.spanY };
  }

  /** Tile index under a screen pixel, or null if outside the mosaic. */
  tileAt(px: number, py: number): { index: number; tx: number; ty: number } | null {
    const m = this.screenToMosaic(px, py);
    if (m.x < 0 || m.x >= 1 || m.y < 0 || m.y >= 1) return null;
    const tx = Math.min(GRID - 1, Math.floor(m.x * GRID));
    const ty = Math.min(GRID - 1, Math.floor(m.y * GRID));
    return { index: ty * GRID + tx, tx, ty };
  }

  private clamp(): void {
    const sx = this.spanX;
    const sy = this.spanY;
    this.centerX = sx >= 1 ? 0.5 : Math.min(1 - sx / 2, Math.max(sx / 2, this.centerX));
    this.centerY = sy >= 1 ? 0.5 : Math.min(1 - sy / 2, Math.max(sy / 2, this.centerY));
  }
}
