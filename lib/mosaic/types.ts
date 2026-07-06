// Shared types + constants for the mosaic engine.

/** Tiles per axis. 1000 x 1000 = 1,000,000 tiles. */
export const GRID = 1000;
export const TILE_COUNT = GRID * GRID;

/** Tile ownership state, stored in the red channel of the state texture. */
export const STATE_FREE = 0; // unpurchased -> shows base image
export const STATE_OTHER = 128; // purchased by someone else -> blurred
export const STATE_MINE = 255; // current user's tile -> shows uploaded photo

export type ViewMode = "2d" | "3d";

/** A rectangular region of mosaic UV space [0,1] x [0,1]. */
export interface Region {
  minX: number;
  minY: number;
  spanX: number;
  spanY: number;
}

/** Public snapshot the React UI reads each frame (via a subscribe callback). */
export interface HudState {
  mode: ViewMode;
  zoomPct: number; // 100 = whole mosaic fits, grows as you zoom in
  owned: number | null; // current user's tile index, or null
  residentChunks: number;
  loadedChunks: number;
  fps: number;
}

export interface TileClick {
  index: number;
  tx: number;
  ty: number;
  state: number; // STATE_FREE | STATE_OTHER | STATE_MINE
}
