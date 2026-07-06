// Composite pass: one draw call that turns the base image + the per-tile state
// texture + the user photo into the final mosaic. Size-independent (clip-space
// quad) so the same pass targets the screen (2D) or a RenderTexture (3D globe).

import {
  Geometry,
  Mesh,
  type Renderer,
  type RenderTexture,
  Shader,
  Texture,
  type TextureSource,
  UniformGroup,
} from "pixi.js";
import { compositeFrag, compositeVert } from "./shaders";
import { GRID } from "./types";
import type { TileState } from "./tileState";

export interface CompositeParams {
  mosaicMinX: number;
  mosaicMinY: number;
  mosaicSpanX: number;
  mosaicSpanY: number;
  /** base render-texture pixel size (for blur tap spacing) */
  baseW: number;
  baseH: number;
  /** approx screen px per tile, for grid-line fade */
  pxPerTile: number;
  /** true when rendering to a RenderTexture (needs a Y flip vs the screen) */
  toRenderTexture: boolean;
}

export class CompositePass {
  readonly mesh: Mesh<Geometry, Shader>;
  private readonly shader: Shader;
  private readonly params: UniformGroup;

  constructor(private readonly tiles: TileState, baseSource: TextureSource) {
    // Unit quad, y=0 at the bottom. aPos doubles as aUv.
    const verts = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const geometry = new Geometry({
      attributes: {
        aPos: { buffer: verts, format: "float32x2" },
        aUv: { buffer: verts, format: "float32x2" },
      },
      indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });

    this.params = new UniformGroup({
      uMosaicMin: { value: new Float32Array([0, 0]), type: "vec2<f32>" },
      uMosaicSpan: { value: new Float32Array([1, 1]), type: "vec2<f32>" },
      uGrid: { value: new Float32Array([GRID, GRID]), type: "vec2<f32>" },
      uTexel: { value: new Float32Array([1 / 1024, 1 / 1024]), type: "vec2<f32>" },
      uUserTile: { value: -1, type: "f32" },
      uHasPhoto: { value: 0, type: "f32" },
      uPxPerTile: { value: 0, type: "f32" },
      uFlipY: { value: 1, type: "f32" },
      uFlipV: { value: 1, type: "f32" },
      uDebug: { value: 0, type: "f32" },
    });

    this.shader = Shader.from({
      gl: { vertex: compositeVert, fragment: compositeFrag },
      resources: {
        uBase: baseSource,
        uState: this.tiles.texture.source,
        uPhoto: Texture.WHITE.source,
        params: this.params,
      },
    });

    this.mesh = new Mesh({ geometry, shader: this.shader });
  }

  setPhoto(texture: Texture | null): void {
    if (texture) {
      this.shader.resources.uPhoto = texture.source;
      this.u.uHasPhoto = 1;
    } else {
      this.shader.resources.uPhoto = Texture.WHITE.source;
      this.u.uHasPhoto = 0;
    }
  }

  private get u() {
    return this.params.uniforms as Record<string, number | Float32Array>;
  }

  /** Rebind the base texture (its RenderTexture may be recreated on resize). */
  setBase(source: TextureSource): void {
    this.shader.resources.uBase = source;
  }

  setDebug(on: boolean): void {
    this.u.uDebug = on ? 1 : 0;
  }

  render(renderer: Renderer, target: RenderTexture | undefined, p: CompositeParams): void {
    const u = this.u;
    (u.uMosaicMin as Float32Array).set([p.mosaicMinX, p.mosaicMinY]);
    (u.uMosaicSpan as Float32Array).set([p.mosaicSpanX, p.mosaicSpanY]);
    (u.uTexel as Float32Array).set([1 / p.baseW, 1 / p.baseH]);
    u.uUserTile = this.tiles.ownedTile ?? -1;
    u.uPxPerTile = p.pxPerTile;
    // RenderTextures are Y-flipped relative to the screen.
    u.uFlipY = p.toRenderTexture ? -1 : 1;
    u.uFlipV = 1;

    renderer.render({ container: this.mesh, target, clear: true });
  }

  destroy(): void {
    this.mesh.destroy();
    this.shader.destroy();
  }
}
