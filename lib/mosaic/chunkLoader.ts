// Virtual scrolling + lazy loading for the base image.
//
// The base is a pyramid: LOD L splits the mosaic into 2^L x 2^L chunks. Only the
// chunks overlapping the current region at the current LOD are instantiated and
// generated (lazily, a few per frame). Chunks that scroll out of view are evicted
// (LRU) and their GPU textures freed, so memory stays bounded no matter how far
// you pan or how long you explore.

import { Container, Sprite, Texture } from "pixi.js";
import { generateChunkCanvas } from "./baseImage";
import type { Region } from "./types";

const MAX_LOD = 7; // up to 128 x 128 chunks
const TARGET_CHUNK_PX = 256; // desired on-target size of a chunk -> picks LOD
const MAX_RESIDENT = 96; // hard cap on live chunk textures
const GEN_PER_FRAME = 4; // lazy generation budget

interface ChunkEntry {
  sprite: Sprite;
  texture: Texture;
  lastUsed: number;
}

interface Pending {
  key: string;
  lod: number;
  cx: number;
  cy: number;
}

export class ChunkLoader {
  /** Sprites for resident chunks; rendered by the engine into the base texture. */
  readonly container = new Container();
  private readonly resident = new Map<string, ChunkEntry>();
  private readonly pending = new Map<string, Pending>();
  private frame = 0;

  loadedCount = 0; // cumulative generations (for the HUD / lazy-load proof)

  private pickLod(region: Region, targetW: number): number {
    const uvPerPx = region.spanX / targetW;
    const chunkUv = uvPerPx * TARGET_CHUNK_PX;
    const lod = Math.round(Math.log2(1 / chunkUv));
    return Math.min(MAX_LOD, Math.max(0, lod));
  }

  /**
   * Ensure the chunks covering `region` (at a LOD suited to `targetW/H`) are
   * resident and positioned so the region maps onto [0,targetW] x [0,targetH].
   */
  update(region: Region, targetW: number, targetH: number): void {
    this.frame++;
    const lod = this.pickLod(region, targetW);
    const n = 1 << lod;
    const inv = 1 / n;

    const cx0 = Math.max(0, Math.floor(region.minX * n));
    const cy0 = Math.max(0, Math.floor(region.minY * n));
    const cx1 = Math.min(n - 1, Math.floor((region.minX + region.spanX) * n));
    const cy1 = Math.min(n - 1, Math.floor((region.minY + region.spanY) * n));

    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = `${lod}/${cx}/${cy}`;
        const entry = this.resident.get(key);

        if (!entry) {
          if (!this.pending.has(key)) this.pending.set(key, { key, lod, cx, cy });
          continue; // will be generated within the per-frame budget below
        }

        entry.lastUsed = this.frame;
        // Position/size in the base target's pixel space.
        entry.sprite.x = ((cx * inv - region.minX) / region.spanX) * targetW;
        entry.sprite.y = ((cy * inv - region.minY) / region.spanY) * targetH;
        entry.sprite.width = (inv / region.spanX) * targetW + 1; // +1 hides seams
        entry.sprite.height = (inv / region.spanY) * targetH + 1;
        entry.sprite.visible = true;
      }
    }

    // Hide chunks from other LODs / off-screen (kept resident for reuse).
    for (const [, entry] of this.resident) {
      if (entry.lastUsed !== this.frame) entry.sprite.visible = false;
    }

    this.processPending(region, targetW, targetH, lod, inv);
    this.evict();
  }

  private processPending(region: Region, targetW: number, targetH: number, activeLod: number, inv: number): void {
    let budget = GEN_PER_FRAME;
    for (const [key, p] of this.pending) {
      if (budget <= 0) break;
      // Drop stale requests for a LOD we are no longer viewing.
      if (p.lod !== activeLod) {
        this.pending.delete(key);
        continue;
      }
      this.pending.delete(key);
      budget--;

      const uvSpan = 1 / (1 << p.lod);
      const canvas = generateChunkCanvas(p.cx * uvSpan, p.cy * uvSpan, uvSpan);
      const texture = Texture.from(canvas);
      const sprite = new Sprite(texture);
      sprite.x = ((p.cx * inv - region.minX) / region.spanX) * targetW;
      sprite.y = ((p.cy * inv - region.minY) / region.spanY) * targetH;
      sprite.width = (inv / region.spanX) * targetW + 1;
      sprite.height = (inv / region.spanY) * targetH + 1;
      this.container.addChild(sprite);
      this.resident.set(key, { sprite, texture, lastUsed: this.frame });
      this.loadedCount++;
    }
  }

  private evict(): void {
    if (this.resident.size <= MAX_RESIDENT) return;
    const entries = [...this.resident.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    let toRemove = this.resident.size - MAX_RESIDENT;
    for (const [key, entry] of entries) {
      if (toRemove <= 0) break;
      if (entry.lastUsed === this.frame) continue; // never evict what's on screen now
      this.container.removeChild(entry.sprite);
      entry.sprite.destroy();
      entry.texture.destroy(true); // free the GPU texture
      this.resident.delete(key);
      toRemove--;
    }
  }

  get residentCount(): number {
    return this.resident.size;
  }

  destroy(): void {
    for (const [, entry] of this.resident) {
      entry.sprite.destroy();
      entry.texture.destroy(true);
    }
    this.resident.clear();
    this.pending.clear();
    this.container.destroy({ children: true });
  }
}
