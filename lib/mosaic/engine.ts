// Mosaic engine: owns the PixiJS Application and drives all rendering manually
// (multi-pass: base chunks -> base RenderTexture -> composite -> screen/globe).

import { Application, RenderTexture, Texture } from "pixi.js";
import { ChunkLoader } from "./chunkLoader";
import { CompositePass } from "./composite";
import { InputController } from "./input";
import { TileState } from "./tileState";
import type { HudState, TileClick, ViewMode } from "./types";
import { GRID } from "./types";
import { View2D } from "./view2d";
import { View3D } from "./view3d";

const BG = 0x05060f;
const GLOBE_W = 2048;
const GLOBE_H = 1024;

export interface EngineCallbacks {
  onTileSelect?: (t: TileClick) => void;
  onHud?: (h: HudState) => void;
}

export class MosaicEngine {
  private app!: Application;
  private tiles!: TileState;
  private chunks!: ChunkLoader;
  private composite!: CompositePass;
  private view2d!: View2D;
  private view3d!: View3D;
  private input!: InputController;
  private baseRT!: RenderTexture;
  private globeRT!: RenderTexture;
  private photoTex: Texture | null = null;

  private mode: ViewMode = "2d";
  private raf = 0;
  private running = false;
  private disposed = false;
  private lastT = 0;
  private fps = 60;
  private hudTick = 0;

  constructor(private readonly container: HTMLElement, private readonly cb: EngineCallbacks) {}

  async init(): Promise<void> {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.app = new Application();
    await this.app.init({
      width: w,
      height: h,
      background: BG,
      antialias: false,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      preference: "webgl",
      powerPreference: "high-performance",
    });
    // React StrictMode may unmount before init resolves; bail cleanly.
    if (this.disposed) {
      this.destroyApp();
      return;
    }
    this.app.stop(); // we drive rendering ourselves
    this.container.appendChild(this.app.canvas);

    this.tiles = new TileState();
    this.chunks = new ChunkLoader();

    this.baseRT = RenderTexture.create({ width: w, height: h, dynamic: true, scaleMode: "linear" });
    this.globeRT = RenderTexture.create({ width: GLOBE_W, height: GLOBE_H, dynamic: true, scaleMode: "linear" });

    this.composite = new CompositePass(this.tiles, this.baseRT.source);
    if (typeof window !== "undefined" && window.location.search.includes("debug=state")) {
      this.composite.setDebug(true);
    }
    this.view2d = new View2D(w, h);
    this.view3d = new View3D(this.globeRT);

    this.bindInput();
    window.addEventListener("resize", this.onResize);

    this.running = true;
    this.lastT = performance.now();
    this.loop();
  }

  private bindInput(): void {
    this.input = new InputController(this.app.canvas, {
      onDragStart: () => this.view2d.stopFling(),
      onDrag: (dx, dy, x, y) => {
        if (this.mode === "2d") this.view2d.pan(dx, dy);
        else this.view3d.orbit(dx, dy, this.app.screen.width);
        void x;
        void y;
      },
      onDragEnd: (vx, vy) => {
        if (this.mode === "2d") this.view2d.flingStart(vx, vy);
      },
      onPinch: (scale, cx, cy) => {
        if (this.mode === "2d") this.view2d.zoomAt(scale, cx, cy);
        else this.view3d.dolly(scale);
      },
      onWheel: (factor, x, y) => {
        if (this.mode === "2d") this.view2d.zoomAt(factor, x, y);
        else this.view3d.dolly(factor);
      },
      onTap: (x, y) => {
        if (this.mode !== "2d") return;
        const hit = this.view2d.tileAt(x, y);
        if (hit) {
          this.cb.onTileSelect?.({
            index: hit.index,
            tx: hit.tx,
            ty: hit.ty,
            state: this.tiles.stateAt(hit.index),
          });
        }
      },
    });
  }

  setMode(mode: ViewMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === "2d") {
      this.baseRT.resize(this.app.screen.width, this.app.screen.height);
    } else {
      this.baseRT.resize(GLOBE_W, GLOBE_H);
    }
  }

  getMode(): ViewMode {
    return this.mode;
  }

  /** Claim a tile and show the uploaded image on it. */
  async applyPhoto(index: number, file: File): Promise<void> {
    const bitmap = await createImageBitmap(file);
    const tex = Texture.from(bitmap);
    if (this.photoTex) this.photoTex.destroy(true);
    this.photoTex = tex;
    this.tiles.buy(index);
    this.composite.setPhoto(tex);
  }

  /** Claim a tile with a generated placeholder photo (demo/testing, no upload). */
  demoOwn(index: number): void {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const x = c.getContext("2d")!;
    const g = x.createLinearGradient(0, 0, 256, 256);
    g.addColorStop(0, "#ff5e62");
    g.addColorStop(1, "#ffd452");
    x.fillStyle = g;
    x.fillRect(0, 0, 256, 256);
    x.fillStyle = "#fff";
    x.font = "bold 90px sans-serif";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.fillText("ME", 128, 128);
    const tex = Texture.from(c);
    if (this.photoTex) this.photoTex.destroy(true);
    this.photoTex = tex;
    this.tiles.buy(index);
    this.composite.setPhoto(tex);
  }

  /** Center the 2D view on a tile (used to fly to the owned tile). */
  focusTile(index: number): void {
    this.setMode("2d");
    const tx = index % GRID;
    const ty = Math.floor(index / GRID);
    this.view2d.centerX = (tx + 0.5) / GRID;
    this.view2d.centerY = (ty + 0.5) / GRID;
    this.view2d.zoom = (GRID / 40) * (this.app.screen.width / this.app.screen.height);
    this.view2d.stopFling();
  }

  private onResize = () => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.app.renderer.resize(w, h);
    this.view2d.resize(w, h);
    if (this.mode === "2d") this.baseRT.resize(w, h);
  };

  private loop = () => {
    if (!this.running) return;
    const now = performance.now();
    const dt = now - this.lastT;
    this.lastT = now;
    this.fps = this.fps * 0.9 + (1000 / Math.max(1, dt)) * 0.1;

    const renderer = this.app.renderer;

    if (this.mode === "2d") {
      this.view2d.update();
      const region = this.view2d.region;
      const bw = this.baseRT.width;
      const bh = this.baseRT.height;
      this.chunks.update(region, bw, bh);
      renderer.render({ container: this.chunks.container, target: this.baseRT, clear: true, clearColor: BG });
      this.composite.render(renderer, undefined, {
        mosaicMinX: region.minX,
        mosaicMinY: region.minY,
        mosaicSpanX: region.spanX,
        mosaicSpanY: region.spanY,
        baseW: bw,
        baseH: bh,
        pxPerTile: this.view2d.pxPerTile,
        toRenderTexture: false,
      });
    } else {
      this.view3d.update();
      const region = { minX: 0, minY: 0, spanX: 1, spanY: 1 };
      this.chunks.update(region, GLOBE_W, GLOBE_H);
      renderer.render({ container: this.chunks.container, target: this.baseRT, clear: true, clearColor: BG });
      this.composite.render(renderer, this.globeRT, {
        mosaicMinX: 0,
        mosaicMinY: 0,
        mosaicSpanX: 1,
        mosaicSpanY: 1,
        baseW: GLOBE_W,
        baseH: GLOBE_H,
        pxPerTile: GLOBE_W / GRID, // ~2 -> grid lines hidden on the globe
        toRenderTexture: true,
      });
      this.view3d.render(renderer, this.app.screen.width, this.app.screen.height);
    }

    this.emitHud();
    this.raf = requestAnimationFrame(this.loop);
  };

  private emitHud(): void {
    if (this.hudTick++ % 10 !== 0) return;
    this.cb.onHud?.({
      mode: this.mode,
      zoomPct: this.mode === "2d" ? Math.round(this.view2d.zoom * 100) : 100,
      owned: this.tiles.ownedTile,
      residentChunks: this.chunks.residentCount,
      loadedChunks: this.chunks.loadedCount,
      fps: Math.round(this.fps),
    });
  }

  private appDestroyed = false;

  private destroyApp(): void {
    if (this.appDestroyed || !this.app) return;
    this.appDestroyed = true;
    try {
      this.app.destroy({ removeView: true }, { children: true });
    } catch {
      // Pixi can throw on teardown of a partially torn-down app (StrictMode
      // double-mount); the GPU context is being dropped regardless.
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.input?.destroy();
    this.view3d?.destroy();
    this.composite?.destroy();
    this.chunks?.destroy();
    this.tiles?.destroy();
    this.photoTex?.destroy(true);
    this.baseRT?.destroy(true);
    this.globeRT?.destroy(true);
    this.destroyApp();
  }
}
