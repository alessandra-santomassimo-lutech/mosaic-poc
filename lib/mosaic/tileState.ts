// PixiJS wrapper around MosaicData: exposes the shared per-tile state as a Pixi
// texture (1 texel per tile) and re-uploads it whenever the data changes.

import { BufferImageSource, Texture } from "pixi.js";
import type { MosaicData } from "./mosaicData";
import { GRID } from "./types";

export class TileState {
  readonly texture: Texture;
  private readonly source: BufferImageSource;
  private readonly unsubscribe: () => void;

  constructor(private readonly data: MosaicData) {
    this.source = new BufferImageSource({
      resource: data.buffer,
      width: GRID,
      height: GRID,
      format: "rgba8unorm",
      scaleMode: "nearest",
      addressMode: "clamp-to-edge",
      autoGenerateMipmaps: false,
    });
    this.texture = new Texture({ source: this.source });
    this.source.update();
    this.unsubscribe = data.subscribe(() => this.source.update());
  }

  get ownedTile(): number | null {
    return this.data.ownedTile;
  }

  stateAt(index: number): number {
    return this.data.stateAt(index);
  }

  buy(index: number): void {
    this.data.buy(index);
  }

  destroy(): void {
    this.unsubscribe();
    this.texture.destroy(true);
  }
}
