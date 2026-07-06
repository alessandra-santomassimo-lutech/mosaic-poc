// Three.js 3D globe. PixiJS can't efficiently drive 1M interactive tiles on 3D
// geometry, so the globe uses GPU instancing + octree frustum culling + LOD:
//
//  - LOD far  : a single textured sphere (low mip of the global image) composites
//               the 3 tile states in its fragment shader. One draw call.
//  - LOD near : an instanced tile layer (InstancedBufferGeometry, one draw call for
//               all visible tiles) raised above the sphere. Only octree-frustum-
//               visible, front-facing cells are uploaded each frame; each tile
//               samples the full-detail image slice and its own state.
//
// The 3 states (base / blurred-other / user photo) are handled entirely in shaders,
// reading a shared per-tile state DataTexture. Buy/photo/HUD/mobile gestures match
// the 2D view (shared MosaicData; same InputController).

import {
  Box3,
  CanvasTexture,
  DataTexture,
  DynamicDrawUsage,
  Frustum,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Matrix4,
  Mesh,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  Texture,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { getBaseContain, loadBaseImage } from "../mosaic/baseImage";
import type { EngineCallbacks } from "../mosaic/engine";
import { InputController } from "../mosaic/input";
import type { MosaicData } from "../mosaic/mosaicData";
import { GRID } from "../mosaic/types";
import { Octree } from "./octree";

const CELL = 10; // tiles per cell edge
const CELLS = GRID / CELL; // 100
const NCELLS = CELLS * CELLS; // 10,000
const TPC = CELL * CELL; // 100 tiles per cell
const CAP = 150_000; // max instanced tiles per frame
const BASE_SIZE = 2048; // contained base texture resolution

const MIN_DIST = 1.5;
const MAX_DIST = 4.5;
const NEAR_LOD = 2.15; // camera distance below which instanced tiles appear
const IDLE_SPIN = 0.0016;

const spherePos = (u: number, v: number, r: number, out: Vector3): Vector3 => {
  const theta = u * Math.PI * 2;
  const phi = v * Math.PI;
  const sp = Math.sin(phi);
  return out.set(sp * Math.cos(theta) * r, Math.cos(phi) * r, sp * Math.sin(theta) * r);
};

export class Globe3D {
  private renderer!: WebGLRenderer;
  private scene!: Scene;
  private camera!: PerspectiveCamera;
  private sphere!: Mesh;
  private tiles!: Mesh;
  private tileGeo!: InstancedBufferGeometry;
  private idAttr!: InstancedBufferAttribute;
  private input!: InputController;

  private stateTex!: DataTexture;
  private baseTex!: CanvasTexture;
  private photoTex: Texture | null = null;
  private unsub: (() => void) | null = null;
  private photoVersionSeen = -1;

  // octree
  private octree!: Octree;
  private cellNormals = new Float32Array(NCELLS * 3);
  private cellTileIds = new Float32Array(NCELLS * TPC);
  private visibleCells: number[] = [];

  private yaw = 0;
  private pitch = 0.3;
  private dist = 3.0;
  private idle = 0;

  private raf = 0;
  private running = false;
  private active = false;
  private disposed = false;
  private lastT = 0;
  private fps = 60;
  private hudTick = 0;

  private frustum = new Frustum();
  private mtx = new Matrix4();
  private camPos = new Vector3();
  private tmp = new Vector3();
  private raycaster = new Raycaster();

  constructor(
    private readonly container: HTMLElement,
    private readonly data: MosaicData,
    private readonly cb: EngineCallbacks,
  ) {}

  async init(): Promise<void> {
    await loadBaseImage("/mona-lisa.jpg");
    if (this.disposed) return;

    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;

    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.setClearColor(0x05060f, 1);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.visibility = "hidden";
    this.container.appendChild(this.renderer.domElement);

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(45, w / h, 0.05, 100);

    this.buildTextures();
    this.buildSphere();
    this.buildTiles();
    this.buildOctree();
    this.syncPhoto();

    this.unsub = this.data.subscribe(() => {
      this.stateTex.needsUpdate = true;
    });

    this.bindInput();
    window.addEventListener("resize", this.onResize);

    this.running = true;
    this.lastT = performance.now();
    this.loop();
  }

  // --- textures ---------------------------------------------------------------

  private buildTextures(): void {
    // Contain-fit the image into a square (aspect preserved, dark letterbox).
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = BASE_SIZE;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#05060f";
    ctx.fillRect(0, 0, BASE_SIZE, BASE_SIZE);
    const c = getBaseContain();
    if (c) {
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(c.img, c.minX * BASE_SIZE, c.minY * BASE_SIZE, c.spanX * BASE_SIZE, c.spanY * BASE_SIZE);
    }
    this.baseTex = new CanvasTexture(canvas);
    this.baseTex.colorSpace = SRGBColorSpace;
    this.baseTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();

    this.stateTex = new DataTexture(this.data.buffer, GRID, GRID, RGBAFormat, UnsignedByteType);
    this.stateTex.magFilter = NearestFilter;
    this.stateTex.minFilter = NearestFilter;
    this.stateTex.needsUpdate = true;
  }

  private commonUniforms() {
    return {
      uBase: { value: this.baseTex },
      uState: { value: this.stateTex },
      uPhoto: { value: this.photoTex },
      uGrid: { value: GRID },
      uOwned: { value: this.data.ownedTile ?? -1 },
      uHasPhoto: { value: this.data.photo ? 1 : 0 },
      uLightDir: { value: new Vector3(0.5, 0.6, 0.8) },
    };
  }

  // --- far LOD sphere ---------------------------------------------------------

  private buildSphere(): void {
    const mat = new ShaderMaterial({
      uniforms: this.commonUniforms(),
      vertexShader: /* glsl */ `
        varying vec2 vUv; varying vec3 vN;
        void main(){ vUv = uv; vN = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uBase, uState, uPhoto;
        uniform float uGrid, uOwned, uHasPhoto; uniform vec3 uLightDir;
        varying vec2 vUv; varying vec3 vN;
        void main(){
          vec3 base = texture2D(uBase, vUv).rgb;
          vec2 g = floor(vUv * uGrid); float idx = g.y*uGrid + g.x;
          float state = texture2D(uState, vUv).r;
          vec3 col;
          if (uHasPhoto > 0.5 && abs(idx - uOwned) < 0.5) col = texture2D(uPhoto, fract(vUv*uGrid)).rgb;
          else if (state < 0.25) col = base;
          else { float l = dot(base, vec3(0.299,0.587,0.114)); col = mix(base, vec3(l), 0.55) * 0.68; }
          float diff = clamp(dot(normalize(vN), normalize(uLightDir)), 0.0, 1.0);
          float rim = pow(1.0 - clamp(vN.z, 0.0, 1.0), 2.5);
          col = col * (0.62 + 0.6*diff) + rim * vec3(0.25,0.55,1.0) * 0.5;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.sphere = new Mesh(new SphereGeometry(1, 96, 64), mat);
    this.scene.add(this.sphere);
  }

  // --- near LOD instanced tiles ----------------------------------------------

  private buildTiles(): void {
    const plane = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute("position", plane.attributes.position);
    geo.setAttribute("uv", plane.attributes.uv);
    this.idAttr = new InstancedBufferAttribute(new Float32Array(CAP), 1);
    this.idAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute("aTileId", this.idAttr);
    geo.instanceCount = 0;
    this.tileGeo = geo;

    const mat = new ShaderMaterial({
      uniforms: { ...this.commonUniforms(), uRadius: { value: 1.003 }, uTileScale: { value: 0.92 } },
      vertexShader: /* glsl */ `
        attribute float aTileId;
        uniform float uGrid, uRadius, uTileScale;
        varying vec2 vTileUv; varying vec2 vLocal; varying vec3 vN;
        void main(){
          float gx = mod(aTileId, uGrid); float gy = floor(aTileId / uGrid);
          float u = (gx + 0.5) / uGrid; float v = (gy + 0.5) / uGrid;
          float theta = u * 6.2831853; float phi = v * 3.1415926;
          float sp = sin(phi), cp = cos(phi);
          vec3 n = vec3(sp*cos(theta), cp, sp*sin(theta));
          vec3 east = normalize(cross(vec3(0.0,1.0,0.0), n) + vec3(1e-5));
          vec3 north = cross(n, east);
          float du = 6.2831853 / uGrid * sp;
          float dv = 3.1415926 / uGrid;
          vec3 pos = n * uRadius
            + east * (position.x * du * uRadius * uTileScale)
            + north * (position.y * dv * uRadius * uTileScale);
          vLocal = uv; vTileUv = vec2(u, v); vN = normalize(normalMatrix * n);
          gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uBase, uState, uPhoto;
        uniform float uGrid, uOwned, uHasPhoto; uniform vec3 uLightDir;
        varying vec2 vTileUv; varying vec2 vLocal; varying vec3 vN;
        void main(){
          vec2 g = floor(vTileUv * uGrid); float idx = g.y*uGrid + g.x;
          float state = texture2D(uState, vTileUv).r;
          vec2 baseUv = (g + vLocal) / uGrid; // this tile's full-detail slice
          vec3 base = texture2D(uBase, baseUv).rgb;
          vec3 col;
          if (uHasPhoto > 0.5 && abs(idx - uOwned) < 0.5) col = texture2D(uPhoto, vLocal).rgb;
          else if (state < 0.25) col = base;
          else {
            vec3 b = base;
            b += texture2D(uBase, baseUv + vec2(0.0009,0.0)).rgb;
            b += texture2D(uBase, baseUv - vec2(0.0009,0.0)).rgb;
            b += texture2D(uBase, baseUv + vec2(0.0,0.0009)).rgb;
            b += texture2D(uBase, baseUv - vec2(0.0,0.0009)).rgb;
            b *= 0.2; float l = dot(b, vec3(0.299,0.587,0.114));
            col = mix(b, vec3(l), 0.55) * 0.68;
          }
          float diff = clamp(dot(normalize(vN), normalize(uLightDir)), 0.0, 1.0);
          col *= (0.78 + 0.42 * diff);
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.tiles = new Mesh(geo, mat);
    this.tiles.frustumCulled = false; // we cull per-instance ourselves
    this.tiles.visible = false;
    this.scene.add(this.tiles);
  }

  // --- octree over cells ------------------------------------------------------

  private buildOctree(): void {
    const items: { pos: Vector3; payload: number }[] = [];
    const p = new Vector3();
    for (let cy = 0; cy < CELLS; cy++) {
      for (let cx = 0; cx < CELLS; cx++) {
        const cid = cy * CELLS + cx;
        const u = (cx + 0.5) / CELLS;
        const v = (cy + 0.5) / CELLS;
        spherePos(u, v, 1, p);
        this.cellNormals[cid * 3] = p.x;
        this.cellNormals[cid * 3 + 1] = p.y;
        this.cellNormals[cid * 3 + 2] = p.z;
        items.push({ pos: p.clone(), payload: cid });
        // Precompute this cell's tile ids.
        let k = 0;
        for (let ty = 0; ty < CELL; ty++) {
          for (let tx = 0; tx < CELL; tx++) {
            const gx = cx * CELL + tx;
            const gy = cy * CELL + ty;
            this.cellTileIds[cid * TPC + k++] = gy * GRID + gx;
          }
        }
      }
    }
    this.octree = new Octree(new Box3(new Vector3(-1.1, -1.1, -1.1), new Vector3(1.1, 1.1, 1.1)), items);
  }

  // --- input ------------------------------------------------------------------

  private bindInput(): void {
    this.input = new InputController(this.renderer.domElement, {
      onDrag: (dx, dy) => {
        const k = 3.0 / this.renderer.domElement.clientWidth;
        this.yaw -= dx * k * 2;
        this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * k * 2));
        this.idle = 0;
      },
      onPinch: (scale) => {
        this.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, this.dist / scale));
        this.idle = 0;
      },
      onWheel: (factor) => {
        this.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, this.dist / factor));
        this.idle = 0;
      },
      onTap: (x, y) => this.pickTile(x, y),
    });
  }

  private pickTile(x: number, y: number): void {
    const el = this.renderer.domElement;
    const ndc = new Vector2((x / el.clientWidth) * 2 - 1, -(y / el.clientHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(this.sphere, false)[0];
    if (!hit || !hit.uv) return;
    const tx = Math.min(GRID - 1, Math.floor(hit.uv.x * GRID));
    const ty = Math.min(GRID - 1, Math.floor(hit.uv.y * GRID));
    const index = ty * GRID + tx;
    this.cb.onTileSelect?.({ index, tx, ty, state: this.data.stateAt(index) });
  }

  // --- photo sync -------------------------------------------------------------

  private syncPhoto(): void {
    if (this.data.photoVersion === this.photoVersionSeen) return;
    this.photoVersionSeen = this.data.photoVersion;
    if (this.photoTex) {
      this.photoTex.dispose();
      this.photoTex = null;
    }
    if (this.data.photo) {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const cx = canvas.getContext("2d")!;
      cx.drawImage(this.data.photo as CanvasImageSource, 0, 0, 256, 256);
      this.photoTex = new CanvasTexture(canvas);
      this.photoTex.colorSpace = SRGBColorSpace;
    }
    const sm = this.sphere.material as ShaderMaterial;
    const tm = this.tiles.material as ShaderMaterial;
    for (const m of [sm, tm]) {
      m.uniforms.uPhoto.value = this.photoTex;
      m.uniforms.uOwned.value = this.data.ownedTile ?? -1;
      m.uniforms.uHasPhoto.value = this.data.photo ? 1 : 0;
    }
  }

  // --- lifecycle --------------------------------------------------------------

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (this.renderer) this.renderer.domElement.style.visibility = active ? "visible" : "hidden";
    if (active) this.onResize();
  }

  focusTile(index: number): void {
    const tx = index % GRID;
    const ty = Math.floor(index / GRID);
    const u = (tx + 0.5) / GRID;
    const v = (ty + 0.5) / GRID;
    this.yaw = -(u * Math.PI * 2) - Math.PI / 2;
    this.pitch = Math.max(-1.4, Math.min(1.4, (0.5 - v) * Math.PI));
    this.dist = 1.75;
    this.idle = 0;
  }

  private onResize = () => {
    if (!this.renderer) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private updateCamera(): void {
    this.idle++;
    if (this.idle > 120) this.yaw += IDLE_SPIN;
    const cp = Math.cos(this.pitch);
    this.camPos.set(
      this.dist * cp * Math.sin(this.yaw),
      this.dist * Math.sin(this.pitch),
      this.dist * cp * Math.cos(this.yaw),
    );
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateMatrixWorld();
  }

  private cullTiles(): number {
    if (!this.octree) return 0;
    this.mtx.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.mtx);
    this.octree.query(this.frustum, this.visibleCells);

    const ids = this.idAttr.array as Float32Array;
    const normals = this.cellNormals;
    const src = this.cellTileIds;
    let n = 0;
    for (const cid of this.visibleCells) {
      // Backface reject: only cells facing the camera.
      const nx = normals[cid * 3];
      const ny = normals[cid * 3 + 1];
      const nz = normals[cid * 3 + 2];
      if (nx * this.camPos.x + ny * this.camPos.y + nz * this.camPos.z <= 0.15) continue;
      if (n + TPC > CAP) break;
      ids.set(src.subarray(cid * TPC, cid * TPC + TPC), n);
      n += TPC;
    }
    this.idAttr.needsUpdate = true;
    return n;
  }

  private loop = () => {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    if (!this.active) return;

    const now = performance.now();
    const dt = now - this.lastT;
    this.lastT = now;
    this.fps = this.fps * 0.9 + (1000 / Math.max(1, dt)) * 0.1;

    this.syncPhoto();
    this.updateCamera();

    const near = this.dist < NEAR_LOD;
    let visibleTiles = 0;
    if (near) {
      visibleTiles = this.cullTiles();
      this.tileGeo.instanceCount = visibleTiles;
      this.tiles.visible = visibleTiles > 0;
    } else {
      this.tiles.visible = false;
    }

    this.renderer.render(this.scene, this.camera);
    this.emitHud(near, visibleTiles);
  };

  private emitHud(near: boolean, visibleTiles: number): void {
    if (this.hudTick++ % 10 !== 0) return;
    const zoom = Math.round(((MAX_DIST - this.dist) / (MAX_DIST - MIN_DIST)) * 400 + 100);
    this.cb.onHud?.({
      mode: "3d",
      zoomPct: zoom,
      owned: this.data.ownedTile,
      residentChunks: near ? this.visibleCells.length : 0,
      loadedChunks: visibleTiles,
      fps: Math.round(this.fps),
    });
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.onResize);
    this.unsub?.();
    this.input?.destroy();
    this.photoTex?.dispose();
    this.baseTex?.dispose();
    this.stateTex?.dispose();
    (this.sphere?.material as ShaderMaterial)?.dispose();
    this.sphere?.geometry?.dispose();
    (this.tiles?.material as ShaderMaterial)?.dispose();
    this.tileGeo?.dispose();
    this.renderer?.dispose();
    if (this.renderer?.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
