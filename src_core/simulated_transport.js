/**
 * Simulated Printer USB Transport
 * Implements mock WebUSB transport for CI testing and unit tests
 * Without requiring physical hardware.
 */

import {
  OP_PC_GET_EXTENDED_STATUS,
  OP_PC_RESERVE_UNIT,
  OP_IC_VIDEO_DATA,
  OP_IC_BEGIN_PAGE,
  OP_IC_BEGIN_DATA,
  OP_IC_END_PAGE,
  OP_PCR_GET_BASIC_STATUS,
  OP_PCR_CLEAR_ERROR,
  OP_PCR_GO_ONLINE,
  OP_PCR_GO_OFFLINE,
  OP_PCR_RELEASE_UNIT,
} from './constants.js';

export class SimulatedCaptPrinterTransport {
  constructor() {
    this.opened = false;
    this.configurationValue = 1;
    this.claimedInterface = null;
    this.isOnline = false;
    this.isUnitReserved = false;
    this.videoChunksReceived = 0;
    this.totalVideoBytesReceived = 0;
    this.pageStarted = false;
    this.pageEnded = false;
    this.log = [];
  }

  async open() {
    this.opened = true;
    this.log.push('open');
  }

  async selectConfiguration(val) {
    if (!this.opened) throw new Error('Device not opened');
    this.configurationValue = val;
    this.log.push(`selectConfiguration(${val})`);
  }

  async claimInterface(num) {
    if (!this.opened) throw new Error('Device not opened');
    this.claimedInterface = num;
    this.log.push(`claimInterface(${num})`);
  }

  async transferOut(endpointNumber, data) {
    if (!this.opened) throw new Error('Device not opened');
    const view = new DataView(data.buffer, data.byteOffset, Math.min(data.byteLength, 4));
    const opcode = view.getUint16(0, true);

    switch (opcode) {
      case OP_PC_RESERVE_UNIT:
        this.isUnitReserved = true;
        this.log.push('OP_PC_RESERVE_UNIT');
        break;
      case OP_PCR_CLEAR_ERROR:
        this.log.push('OP_PCR_CLEAR_ERROR');
        break;
      case OP_PCR_GO_ONLINE:
        this.isOnline = true;
        this.log.push('OP_PCR_GO_ONLINE');
        break;
      case OP_IC_BEGIN_PAGE:
        this.pageStarted = true;
        this.log.push('OP_IC_BEGIN_PAGE');
        break;
      case OP_IC_BEGIN_DATA:
        this.log.push('OP_IC_BEGIN_DATA');
        break;
      case OP_IC_VIDEO_DATA:
        this.videoChunksReceived++;
        this.totalVideoBytesReceived += (data.length - 4);
        break;
      case OP_IC_END_PAGE:
        this.pageEnded = true;
        this.log.push('OP_IC_END_PAGE');
        break;
      case OP_PCR_GO_OFFLINE:
        this.isOnline = false;
        this.log.push('OP_PCR_GO_OFFLINE');
        break;
      case OP_PCR_RELEASE_UNIT:
        this.isUnitReserved = false;
        this.log.push('OP_PCR_RELEASE_UNIT');
        break;
      default:
        this.log.push(`OP_0x${opcode.toString(16)}`);
    }

    return { status: 'ok', bytesWritten: data.length };
  }

  async transferIn(endpointNumber, length) {
    if (!this.opened) throw new Error('Device not opened');
    // Emulate printer status packet response
    const resp = new Uint8Array(8);
    const view = new DataView(resp.buffer);
    view.setUint16(0, 0xA0A0, true);
    view.setUint16(2, 8, true);
    // Ready bit = 0 (ready), Busy = 0
    view.setUint8(4, 0x00);
    view.setUint8(5, 0x00);
    return { data: { buffer: resp.buffer, byteLength: resp.length } };
  }

  async close() {
    this.opened = false;
    this.claimedInterface = null;
    this.log.push('close');
  }
}
