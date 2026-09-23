/**
 * 600 DPI Diagnostic Test Page Generator & 1-bit Image Processor
 * Strictly adheres to 32-bit line size and 32-line height crop rules.
 */

import { PAPER_SPECS } from './constants.js';

export function createTestPageRaster(paperType = 'A4') {
  const spec = PAPER_SPECS[paperType] || PAPER_SPECS.A4;
  const lineBytes = spec.lineBytes;
  const heightLines = spec.heightLines;
  const widthPixels = lineBytes * 8; // e.g. 620 * 8 = 4960
  const heightPixels = heightLines;  // e.g. 7040

  const raster = new Uint8Array(lineBytes * heightLines);

  const setPixel = (x, y) => {
    if (x < 0 || x >= widthPixels || y < 0 || y >= heightPixels) return;
    const byteIndex = y * lineBytes + (x >> 3);
    const bitMask = 0x80 >> (x & 7);
    raster[byteIndex] |= bitMask;
  };

  const drawHLine = (x1, x2, y) => {
    for (let x = x1; x <= x2; x++) setPixel(x, y);
  };

  const drawVLine = (x, y1, y2) => {
    for (let y = y1; y <= y2; y++) setPixel(x, y);
  };

  const drawRect = (x, y, w, h) => {
    drawHLine(x, x + w, y);
    drawHLine(x, x + w, y + h);
    drawVLine(x, y, y + h);
    drawVLine(x + w, y, y + h);
  };

  // 1. Draw outer boundary box (1-inch margin = 600 dots)
  const margin = 300;
  drawRect(margin, margin, widthPixels - 2 * margin, heightPixels - 2 * margin);
  drawRect(margin + 20, margin + 20, widthPixels - 2 * margin - 40, heightPixels - 2 * margin - 40);

  // 2. Center Alignment Crosshair
  const cx = Math.floor(widthPixels / 2);
  const cy = Math.floor(heightPixels / 2);
  drawHLine(cx - 300, cx + 300, cy);
  drawVLine(cx, cy - 300, cy + 300);

  // 3. Corner registration marks
  const corners = [
    [margin + 50, margin + 50],
    [widthPixels - margin - 50, margin + 50],
    [margin + 50, heightPixels - margin - 50],
    [widthPixels - margin - 50, heightPixels - margin - 50],
  ];
  for (const [kx, ky] of corners) {
    drawHLine(kx - 50, kx + 50, ky);
    drawVLine(kx, ky - 50, ky + 50);
  }

  // 4. 1-pixel beam resolution ladder test
  const ladderY = margin + 150;
  for (let i = 0; i < 60; i++) {
    drawVLine(margin + 100 + i * 4, ladderY, ladderY + 120);
  }

  // 5. Half-tone pattern block (Checkerboard pattern)
  const patternY = margin + 400;
  for (let py = 0; py < 100; py++) {
    for (let px = 0; px < 400; px++) {
      if ((px + py) % 2 === 0) {
        setPixel(margin + 100 + px, patternY + py);
      }
    }
  }

  return {
    raster,
    lineBytes,
    heightLines,
    widthPixels,
    heightPixels,
    paperSizeCode: spec.paperSizeCode,
  };
}

/**
 * Converts ImageData (RGBA 8-bit) to 1-bpp monochrome raster with thresholding.
 */
export function rgbaTo1BppRaster(imageData, targetLineBytes, targetHeight) {
  const { width, height, data } = imageData;
  const raster = new Uint8Array(targetLineBytes * targetHeight);

  const minW = Math.min(width, targetLineBytes * 8);
  const minH = Math.min(height, targetHeight);

  for (let y = 0; y < minH; y++) {
    const rowOffset = y * targetLineBytes;
    for (let x = 0; x < minW; x++) {
      const idx = (y * width + x) * 4;
      // Perceptual luminance: 0.299 R + 0.587 G + 0.114 B
      const lum = (data[idx] * 299 + data[idx + 1] * 587 + data[idx + 2] * 114) / 1000;
      // Alpha check
      const alpha = data[idx + 3];
      if (alpha > 64 && lum < 160) {
        // Black pixel
        raster[rowOffset + (x >> 3)] |= (0x80 >> (x & 7));
      }
    }
  }

  return raster;
}
