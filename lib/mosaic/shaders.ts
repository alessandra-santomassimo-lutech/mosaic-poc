// GLSL ES 3.0 shader sources.
// PixiJS preserves `#version 300 es` and treats these as GLSL ES 3.0
// (use in/out + texture(); GlProgram injects default precision + name).

// ---------------------------------------------------------------------------
// Composite pass — a size-independent full-screen quad drawn in clip space.
// aPos is in [0,1]; we map it to clip space directly so the same mesh fills any
// target (the screen in 2D, or a RenderTexture for the 3D globe). uFlipY / uFlipV
// reconcile the top-left (screen) vs bottom-left (RenderTexture) origin.
// ---------------------------------------------------------------------------

export const compositeVert = /* glsl */ `#version 300 es
in vec2 aPos;
in vec2 aUv;
out vec2 vUv;
uniform float uFlipY;
uniform float uFlipV;
void main() {
  vUv = vec2(aUv.x, mix(aUv.y, 1.0 - aUv.y, uFlipV));
  vec2 p = aPos * 2.0 - 1.0;
  gl_Position = vec4(p.x, p.y * uFlipY, 0.0, 1.0);
}
`;

export const compositeFrag = /* glsl */ `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uBase;   // resident base chunks rendered for this region
uniform sampler2D uState;  // 1 texel per tile, red channel = state
uniform sampler2D uPhoto;  // current user's uploaded photo

uniform vec2  uMosaicMin;  // region origin in mosaic UV
uniform vec2  uMosaicSpan; // region size in mosaic UV
uniform vec2  uGrid;       // (1000, 1000)
uniform vec2  uTexel;      // 1 / base render-texture size, for blur taps
uniform float uUserTile;   // owned tile index, or -1
uniform float uHasPhoto;   // 1 if a photo texture is bound
uniform float uPxPerTile;  // approx screen px per tile (grid-line fade)
uniform float uDebug;      // >0.5 -> visualise raw tile state

vec3 blurBase(vec2 uv) {
  vec3 c = vec3(0.0);
  for (int y = -2; y <= 2; y++) {
    for (int x = -2; x <= 2; x++) {
      c += texture(uBase, uv + vec2(float(x), float(y)) * uTexel * 2.5).rgb;
    }
  }
  return c / 25.0;
}

void main() {
  vec2 mUv = uMosaicMin + vUv * uMosaicSpan;
  vec3 base = texture(uBase, vUv).rgb;

  vec2 tile = floor(mUv * uGrid);
  float idx = tile.y * uGrid.x + tile.x;
  float state = texture(uState, (tile + 0.5) / uGrid).r;

  if (uDebug > 0.5) {
    // Blue background proves the branch runs; red channel = raw state value.
    fragColor = vec4(state, 0.0, 1.0, 1.0);
    return;
  }

  vec3 col;
  if (state < 0.25) {
    // Unpurchased: reveal the underlying image.
    col = base;
  } else if (uHasPhoto > 0.5 && abs(idx - uUserTile) < 0.5) {
    // Current user's tile: show the uploaded photo, tile-local UV.
    col = texture(uPhoto, fract(mUv * uGrid)).rgb;
  } else {
    // Purchased by someone else: blurred, desaturated, dimmed.
    vec3 b = blurBase(vUv);
    float g = dot(b, vec3(0.299, 0.587, 0.114));
    col = mix(b, vec3(g), 0.55) * 0.68;
  }

  // Subtle glowing grid lines; fade out once tiles get tiny on screen.
  vec2 f = abs(fract(mUv * uGrid) - 0.5);
  float line = 1.0 - smoothstep(0.46, 0.5, max(f.x, f.y));
  float gridFade = clamp((uPxPerTile - 4.0) / 14.0, 0.0, 1.0);
  col += line * gridFade * 0.14 * vec3(0.45, 0.85, 1.0);

  // Highlight ring around the owned tile so it is findable.
  if (uHasPhoto > 0.5) {
    float owy = floor(uUserTile / uGrid.x);
    float owx = uUserTile - owy * uGrid.x;
    if (abs(tile.x - owx) < 0.5 && abs(tile.y - owy) < 0.5) {
      float ring = smoothstep(0.40, 0.46, max(f.x, f.y));
      col += ring * vec3(1.0, 0.85, 0.3) * 0.9;
    }
  }

  fragColor = vec4(col, 1.0);
}
`;

// ---------------------------------------------------------------------------
// Globe pass — a UV sphere sampling the composite RenderTexture (equirect),
// with simple lambert + rim lighting for depth. Back-face culled (convex),
// so no depth buffer is required.
// ---------------------------------------------------------------------------

export const sphereVert = /* glsl */ `#version 300 es
in vec3 aPos;
in vec2 aUv;
out vec2 vUv;
out vec3 vNormal;
uniform mat4 uMVP;
uniform mat4 uModel;
void main() {
  vUv = aUv;
  vNormal = normalize((uModel * vec4(aPos, 0.0)).xyz);
  gl_Position = uMVP * vec4(aPos, 1.0);
}
`;

export const sphereFrag = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
in vec3 vNormal;
out vec4 fragColor;
uniform sampler2D uTex;
uniform vec3 uLightDir;
void main() {
  vec3 albedo = texture(uTex, vUv).rgb;
  vec3 n = normalize(vNormal);
  float diff = clamp(dot(n, normalize(uLightDir)), 0.0, 1.0);
  float rim = pow(1.0 - clamp(n.z, 0.0, 1.0), 2.5);
  vec3 col = albedo * (0.45 + 0.75 * diff) + rim * vec3(0.25, 0.55, 1.0) * 0.6;
  fragColor = vec4(col, 1.0);
}
`;
