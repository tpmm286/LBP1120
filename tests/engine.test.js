/**
 * Automated Unit & Protocol Tests for Canon LBP-1120 CAPT/SCoA Engine
 * Can be run in Node.js, Electron, or GitHub Actions without physical hardware.
 */

import assert from 'node:assert';
import {
  CANON_VID,
  LBP1120_PID,
  PAPER_SPECS,
  OP_PC_RESERVE_UNIT,
  OP_PCR_GO_ONLINE,
  OP_IC_BEGIN_PAGE,
} from '../src_core/constants.js';
import { CaptPacketBuilder } from '../src_core/packet.js';
import { encodeScoa, decodeScoa, SCOA_CMD } from '../src_core/scoa.js';
import { createTestPageRaster, rgbaTo1BppRaster } from '../src_core/raster.js';
import { SimulatedCaptPrinterTransport } from '../src_core/simulated_transport.js';

let totalTests = 0;
let passedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    passedTests++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
    throw err;
  }
}

console.log('--- Starting Canon LBP-1120 CAPT/SCoA Test Suite ---');

// 1. USB Descriptor & Parameter Tests
runTest('USB VID and PID match Canon LBP-1120', () => {
  assert.strictEqual(CANON_VID, 0x04A9);
  assert.strictEqual(LBP1120_PID, 0x262B);
});

runTest('Raster dimensions satisfy 32-bit and 32-line alignment', () => {
  const a4 = PAPER_SPECS.A4;
  assert.strictEqual(a4.lineBytes % 4, 0, 'A4 lineBytes must be multiple of 4 (32-bit boundary)');
  assert.strictEqual(a4.heightLines % 32, 0, 'A4 heightLines must be multiple of 32');

  const letter = PAPER_SPECS.Letter;
  assert.strictEqual(letter.lineBytes % 4, 0, 'Letter lineBytes must be multiple of 4');
  assert.strictEqual(letter.heightLines % 32, 0, 'Letter heightLines must be multiple of 32');
});

// 2. Packet Construction Tests
runTest('CAPT packet header format and Little-Endian encoding', () => {
  const dummyPayload = new Uint8Array([0x12, 0x34, 0x56, 0x78]);
  const packet = CaptPacketBuilder.buildPacket(0xA2A0, dummyPayload);

  assert.strictEqual(packet.length, 8);
  const header = CaptPacketBuilder.parseHeader(packet);
  assert.strictEqual(header.opcode, 0xA2A0);
  assert.strictEqual(header.length, 8);
  assert.strictEqual(packet[4], 0x12);
  assert.strictEqual(packet[7], 0x78);
});

runTest('PCR_GO_ONLINE packet construction with magic 0xADEADBEE', () => {
  const packet = CaptPacketBuilder.buildGoOnline(0);
  assert.strictEqual(packet.length, 12); // 4 header + 8 payload
  const view = new DataView(packet.buffer);
  assert.strictEqual(view.getUint16(0, true), 0xE0A5);
  assert.strictEqual(view.getUint32(4, true), 0xADEADBEE);
});

runTest('IC_BEGIN_PAGE page parameters match LBP-1120 specification', () => {
  const packet = CaptPacketBuilder.buildBeginPage({
    paperSize: 0x09,
    lineBytes: 620,
    heightLines: 7040,
    paperWidth: 4960,
    paperHeight: 7040,
  });

  assert.strictEqual(packet.length, 38); // 4 header + 34 payload
  const view = new DataView(packet.buffer);
  assert.strictEqual(view.getUint16(0, true), 0xD0A0);
  assert.strictEqual(view.getUint16(6, true), 0x03FC); // TargetModel LBP1120
  assert.strictEqual(view.getUint16(8, true), 0x09);   // PaperSize A4
  assert.strictEqual(view.getUint16(12, true), 0x11);  // Resolution 600 DPI
  assert.strictEqual(view.getUint16(18, true), 620);   // lineBytes
  assert.strictEqual(view.getUint16(20, true), 7040);  // heightLines
});

// 3. SCoA Compression / Decompression Tests
runTest('SCoA encode/decode round-trip produces bit-exact raster', () => {
  const lineBytes = 32;
  const heightLines = 64;
  const originalRaster = new Uint8Array(lineBytes * heightLines);

  // Seed sample pattern: alternating lines and repeated byte runs
  for (let y = 0; y < heightLines; y++) {
    for (let x = 0; x < lineBytes; x++) {
      if ((x + y) % 3 === 0) {
        originalRaster[y * lineBytes + x] = 0xAA;
      } else if (y % 4 === 0) {
        originalRaster[y * lineBytes + x] = 0x43; // Trigger special repeat-X
      } else if (x === 10) {
        originalRaster[y * lineBytes + x] = 0xFF;
      }
    }
  }

  const scoaStream = encodeScoa(originalRaster, lineBytes, heightLines);
  assert(scoaStream.length > 0, 'SCoA stream should not be empty');
  assert.strictEqual(scoaStream[scoaStream.length - (scoaStream.length % 2 === 0 ? 2 : 1)], SCOA_CMD.EOP);

  const decodedRaster = decodeScoa(scoaStream, lineBytes, heightLines);
  assert.strictEqual(decodedRaster.length, originalRaster.length);

  for (let i = 0; i < originalRaster.length; i++) {
    if (decodedRaster[i] !== originalRaster[i]) {
      throw new Error(`Byte mismatch at index ${i}: expected 0x${originalRaster[i].toString(16)}, got 0x${decodedRaster[i].toString(16)}`);
    }
  }
});

// 4. 1-bit Image Processor Test
runTest('RGBA to 1-bpp monochrome raster conversion', () => {
  const width = 16;
  const height = 4;
  const rgbaData = new Uint8ClampedArray(width * height * 4);

  // Make pixel (0, 0) black (0,0,0, 255)
  rgbaData[0] = 0;
  rgbaData[1] = 0;
  rgbaData[2] = 0;
  rgbaData[3] = 255;

  // Make pixel (1, 0) white (255,255,255, 255)
  rgbaData[4] = 255;
  rgbaData[5] = 255;
  rgbaData[6] = 255;
  rgbaData[7] = 255;

  const raster = rgbaTo1BppRaster({ width, height, data: rgbaData }, 4, 4);
  assert.strictEqual(raster[0] & 0x80, 0x80, 'Pixel (0,0) should be set (black)');
  assert.strictEqual(raster[0] & 0x40, 0x00, 'Pixel (1,0) should be 0 (white)');
});

// 5. Test Page Raster Generation
runTest('Test page raster generation produces valid non-zero bitmap', () => {
  const page = createTestPageRaster('A4');
  assert.strictEqual(page.lineBytes, 620);
  assert.strictEqual(page.heightLines, 7040);
  assert.strictEqual(page.raster.length, 620 * 7040);

  let blackPixels = 0;
  for (let i = 0; i < page.raster.length; i++) {
    if (page.raster[i] !== 0) blackPixels++;
  }
  assert(blackPixels > 100, 'Test page must contain geometry lines and markers');
});

// 6. Simulated Transport Protocol Flow Test
await runAsyncTest('Simulated printer transport executes complete CAPT v1 sequence without hardware', async () => {
  const transport = new SimulatedCaptPrinterTransport();
  await transport.open();
  await transport.selectConfiguration(1);
  await transport.claimInterface(0);

  // Reserve
  await transport.transferOut(0x01, CaptPacketBuilder.buildPacket(OP_PC_RESERVE_UNIT));
  assert(transport.isUnitReserved);

  // Clear & Go Online
  await transport.transferOut(0x01, CaptPacketBuilder.buildPacket(0xE0A2));
  await transport.transferOut(0x01, CaptPacketBuilder.buildGoOnline(0));
  assert(transport.isOnline);

  // Begin Page & Data
  await transport.transferOut(0x01, CaptPacketBuilder.buildBeginPage({}));
  await transport.transferOut(0x01, CaptPacketBuilder.buildPacket(0xD0A1));
  assert(transport.pageStarted);

  // Send Video Chunk
  const videoChunk = new Uint8Array([0x80, 0x10, 0x41, 0x42]);
  await transport.transferOut(0x01, CaptPacketBuilder.buildVideoData(videoChunk));
  assert.strictEqual(transport.videoChunksReceived, 1);

  // End Page
  await transport.transferOut(0x01, CaptPacketBuilder.buildPacket(0xD0A2));
  assert(transport.pageEnded);

  // Offline & Release
  await transport.transferOut(0x01, CaptPacketBuilder.buildPacket(0xE0A6));
  await transport.transferOut(0x01, CaptPacketBuilder.buildPacket(0xE0A9));
  assert(!transport.isOnline);
  assert(!transport.isUnitReserved);

  await transport.close();
  assert(!transport.opened);
});

console.log(`\nAll ${passedTests}/${totalTests} tests passed successfully.`);
