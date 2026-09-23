/**
 * SCoA (Smart Compression Architecture) Compression & Decompression
 * Canonical implementation ported from libcapt/libcapt/Compression/
 */

export const SCOA_CMD = {
  NOP: 0x40,
  EOL: 0x41,
  EOP: 0x42,
  REPEAT_X: 0x43,
  RAW_BYTE_ESCAPE: 0x44,
};

/**
 * Encodes a monochrome 1-bpp raster into a SCoA byte stream.
 * @param {Uint8Array} raster - 1bpp raw raster (0 = white, 1 = black)
 * @param {number} lineBytes - bytes per scanline (e.g. 620 for A4)
 * @param {number} heightLines - number of scanlines (e.g. 7040 for A4)
 * @returns {Uint8Array} SCoA compressed byte stream ending with EOP
 */
export function encodeScoa(raster, lineBytes, heightLines) {
  const output = [];
  const prevLine = new Uint8Array(lineBytes); // all zeros initially
  let offset = 0;

  for (let line = 0; line < heightLines; line++) {
    const currentLine = raster.subarray(offset, offset + lineBytes);
    offset += lineBytes;

    let x = 0;
    while (x < lineBytes) {
      // 1. Check for identical bytes to previous line (COPY command)
      let copyLen = 0;
      while (x + copyLen < lineBytes && currentLine[x + copyLen] === prevLine[x + copyLen]) {
        copyLen++;
      }

      if (copyLen > 0) {
        while (copyLen > 0) {
          const run = Math.min(copyLen, 0x3F);
          output.push(0x80 | run);
          x += run;
          copyLen -= run;
        }
        continue;
      }

      // 2. Check for repeated byte in current line
      const val = currentLine[x];
      let repeatLen = 1;
      while (
        x + repeatLen < lineBytes &&
        currentLine[x + repeatLen] === val &&
        repeatLen < 0x3F &&
        currentLine[x + repeatLen] !== prevLine[x + repeatLen] // Stop if matching prevLine
      ) {
        repeatLen++;
      }

      if (repeatLen >= 3) {
        if (val === 0x43) {
          output.push(0x43);
          output.push(repeatLen);
        } else {
          output.push(0x40);
          output.push(repeatLen);
          output.push(val);
        }
        x += repeatLen;
        continue;
      }

      // 3. Emit RAW bytes
      const rawBytes = [];
      while (
        x < lineBytes &&
        rawBytes.length < 0x3F &&
        currentLine[x] !== prevLine[x]
      ) {
        // Check if a repeat sequence of >=3 starts
        if (
          x + 2 < lineBytes &&
          currentLine[x] === currentLine[x + 1] &&
          currentLine[x] === currentLine[x + 2] &&
          currentLine[x] !== prevLine[x] &&
          currentLine[x + 1] !== prevLine[x + 1] &&
          currentLine[x + 2] !== prevLine[x + 2]
        ) {
          break; // break to emit repeat
        }
        rawBytes.push(currentLine[x]);
        x++;
      }

      if (rawBytes.length > 0) {
        output.push(rawBytes.length);
        for (let b = 0; b < rawBytes.length; b++) {
          output.push(rawBytes[b]);
        }
      }
    }

    // End of Scanline
    output.push(SCOA_CMD.EOL); // 0x41
    prevLine.set(currentLine);
  }

  // End of Page
  output.push(SCOA_CMD.EOP); // 0x42

  // Align total stream length to even bytes if odd
  if (output.length % 2 !== 0) {
    output.push(SCOA_CMD.NOP); // 0x40
  }

  return new Uint8Array(output);
}

/**
 * Decodes a SCoA compressed byte stream back to 1-bpp raw raster.
 * Used for automated verification and round-trip unit testing.
 */
export function decodeScoa(scoaStream, lineBytes, heightLines) {
  const raster = new Uint8Array(lineBytes * heightLines);
  const prevLine = new Uint8Array(lineBytes);
  const currentLine = new Uint8Array(lineBytes);

  let inIdx = 0;
  let line = 0;
  let x = 0;

  while (inIdx < scoaStream.length && line < heightLines) {
    const cmd = scoaStream[inIdx++];

    if (cmd === SCOA_CMD.EOP) {
      break;
    } else if (cmd === SCOA_CMD.EOL) {
      // Commit scanline
      raster.set(currentLine, line * lineBytes);
      prevLine.set(currentLine);
      currentLine.fill(0);
      line++;
      x = 0;
    } else if (cmd === SCOA_CMD.NOP) {
      // No operation / padding
      continue;
    } else if ((cmd & 0x80) !== 0) {
      // COPY command: copy (cmd & 0x7F) bytes from prevLine
      const count = cmd & 0x7F;
      for (let i = 0; i < count; i++) {
        currentLine[x] = prevLine[x];
        x++;
      }
    } else if (cmd === 0x43) {
      // Repeat 0x43
      const count = scoaStream[inIdx++];
      for (let i = 0; i < count; i++) {
        currentLine[x++] = 0x43;
      }
    } else if (cmd === 0x40) {
      // Repeat arbitrary byte
      const count = scoaStream[inIdx++];
      const val = scoaStream[inIdx++];
      for (let i = 0; i < count; i++) {
        currentLine[x++] = val;
      }
    } else if (cmd > 0 && cmd < 0x40) {
      // RAW byte run of length cmd
      for (let i = 0; i < cmd; i++) {
        currentLine[x++] = scoaStream[inIdx++];
      }
    }
  }

  return raster;
}
