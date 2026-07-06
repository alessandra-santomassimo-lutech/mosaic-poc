// Per-tile ownership, encoded in a tiny GPU texture (1 texel per tile).
// This is the trick that lets 1,000,000 tiles cost nothing at render time:
// the composite shader samples this texture instead of drawing per-tile sprites.

import { BufferImageSource, Texture } from "pixi.js";
import { GRID, STATE_FREE, STATE_MINE, STATE_OTHER, TILE_COUNT } from "./types";

const STORAGE_KEY = "mosaic-poc:owned-tile";

// Deterministic hash -> stable "purchased by others" seeding across reloads.
function hash2(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export class TileState {
  /** RGBA8, red channel holds STATE_*. Others left 0. */
  readonly buffer: Uint8Array;
  readonly texture: Texture;
  private readonly source: BufferImageSource;
  ownedTile: number | null = null;

  constructor(purchasedFraction = 0.35) {
    this.buffer = new Uint8Array(TILE_COUNT * 4);

    // Seed ~35% of tiles as owned-by-others via a stable hash.
    // Alpha MUST be 255: Pixi premultiplies alpha on upload, so a=0 would zero
    // out the red channel where we store the state.
    const threshold = purchasedFraction * 0xffffffff;
    for (let i = 0; i < TILE_COUNT; i++) {
      const x = i % GRID;
      const y = (i / GRID) | 0;
      this.buffer[i * 4] = hash2(x, y) < threshold ? STATE_OTHER : STATE_FREE;
      this.buffer[i * 4 + 3] = 255;
    }

    this.source = new BufferImageSource({
      resource: this.buffer,
      width: GRID,
      height: GRID,
      format: "rgba8unorm",
      // Crisp per-tile lookups: no smoothing, no mipmaps.
      scaleMode: "nearest",
      addressMode: "clamp-to-edge",
      autoGenerateMipmaps: false,
    });
    this.texture = new Texture({ source: this.source });
    this.source.update(); // upload the seeded buffer to the GPU

    // Restore a previously owned tile.
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (saved !== null) {
      const idx = Number(saved);
      if (Number.isInteger(idx) && idx >= 0 && idx < TILE_COUNT) {
        this.ownedTile = idx;
        this.buffer[idx * 4] = STATE_MINE;
        this.source.update();
      }
    }
  }

  stateAt(index: number): number {
    return this.buffer[index * 4];
  }

  /** Claim `index` for the current user. Any previously owned tile is released. */
  buy(index: number): void {
    if (this.ownedTile !== null && this.ownedTile !== index) {
      // Releasing our old tile: revert it to owned-by-others (it is now taken).
      this.buffer[this.ownedTile * 4] = STATE_OTHER;
    }
    this.ownedTile = index;
    this.buffer[index * 4] = STATE_MINE;
    this.source.update();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(index));
    }
  }

  destroy(): void {
    this.texture.destroy(true);
  }
}
