// PixiJS 2D mosaic engine. Drives rendering manually (base chunks -> base
// RenderTexture -> composite -> screen). The 3D globe is a separate Three.js
// renderer (see lib/mosaic3d); both share one MosaicData instance.

import { Application, RenderTexture, Texture } from "pixi.js";
import { loadBaseImage } from "./baseImage";
import { ChunkLoader } from "./chunkLoader";
import { CompositePass } from "./composite";
import { InputController } from "./input";
import type { MosaicData } from "./mosaicData";
import { TileState } from "./tileState";
import type { HudState, TileClick } from "./types";
import { GRID } from "./types";
import { View2D } from "./view2d";

const BG = 0x05060f;

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
  private input!: InputController;
  private baseRT!: RenderTexture;
  private photoTex: Texture | null = null;
  private photoVersionSeen = -1;

  private raf = 0;
  private running = false;
  private active = true;
  private disposed = false;
  private lastT = 0;
  private fps = 60;
  private hudTick = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly data: MosaicData,
    private readonly cb: EngineCallbacks,
  ) {}

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
    if (this.disposed) return this.destroyApp();
    this.app.stop();
    this.container.appendChild(this.app.canvas);

    await loadBaseImage("/mona-lisa.jpg");
    if (this.disposed) return this.destroyApp();

    this.tiles = new TileState(this.data);
    this.chunks = new ChunkLoader();
    this.baseRT = RenderTexture.create({ width: w, height: h, dynamic: true, scaleMode: "linear" });
    this.composite = new CompositePass(this.tiles, this.baseRT.source);
    if (typeof window !== "undefined" && window.location.search.includes("debug=state")) {
      this.composite.setDebug(true);
    }
    this.view2d = new View2D(w, h);

    // Show an already-owned photo (e.g. uploaded in the 3D view before switching).
    this.syncPhoto();

    this.bindInput();
    window.addEventListener("resize", this.onResize);

    this.running = true;
    this.lastT = performance.now();
    this.loop();
  }

  private bindInput(): void {
    this.input = new InputController(this.app.canvas, {
      onDragStart: () => this.view2d.stopFling(),
      onDrag: (dx, dy) => this.view2d.pan(dx, dy),
      onDragEnd: (vx, vy) => this.view2d.flingStart(vx, vy),
      onPinch: (scale, cx, cy) => this.view2d.zoomAt(scale, cx, cy),
      onWheel: (factor, x, y) => this.view2d.zoomAt(factor, x, y),
      onTap: (x, y) => {
        const hit = this.view2d.tileAt(x, y);
        if (hit) {
          this.cb.onTileSelect?.({ index: hit.index, tx: hit.tx, ty: hit.ty, state: this.tiles.stateAt(hit.index) });
        }
      },
    });
  }

  /** Pause/resume the render loop when the 2D view is hidden behind the globe. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (this.app) this.app.canvas.style.visibility = active ? "visible" : "hidden";
    if (active) {
      const w = this.container.clientWidth;
      const h = this.container.clientHeight;
      if (w && h) {
        this.app.renderer.resize(w, h);
        this.view2d.resize(w, h);
        this.baseRT.resize(w, h);
      }
    }
  }

  /** Rebuild the Pixi photo texture if MosaicData's photo changed. */
  private syncPhoto(): void {
    if (this.data.photoVersion === this.photoVersionSeen) return;
    this.photoVersionSeen = this.data.photoVersion;
    if (this.photoTex) {
      this.photoTex.destroy(true);
      this.photoTex = null;
    }
    if (this.data.photo) {
      this.photoTex = Texture.from(this.data.photo);
      this.composite.setPhoto(this.photoTex);
    } else {
      this.composite.setPhoto(null);
    }
  }

  async applyPhoto(index: number, file: File): Promise<void> {
    const bitmap = await createImageBitmap(file);
    this.data.setPhoto(bitmap, index);
    this.syncPhoto();
  }

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
    this.data.setPhoto(c, index);
    this.syncPhoto();
  }

  /** Center the 2D view on a tile (fly to the owned tile). */
  focusTile(index: number): void {
    const tx = index % GRID;
    const ty = Math.floor(index / GRID);
    this.view2d.centerX = (tx + 0.5) / GRID;
    this.view2d.centerY = (ty + 0.5) / GRID;
    this.view2d.zoom = (GRID / 40) * (this.app.screen.width / this.app.screen.height);
    this.view2d.stopFling();
  }

  private onResize = () => {
    if (!this.active) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.app.renderer.resize(w, h);
    this.view2d.resize(w, h);
    this.baseRT.resize(w, h);
  };

  private loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.active) return;

    const now = performance.now();
    const dt = now - this.lastT;
    this.lastT = now;
    this.fps = this.fps * 0.9 + (1000 / Math.max(1, dt)) * 0.1;

    this.syncPhoto();
    const renderer = this.app.renderer;
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

    this.emitHud();
  };

  private emitHud(): void {
    if (this.hudTick++ % 10 !== 0) return;
    this.cb.onHud?.({
      mode: "2d",
      zoomPct: Math.round(this.view2d.zoom * 100),
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
      // Pixi can throw tearing down a partially-initialised app (StrictMode).
    }
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.input?.destroy();
    this.composite?.destroy();
    this.chunks?.destroy();
    this.tiles?.destroy();
    this.photoTex?.destroy(true);
    this.baseRT?.destroy(true);
    this.destroyApp();
  }
}
