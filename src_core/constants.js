/**
 * Canon CAPT v1 / SCoA Protocol & Raster Engine
 * Standard constants, types, and byte formats
 */

export const CANON_VID = 0x04A9;
export const LBP1120_PID = 0x262B;
export const TARGET_MODEL_LBP1120 = 0x03FC;

// Bulk Endpoints
export const BULK_OUT_EP = 0x01;
export const BULK_IN_EP = 0x82;

// Interface & Config
export const USB_INTERFACE_NUM = 0;
export const USB_CONFIG_VAL = 1;

// CAPT Protocol Opcodes (16-bit Little Endian)
export const OP_PC_GET_EXTENDED_STATUS = 0xA0A0;
export const OP_PC_RESERVE_UNIT        = 0xA2A0;
export const OP_IC_VIDEO_DATA          = 0xC0A0;
export const OP_IC_BEGIN_PAGE          = 0xD0A0;
export const OP_IC_BEGIN_DATA          = 0xD0A1;
export const OP_IC_END_PAGE            = 0xD0A2;
export const OP_PCR_GET_BASIC_STATUS   = 0xE0A0;
export const OP_PCR_RESET_ENGINE       = 0xE0A1;
export const OP_PCR_CLEAR_ERROR        = 0xE0A2;
export const OP_PCR_CLEAR_MISPRINT     = 0xE0A3;
export const OP_PCR_DISCARD_DATA       = 0xE0A4;
export const OP_PCR_GO_ONLINE          = 0xE0A5;
export const OP_PCR_GO_OFFLINE         = 0xE0A6;
export const OP_PCR_RELEASE_UNIT       = 0xE0A9;

// Basic Status Bitmasks
export const BASIC_STATUS_IM_DATA_BUSY = 0x08;
export const BASIC_STATUS_NOT_READY    = 0x02;

// Page Dimensions for 600 DPI
export const DPI_600 = 600;

export const PAPER_SPECS = {
  A4: {
    paperSizeCode: 0x09,
    widthDots: 4960,
    heightDots: 7040,
    lineBytes: 620, // 4960 / 8 = 620 (divisible by 4)
    heightLines: 7040, // divisible by 32 (220 blocks)
  },
  Letter: {
    paperSizeCode: 0x01,
    widthDots: 5100,
    heightDots: 6600,
    lineBytes: 636, // cropped to multiple of 4: 5100/8 = 637.5 -> 636 bytes (5088 dots)
    heightLines: 6592, // 6600 - (6600 % 32) = 6592 (206 blocks)
  }
};
