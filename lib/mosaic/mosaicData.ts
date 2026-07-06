// Renderer-agnostic source of truth for the mosaic. Holds the per-tile state
// buffer, the owned tile, and the current user's photo. Both the PixiJS 2D view
// and the Three.js 3D globe wrap this same object into their own GPU textures and
// subscribe to changes, so the two views always agree.

import { GRID, STATE_FREE, STATE_MINE, STATE_OTHER, TILE_COUNT } from "./types";

const STORAGE_KEY = "mosaic-poc:owned-tile";

// Deterministic hash -> stable "purchased by others" seeding across reloads.
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

type Listener = () => void;

export class MosaicData {
  /** RGBA8, red channel holds STATE_*. Alpha = 255 (avoids premultiply zeroing). */
  readonly buffer: Uint8Array;
  ownedTile: number | null = null;

  /** Current user's uploaded photo (shared by both renderers). */
  photo: ImageBitmap | HTMLCanvasElement | null = null;
  /** Bumped whenever `photo` changes, so renderers know to rebuild their texture. */
  photoVersion = 0;

  private readonly listeners = new Set<Listener>();

  constructor(purchasedFraction = 0.35) {
    this.buffer = new Uint8Array(TILE_COUNT * 4);
    const threshold = purchasedFraction * 0xffffffff;
    for (let i = 0; i < TILE_COUNT; i++) {
      const x = i % GRID;
      const y = (i / GRID) | 0;
      this.buffer[i * 4] = hash2(x, y) < threshold ? STATE_OTHER : STATE_FREE;
      this.buffer[i * 4 + 3] = 255;
    }

    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (saved !== null) {
      const idx = Number(saved);
      if (Number.isInteger(idx) && idx >= 0 && idx < TILE_COUNT) {
        this.ownedTile = idx;
        this.buffer[idx * 4] = STATE_MINE;
      }
    }
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  stateAt(index: number): number {
    return this.buffer[index * 4];
  }

  /** Claim `index` for the current user, releasing any previously owned tile. */
  buy(index: number): void {
    if (this.ownedTile !== null && this.ownedTile !== index) {
      this.buffer[this.ownedTile * 4] = STATE_OTHER;
    }
    this.ownedTile = index;
    this.buffer[index * 4] = STATE_MINE;
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(index));
    }
    this.notify();
  }

  setPhoto(photo: ImageBitmap | HTMLCanvasElement, index: number): void {
    this.photo = photo;
    this.photoVersion++;
    this.buy(index); // also notifies
  }
}
