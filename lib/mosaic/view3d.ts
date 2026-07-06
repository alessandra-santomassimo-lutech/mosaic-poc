// 3D globe view: a UV sphere sampling the composite RenderTexture (equirect).
// Convex + back-face culled, so no depth buffer is needed. Drag orbits, pinch/
// wheel dollies, and it slowly auto-spins when idle.

import {
  Geometry,
  Mesh,
  type Renderer,
  Shader,
  State,
  type Texture,
  UniformGroup,
} from "pixi.js";
import { multiply, perspective, rotationX, rotationY, translation } from "./camera";
import { sphereFrag, sphereVert } from "./shaders";

const STACKS = 64;
const SLICES = 128;
const MIN_DIST = 1.55;
const MAX_DIST = 4.5;
const IDLE_SPIN = 0.0016; // rad/frame

function buildSphere(): Geometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= STACKS; i++) {
    const v = i / STACKS;
    const phi = v * Math.PI; // 0..pi
    const sinP = Math.sin(phi);
    const cosP = Math.cos(phi);
    for (let j = 0; j <= SLICES; j++) {
      const u = j / SLICES;
      const theta = u * Math.PI * 2;
      const x = sinP * Math.cos(theta);
      const y = cosP;
      const z = sinP * Math.sin(theta);
      positions.push(x, y, z);
      uvs.push(u, v);
    }
  }
  const row = SLICES + 1;
  for (let i = 0; i < STACKS; i++) {
    for (let j = 0; j < SLICES; j++) {
      const a = i * row + j;
      const b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }

  return new Geometry({
    attributes: {
      aPos: { buffer: new Float32Array(positions), format: "float32x3" },
      aUv: { buffer: new Float32Array(uvs), format: "float32x2" },
    },
    indexBuffer: new Uint32Array(indices),
  });
}

export class View3D {
  private readonly mesh: Mesh<Geometry, Shader>;
  private readonly shader: Shader;
  private readonly uniforms: UniformGroup;
  private readonly mvp = new Float32Array(16);

  yaw = 0;
  pitch = 0.35;
  dist = 2.8;
  private idleFrames = 0;

  constructor(compositeTexture: Texture) {
    this.uniforms = new UniformGroup({
      uMVP: { value: new Float32Array(16), type: "mat4x4<f32>" },
      uModel: { value: new Float32Array(16), type: "mat4x4<f32>" },
      uLightDir: { value: new Float32Array([0.5, 0.6, 0.8]), type: "vec3<f32>" },
    });

    this.shader = Shader.from({
      gl: { vertex: sphereVert, fragment: sphereFrag },
      resources: {
        uTex: compositeTexture.source,
        globe: this.uniforms,
      },
    });

    const state = new State();
    state.culling = true;
    state.cullMode = "back";
    state.depthTest = false;
    state.blend = true;

    this.mesh = new Mesh({ geometry: buildSphere(), shader: this.shader, state });
  }

  orbit(dx: number, dy: number, w: number): void {
    const k = 3.0 / w;
    this.yaw -= dx * k * 2;
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * k * 2));
    this.idleFrames = 0;
  }

  dolly(factor: number): void {
    this.dist = Math.max(MIN_DIST, Math.min(MAX_DIST, this.dist / factor));
    this.idleFrames = 0;
  }

  update(): void {
    this.idleFrames++;
    if (this.idleFrames > 120) this.yaw += IDLE_SPIN; // gentle auto-spin when idle
  }

  render(renderer: Renderer, w: number, h: number): void {
    const proj = perspective(Math.PI / 4, w / h, 0.1, 20);
    const view = translation(0, 0, -this.dist);
    const model = multiply(rotationY(this.yaw), rotationX(this.pitch));

    const vm = multiply(view, model);
    multiply(proj, vm, this.mvp);

    const u = this.uniforms.uniforms as Record<string, Float32Array>;
    u.uMVP.set(this.mvp);
    u.uModel.set(model);

    renderer.render({ container: this.mesh, target: undefined, clear: true });
  }

  destroy(): void {
    this.mesh.destroy();
    this.shader.destroy();
  }
}
