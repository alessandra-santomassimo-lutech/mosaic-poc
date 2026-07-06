// Procedural "underlying image" generator.
// The base image is treated as an effectively huge continuous picture; each chunk
// paints a slice of it. Colours are a pure function of absolute mosaic UV, so
// neighbouring chunks (and different LODs) line up seamlessly. In production this
// generator is swapped for a network/CDN tile source — the loader stays identical.

const ART = 128; // native pixels per chunk (upsampled on screen)

function hashLattice(ix: number, iy: number): number {
  let h = (ix * 374761393 + iy * 668265263) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smooth(x - ix);
  const fy = smooth(y - iy);
  const a = hashLattice(ix, iy);
  const b = hashLattice(ix + 1, iy);
  const c = hashLattice(ix, iy + 1);
  const d = hashLattice(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < 5; o++) {
    sum += valueNoise(x * freq, y * freq) * amp;
    freq *= 2.02;
    amp *= 0.5;
  }
  return sum;
}

// Nebula palette: deep space blue -> violet -> cyan/magenta highlights.
function palette(t: number, out: [number, number, number]): void {
  const clamped = Math.min(1, Math.max(0, t));
  // three-stop gradient
  const stops: [number, number, number][] = [
    [10, 12, 40], // deep blue-black
    [70, 40, 130], // violet
    [90, 200, 235], // cyan
  ];
  const seg = clamped * 2;
  const i = Math.min(1, Math.floor(seg));
  const f = seg - i;
  const lo = stops[i];
  const hi = stops[i + 1];
  out[0] = lo[0] + (hi[0] - lo[0]) * f;
  out[1] = lo[1] + (hi[1] - lo[1]) * f;
  out[2] = lo[2] + (hi[2] - lo[2]) * f;
}

/**
 * Paint one chunk of the base image into a canvas.
 * @param uvMinX,uvMinY top-left of the chunk in mosaic UV [0,1]
 * @param uvSpan       chunk size in mosaic UV
 */
export function generateChunkCanvas(uvMinX: number, uvMinY: number, uvSpan: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = ART;
  canvas.height = ART;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(ART, ART);
  const data = img.data;
  const rgb: [number, number, number] = [0, 0, 0];

  // Field frequency in UV space -> large-scale nebula clouds.
  const FREQ = 6.0;

  for (let py = 0; py < ART; py++) {
    const v = uvMinY + (py / ART) * uvSpan;
    for (let px = 0; px < ART; px++) {
      const u = uvMinX + (px / ART) * uvSpan;

      const n = fbm(u * FREQ + 3.1, v * FREQ + 7.7);
      const swirl = fbm(u * FREQ * 2.3 - 5.0, v * FREQ * 2.3 + 2.0);
      const t = n * 0.75 + swirl * 0.35;
      palette(t, rgb);

      // Sparse bright "stars" from a high-frequency threshold.
      const star = valueNoise(u * 900 + 0.5, v * 900 + 0.5);
      const starHit = star > 0.985 ? (star - 0.985) / 0.015 : 0;

      const o = (py * ART + px) * 4;
      data[o] = Math.min(255, rgb[0] + starHit * 220);
      data[o + 1] = Math.min(255, rgb[1] + starHit * 220);
      data[o + 2] = Math.min(255, rgb[2] + starHit * 235);
      data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
