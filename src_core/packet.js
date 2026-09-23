/**
 * CAPT v1 Packet Builder and Serializer
 * Little-endian binary packet construction for Canon CAPT v1 protocol
 */

import { TARGET_MODEL_LBP1120 } from './constants.js';

export class CaptPacketBuilder {
  /**
   * Builds standard 4-byte header packet with optional payload.
   * Header format:
   *  uint16_t opcode (little endian)
   *  uint16_t length (little endian, size of header + payload)
   *  uint8_t payload[length - 4]
   */
  static buildPacket(opcode, payload = new Uint8Array(0)) {
    const totalLength = 4 + payload.length;
    const packet = new Uint8Array(totalLength);
    const view = new DataView(packet.buffer);

    view.setUint16(0, opcode, true);
    view.setUint16(2, totalLength, true);

    if (payload.length > 0) {
      packet.set(payload, 4);
    }
    return packet;
  }

  /**
   * Parses packet header from raw bytes.
   */
  static parseHeader(bytes) {
    if (bytes.length < 4) {
      throw new Error(`Packet too short for header: ${bytes.length} bytes (min 4 required)`);
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, 4);
    const opcode = view.getUint16(0, true);
    const length = view.getUint16(2, true);
    return { opcode, length };
  }

  /**
   * PCR_GO_ONLINE (0xE0A5)
   * Payload: 8 bytes
   *  uint32_t magic: 0xADEADBEE
   *  uint16_t pageNumber: 0
   *  uint16_t reserved: 0
   */
  static buildGoOnline(pageNumber = 0) {
    const payload = new Uint8Array(8);
    const view = new DataView(payload.buffer);
    view.setUint32(0, 0xADEADBEE, true);
    view.setUint16(4, pageNumber, true);
    view.setUint16(6, 0, true);
    return this.buildPacket(0xE0A5, payload);
  }

  /**
   * IC_BEGIN_PAGE (0xD0A0)
   * Payload: 34 bytes
   * Format matching libcapt Protocol.cpp:
   *  uint16_t const0: 0
   *  uint16_t targetModel: 0x03FC
   *  uint16_t paperSize: e.g. 0x09 (A4)
   *  uint16_t const0_2: 0
   *  uint16_t resolution: 0x11 (600 DPI)
   *  uint16_t marginLeft: 1
   *  uint16_t marginTop: 1
   *  uint16_t imageLineSize: bytes per scanline (e.g. 620)
   *  uint16_t imageLines: number of scanlines (e.g. 7040)
   *  uint16_t paperWidth: paper width in dots (e.g. 4960)
   *  uint16_t paperHeight: paper height in dots (e.g. 7040)
   *  uint8_t  padding[12]: zeros
   */
  static buildBeginPage({ paperSize = 0x09, lineBytes = 620, heightLines = 7040, paperWidth = 4960, paperHeight = 7040 }) {
    const payload = new Uint8Array(34);
    const view = new DataView(payload.buffer);

    view.setUint16(0, 0, true);
    view.setUint16(2, TARGET_MODEL_LBP1120, true); // 0x03FC
    view.setUint16(4, paperSize, true);
    view.setUint16(6, 0, true);
    view.setUint16(8, 0x11, true); // 600 DPI (0x11)
    view.setUint16(10, 1, true); // MarginLeft
    view.setUint16(12, 1, true); // MarginTop
    view.setUint16(14, lineBytes, true);
    view.setUint16(16, heightLines, true);
    view.setUint16(18, paperWidth, true);
    view.setUint16(20, paperHeight, true);
    // bytes 22..33 are zero padding

    return this.buildPacket(0xD0A0, payload);
  }

  /**
   * IC_VIDEO_DATA (0xC0A0)
   */
  static buildVideoData(chunk) {
    return this.buildPacket(0xC0A0, chunk);
  }
}
