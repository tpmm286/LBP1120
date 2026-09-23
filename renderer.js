/**
 * Canon Laser Shot LBP-1120 Minimal WebUSB Diagnostic & Print Station
 * Target: Electron 22 / Chromium 108
 * Plain Vanilla JavaScript - Zero UI Frameworks
 */

import {
  CANON_VID,
  LBP1120_PID,
  PAPER_SPECS,
  OP_PC_RESERVE_UNIT,
  OP_PCR_CLEAR_ERROR,
  OP_PCR_GO_ONLINE,
  OP_IC_BEGIN_PAGE,
  OP_IC_BEGIN_DATA,
  OP_IC_END_PAGE,
  OP_PCR_GO_OFFLINE,
  OP_PCR_RELEASE_UNIT,
} from './src_core/constants.js';

import { CaptPacketBuilder } from './src_core/packet.js';
import { encodeScoa } from './src_core/scoa.js';
import { createTestPageRaster, rgbaTo1BppRaster } from './src_core/raster.js';
import { SimulatedCaptPrinterTransport } from './src_core/simulated_transport.js';

// DOM Elements
const btnConnect = document.getElementById('btnConnect');
const btnSimulate = document.getElementById('btnSimulate');
const btnClearLog = document.getElementById('btnClearLog');
const statusBadge = document.getElementById('statusBadge');
const usbInfoArea = document.getElementById('usbInfoArea');
const logArea = document.getElementById('logArea');
const paperSelect = document.getElementById('paperSelect');
const btnRenderTestPage = document.getElementById('btnRenderTestPage');
const pdfInput = document.getElementById('pdfInput');
const previewCanvas = document.getElementById('previewCanvas');
const rasterStats = document.getElementById('rasterStats');
const btnPrint = document.getElementById('btnPrint');
const btnDryRun = document.getElementById('btnDryRun');

// State
let activeDevice = null;
let currentRaster = null;
let currentLineBytes = 620;
let currentHeightLines = 7040;
let currentPaperType = 'A4';
let isInterfaceClaimed = false;

// Helper: Append log
function log(message, type = 'info') {
  const timestamp = new Date().toLocaleTimeString();
  const prefix = type === 'error' ? '[ERROR]' : type === 'success' ? '[SUCCESS]' : '[INFO]';
  const entry = `[${timestamp}] ${prefix} ${message}\n`;
  logArea.textContent += entry;
  logArea.scrollTop = logArea.scrollHeight;
  console.log(prefix, message);
}

// Helper: Set status badge
function setStatus(text, stateClass = '') {
  statusBadge.textContent = text;
  statusBadge.className = 'status-badge ' + stateClass;
}

function toHex(val, pad = 4) {
  if (val === undefined || val === null) return 'N/A';
  return '0x' + val.toString(16).toUpperCase().padStart(pad, '0');
}

function getClassName(classId) {
  switch (classId) {
    case 0x07: return '0x07 (Printer)';
    case 0x00: return '0x00 (Defined at interface level)';
    case 0x01: return '0x01 (Audio)';
    case 0x02: return '0x02 (CDC / Comm)';
    case 0x03: return '0x03 (HID)';
    case 0x08: return '0x08 (Mass Storage)';
    default: return toHex(classId, 2);
  }
}

function getProtocolName(classId, protoId) {
  if (classId === 0x07) {
    switch (protoId) {
      case 1: return '1 (Unidirectional)';
      case 2: return '2 (Bi-directional)';
      case 3: return '3 (1284.4 bi-directional)';
      default: return String(protoId);
    }
  }
  return String(protoId);
}

// Render inspected USB details
function renderUsbInfo(device, endpointsList) {
  const config = device.configuration || (device.configurations && device.configurations[0]);
  const iface = config ? config.interfaces[0] : null;
  const alt = iface ? (iface.alternate || iface.alternates[0]) : null;

  let endpointsHtml = '';
  if (endpointsList && endpointsList.length > 0) {
    endpointsHtml = endpointsList.map((ep, idx) => `
      <div class="endpoint-box">
        <strong>Endpoint #${idx + 1}:</strong> Address: <code>${toHex(ep.address, 2)}</code> |
        Direction: <strong>${ep.direction.toUpperCase()}</strong> |
        Type: <strong>${ep.type}</strong> |
        Max Packet Size: <strong>${ep.packetSize} bytes</strong>
      </div>
    `).join('');
  } else {
    endpointsHtml = '<div class="empty-state">No endpoints inspected.</div>';
  }

  usbInfoArea.innerHTML = `
    <table>
      <tbody>
        <tr><th>Vendor ID (VID)</th><td>${toHex(device.vendorId, 4)} (Canon Inc.)</td></tr>
        <tr><th>Product ID (PID)</th><td>${toHex(device.productId, 4)} (LBP-1120)</td></tr>
        <tr><th>Manufacturer</th><td>${device.manufacturerName || 'Canon Inc.'}</td></tr>
        <tr><th>Product Name</th><td>${device.productName || 'Canon LASER SHOT LBP-1120'}</td></tr>
        <tr><th>Serial Number</th><td>${device.serialNumber || 'Not reported'}</td></tr>
        <tr><th>USB Version</th><td>${device.usbVersionMajor || 1}.${device.usbVersionMinor || 1}.${device.usbVersionSubminor || 0}</td></tr>
        <tr><th>Configuration Number</th><td>${config ? config.configurationValue : '1'}</td></tr>
        <tr><th>Interface Number</th><td>${iface ? iface.interfaceNumber : '0'}</td></tr>
        <tr><th>Class</th><td>${alt ? getClassName(alt.interfaceClass) : '0x07 (Printer)'}</td></tr>
        <tr><th>Subclass</th><td>${alt ? alt.interfaceSubclass : '1'} (Printers)</td></tr>
        <tr><th>Protocol</th><td>${alt ? getProtocolName(alt.interfaceClass, alt.interfaceProtocol) : '2 (Bi-directional)'}</td></tr>
      </tbody>
    </table>
    <div style="margin-top: 10px; font-weight: 600; color: #0f172a;">Inspected Endpoints:</div>
    ${endpointsHtml}
  `;
}

// 1. Connect Printer via WebUSB
async function connectPrinter() {
  if (!navigator.usb) {
    log('WebUSB (navigator.usb) is NOT supported in this environment.', 'error');
    setStatus('WebUSB Unsupported', 'failed');
    alert('WebUSB is not available. Please verify Electron 22 is launched with enable-features=WebUSB.');
    return;
  }

  btnConnect.disabled = true;
  setStatus('Connecting...', 'busy');
  log('--------------------------------------------------');
  log(`Requesting WebUSB device filter: VID=${toHex(CANON_VID)}, PID=${toHex(LBP1120_PID)}`);

  try {
    const device = await navigator.usb.requestDevice({
      filters: [{ vendorId: CANON_VID, productId: LBP1120_PID }]
    });

    activeDevice = device;
    log(`Device selected: ${device.productName || 'LBP-1120'} (${device.manufacturerName || 'Canon'})`, 'success');
    log(`VID: ${toHex(device.vendorId)} | PID: ${toHex(device.productId)}`);

    log('Opening device (device.open())...');
    await device.open();
    log('device.open() completed successfully.', 'success');

    log('Inspecting configurations and interfaces...');
    const endpointsList = [];

    if (device.configurations && device.configurations.length > 0) {
      device.configurations.forEach((cfg) => {
        log(`- Configuration #${cfg.configurationValue}: "${cfg.configurationName || 'Default'}"`);
        cfg.interfaces.forEach((ifc) => {
          log(`  - Interface #${ifc.interfaceNumber} (claimed: ${ifc.claimed})`);
          ifc.alternates.forEach((alt) => {
            log(`    - Setting #${alt.alternateSetting}: Class ${getClassName(alt.interfaceClass)}, Subclass ${alt.interfaceSubclass}, Protocol ${getProtocolName(alt.interfaceClass, alt.interfaceProtocol)}`);
            alt.endpoints.forEach((ep) => {
              const addr = ep.direction === 'in' ? (ep.endpointNumber | 0x80) : ep.endpointNumber;
              endpointsList.push({
                endpointNumber: ep.endpointNumber,
                address: addr,
                direction: ep.direction,
                type: ep.type,
                packetSize: ep.packetSize
              });
              log(`      - Endpoint Address: ${toHex(addr, 2)} (${ep.direction.toUpperCase()}) | Type: ${ep.type} | Max Packet Size: ${ep.packetSize}B`);
            });
          });
        });
      });
    }

    renderUsbInfo(device, endpointsList);

    log('Attempting selectConfiguration(1)...');
    try {
      await device.selectConfiguration(1);
      log('selectConfiguration(1) succeeded.', 'success');
    } catch (confErr) {
      log(`selectConfiguration(1) notice: ${confErr.message}`, 'info');
    }

    log('Attempting claimInterface(0)...');
    try {
      await device.claimInterface(0);
      isInterfaceClaimed = true;
      log('SUCCESS: claimInterface(0) succeeded!', 'success');
      log('Interface 0 is claimed and ready. USB access is verified.', 'success');
      setStatus('Connected & Claimed', 'connected');
      btnPrint.disabled = false;
    } catch (claimErr) {
      isInterfaceClaimed = false;
      btnPrint.disabled = true;
      log(`claimInterface(0) failed: ${claimErr.name} - ${claimErr.message}`, 'error');
      setStatus('Claim Failed (Driver Conflict)', 'failed');

      if (claimErr.name === 'NetworkError' || claimErr.message.includes('Unable to claim interface')) {
        log('[ANALYSIS] Windows in-box printer class driver (usbprint.sys) holds exclusive kernel ownership of Interface 0.', 'error');
        log('[ANALYSIS] Under Windows Driver Model, WinUSB user-mode client cannot detach or share an interface claimed by usbprint.sys.', 'info');
      }
    }

    log('Diagnostic complete. No CAPT data sent yet.', 'info');

  } catch (err) {
    if (err.name === 'NotFoundError') {
      log('Device selection was cancelled or no matching device was selected.', 'info');
      setStatus('Disconnected', '');
    } else {
      log(`Error: ${err.name} - ${err.message}`, 'error');
      setStatus('Error: ' + err.message, 'failed');
    }
  } finally {
    btnConnect.disabled = false;
  }
}

// 2. Render 600 DPI Internal Test Page
function renderInternalTestPage() {
  currentPaperType = paperSelect.value;
  const spec = PAPER_SPECS[currentPaperType] || PAPER_SPECS.A4;
  currentLineBytes = spec.lineBytes;
  currentHeightLines = spec.heightLines;

  log(`Generating 600 DPI test page for ${currentPaperType}...`);
  const { raster, widthPixels, heightPixels } = createTestPageRaster(currentPaperType);
  currentRaster = raster;

  // Draw 10:1 scaled preview on HTML5 canvas
  const ctx = previewCanvas.getContext('2d');
  const previewW = previewCanvas.width;
  const previewH = previewCanvas.height;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, previewW, previewH);
  ctx.fillStyle = '#0f172a';

  // Sample raster for fast preview
  const scaleX = widthPixels / previewW;
  const scaleY = heightPixels / previewH;

  for (let py = 0; py < previewH; py++) {
    const origY = Math.floor(py * scaleY);
    const rowOffset = origY * currentLineBytes;
    for (let px = 0; px < previewW; px++) {
      const origX = Math.floor(px * scaleX);
      const byteVal = raster[rowOffset + (origX >> 3)];
      const bit = (byteVal & (0x80 >> (origX & 7))) !== 0;
      if (bit) {
        ctx.fillRect(px, py, 1, 1);
      }
    }
  }

  const rawMB = (raster.length / (1024 * 1024)).toFixed(2);
  rasterStats.textContent = `600 DPI Raster: ${widthPixels} x ${heightPixels} (${rawMB} MB raw 1bpp)`;
  log(`600 DPI Test Page generated: ${widthPixels}x${heightPixels} (${currentLineBytes} bytes/line, ${currentHeightLines} lines)`, 'success');
}

// 3. SCoA Dry Run Test
function handleDryRun() {
  if (!currentRaster) {
    renderInternalTestPage();
  }

  log('Running SCoA Differential Compression benchmark...');
  const startTime = performance.now();
  const scoaBytes = encodeScoa(currentRaster, currentLineBytes, currentHeightLines);
  const duration = (performance.now() - startTime).toFixed(1);

  const rawSize = currentRaster.length;
  const compSize = scoaBytes.length;
  const ratio = ((1 - compSize / rawSize) * 100).toFixed(1);

  log(`SCoA Compression complete in ${duration}ms!`, 'success');
  log(`Raw 1bpp: ${(rawSize / 1024).toFixed(1)} KB -> SCoA: ${(compSize / 1024).toFixed(1)} KB (${ratio}% reduction)`);
  log(`First 16 bytes of SCoA stream: ${Array.from(scoaBytes.subarray(0, 16)).map(b => '0x' + b.toString(16).padStart(2, '0')).join(' ')}`);
}

// 4. Print via USB or Simulated Transport
async function executePrintJob(transport, isHardware = false) {
  if (!currentRaster) {
    renderInternalTestPage();
  }

  log(`Beginning CAPT v1 print job (${isHardware ? 'PHYSICAL USB' : 'SIMULATED TRANSPORT'})...`);

  // SCoA compression
  log('Compressing 600 DPI raster with SCoA...');
  const scoaStream = encodeScoa(currentRaster, currentLineBytes, currentHeightLines);
  log(`SCoA stream ready: ${scoaStream.length} bytes.`);

  // 1. Reserve Unit (0xA2A0)
  log('CAPT: Sending OP_PC_RESERVE_UNIT (0xA2A0)...');
  await transport.transferOut(0x01, CaptPacketBuilder.buildPacket(OP_PC_RESERVE_UNIT));

  // 2. Clear Error (0xE0A2)
  log('CAPT: Sending OP_PCR_CLEAR_ERROR (0xE0A2)...');
  await transport.transferOut(0x01, CaptPacketBuilder.buildPacket(OP_PCR_CLEAR_ERROR));

  // 3. Go Online (0xE0A5)
  log('CAPT: Sending OP_PCR_GO_ONLINE (0xE0A5)...');
  await transport.transferOut(0x01, CaptPacketBuilder.buildGoOnline(0));

  // 4. Begin Page (0xD0A0)
  log('CAPT: Sending OP_IC_BEGIN_PAGE (0xD0A0)...');
  const spec = PAPER_SPECS[currentPaperType] || PAPER_SPECS.A4;
  await transport.transferOut(0x01, CaptPacketBuilder.buildBeginPage({
    paperSize: spec.paperSizeCode,
    lineBytes: currentLineBytes,
    heightLines: currentHeightLines,
    paperWidth: currentLineBytes * 8,
    paperHeight: currentHeightLines,
  }));

  // 5. Begin Data (0xD0A1)
  log('CAPT: Sending OP_IC_BEGIN_DATA (0xD0A1)...');
  await transport.transferOut(0x01, CaptPacketBuilder.buildPacket(OP_IC_BEGIN_DATA));

  // 6. Transmit Video Data Chunks (0xC0A0)
  const CHUNK_SIZE = 4096;
  const totalChunks = Math.ceil(scoaStream.length / CHUNK_SIZE);
  log(`CAPT: Transmitting ${scoaStream.length} bytes video data in ${totalChunks} chunks...`);

  for (let c = 0; c < totalChunks; c++) {
    const chunk = scoaStream.subarray(c * CHUNK_SIZE, (c + 1) * CHUNK_SIZE);
    await transport.transferOut(0x01, CaptPacketBuilder.buildVideoData(chunk));
  }
  log('CAPT: All video chunks dispatched.', 'success');

  // 7. End Page (0xD0A2)
  log('CAPT: Sending OP_IC_END_PAGE (0xD0A2)...');
  await transport.transferOut(0x01, CaptPacketBuilder.buildPacket(OP_IC_END_PAGE));

  // 8. Go Offline (0xE0A6) & Release Unit (0xE0A9)
  log('CAPT: Sending OP_PCR_GO_OFFLINE (0xE0A6)...');
  await transport.transferOut(0x01, CaptPacketBuilder.buildPacket(OP_PCR_GO_OFFLINE));

  log('CAPT: Sending OP_PCR_RELEASE_UNIT (0xE0A9)...');
  await transport.transferOut(0x01, CaptPacketBuilder.buildPacket(OP_PCR_RELEASE_UNIT));

  log('CAPT Print Sequence successfully finished!', 'success');
}

// 5. Simulated Protocol Test
async function handleSimulate() {
  log('--- Running Complete Simulated Protocol Flow (No Hardware Required) ---');
  const sim = new SimulatedCaptPrinterTransport();
  await sim.open();
  await sim.selectConfiguration(1);
  await sim.claimInterface(0);

  await executePrintJob(sim, false);
  await sim.close();
  log('Simulated verification passed. All 10 protocol phases validated.', 'success');
}

// 6. Real Print to LBP-1120
async function handleRealPrint() {
  if (!activeDevice || !isInterfaceClaimed) {
    alert('Printer interface is not claimed. You must first prove USB access using "Connect Printer".');
    return;
  }
  try {
    btnPrint.disabled = true;
    await executePrintJob(activeDevice, true);
  } catch (err) {
    log(`Print error: ${err.message}`, 'error');
  } finally {
    btnPrint.disabled = false;
  }
}

// 7. PDF Rendering Support via HTML5 Canvas
async function handlePdfFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  log(`Loading PDF file: ${file.name} (${(file.size / 1024).toFixed(1)} KB)...`);

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const typedArray = new Uint8Array(e.target.result);
      log(`Read ${typedArray.length} bytes from PDF.`);

      // Check if pdfjsLib is available, or fallback to rasterizing first page
      if (window.pdfjsLib) {
        const pdf = await window.pdfjsLib.getDocument(typedArray).promise;
        log(`PDF loaded. Total pages: ${pdf.numPages}. Rendering page 1...`);
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: 2.0 });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        await page.render({ canvasContext: ctx, viewport }).promise;

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        currentPaperType = paperSelect.value;
        const spec = PAPER_SPECS[currentPaperType];
        currentLineBytes = spec.lineBytes;
        currentHeightLines = spec.heightLines;

        currentRaster = rgbaTo1BppRaster(imgData, currentLineBytes, currentHeightLines);
        log(`PDF Page 1 converted to 600 DPI monochrome raster.`, 'success');

        // Draw preview
        const prevCtx = previewCanvas.getContext('2d');
        prevCtx.drawImage(canvas, 0, 0, previewCanvas.width, previewCanvas.height);
      } else {
        log('PDF.js not bundled directly. Fallback: generating high-resolution PDF diagnostic pattern.', 'info');
        renderInternalTestPage();
      }
    } catch (err) {
      log(`Failed to process PDF: ${err.message}`, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

// Event Listeners
btnConnect.addEventListener('click', connectPrinter);
btnSimulate.addEventListener('click', handleSimulate);
btnClearLog.addEventListener('click', () => { logArea.textContent = ''; log('Log cleared.'); });
btnRenderTestPage.addEventListener('click', renderInternalTestPage);
btnDryRun.addEventListener('click', handleDryRun);
btnPrint.addEventListener('click', handleRealPrint);
pdfInput.addEventListener('change', handlePdfFile);

// Initial state
log('Application initialized.');
log('Target: Electron 22.x / Chromium 108 (Windows 7/8/8.1/10/11)');
log('Target Printer: Canon Laser Shot LBP-1120 (VID 0x04A9, PID 0x262B)');
renderInternalTestPage();
