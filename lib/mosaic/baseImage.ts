// Underlying image for the mosaic: mona-lisa.jpg, "contain"-fitted into the
// square mosaic UV space so its aspect ratio is preserved (dark letterbox on the
// sides). Each chunk crops the corresponding region of the image, so the chunk
// pyramid / lazy loading / eviction all keep working unchanged — only the pixels
// a chunk paints have changed (procedural noise -> real image crop).

const ART = 256; // native pixels per chunk (upsampled on screen)
const BG = "#05060f";

let baseImg: HTMLImageElement | null = null;
let imgW = 1;
let imgH = 1;

// Content rectangle in mosaic UV [0,1], preserving the image aspect ratio.
let cMinX = 0;
let cMinY = 0;
let cSpanX = 1;
let cSpanY = 1;

/** Load and decode the base image once. Must resolve before chunks generate. */
export async function loadBaseImage(url: string): Promise<void> {
  if (baseImg) return;
  const img = new Image();
  img.src = url;
  await img.decode();
  baseImg = img;
  imgW = img.naturalWidth;
  imgH = img.naturalHeight;

  const aspect = imgW / imgH;
  if (aspect >= 1) {
    // Landscape: full width, letterbox top/bottom.
    cSpanX = 1;
    cSpanY = 1 / aspect;
    cMinX = 0;
    cMinY = (1 - cSpanY) / 2;
  } else {
    // Portrait: full height, letterbox left/right.
    cSpanX = aspect;
    cSpanY = 1;
    cMinX = (1 - cSpanX) / 2;
    cMinY = 0;
  }
}

/** The loaded image + its contain rect in mosaic UV, or null if not yet loaded. */
export function getBaseContain(): {
  img: HTMLImageElement;
  minX: number;
  minY: number;
  spanX: number;
  spanY: number;
} | null {
  if (!baseImg) return null;
  return { img: baseImg, minX: cMinX, minY: cMinY, spanX: cSpanX, spanY: cSpanY };
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
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, ART, ART);

  if (!baseImg) return canvas;

  // Overlap of this chunk's UV rect with the image content rect.
  const oU0 = Math.max(uvMinX, cMinX);
  const oU1 = Math.min(uvMinX + uvSpan, cMinX + cSpanX);
  const oV0 = Math.max(uvMinY, cMinY);
  const oV1 = Math.min(uvMinY + uvSpan, cMinY + cSpanY);
  if (oU1 <= oU0 || oV1 <= oV0) return canvas; // fully in the letterbox

  // Source rect in image pixels.
  const sx = ((oU0 - cMinX) / cSpanX) * imgW;
  const sy = ((oV0 - cMinY) / cSpanY) * imgH;
  const sw = ((oU1 - oU0) / cSpanX) * imgW;
  const sh = ((oV1 - oV0) / cSpanY) * imgH;

  // Destination rect in the chunk canvas.
  const dx = ((oU0 - uvMinX) / uvSpan) * ART;
  const dy = ((oV0 - uvMinY) / uvSpan) * ART;
  const dw = ((oU1 - oU0) / uvSpan) * ART;
  const dh = ((oV1 - oV0) / uvSpan) * ART;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(baseImg, sx, sy, sw, sh, dx, dy, dw, dh);
  return canvas;
}
