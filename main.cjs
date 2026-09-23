/**
 * Canon Laser Shot LBP-1120 - Minimal USB Diagnostic Application
 * Target: Electron 22.x / Chromium 108
 * Compatibility: Windows 7 / 8 / 8.1 / 10 / 11
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');

// Enable WebUSB feature in Chromium 108
app.commandLine.appendSwitch('enable-features', 'WebUSB');

const CANON_VID = 0x04a9;
const LBP1120_PID = 0x262b;

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 780,
    minWidth: 800,
    minHeight: 560,
    title: 'Canon Laser Shot LBP-1120 — USB Diagnostic & CAPT Engine (Electron 22)',
    backgroundColor: '#f8fafc',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableWebUSB: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  const appSession = mainWindow.webContents.session;

  // Electron 22 WebUSB permission check handler
  appSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'usb') {
      return true;
    }
    return false;
  });

  // Electron 22 WebUSB device permission handler
  appSession.setDevicePermissionHandler((details) => {
    if (details.deviceType === 'usb') {
      return true;
    }
    return false;
  });

  // Handle device selection prompt
  appSession.on('select-usb-device', (event, details, callback) => {
    event.preventDefault();
    const canon = details.deviceList.find(
      (d) => d.vendorId === CANON_VID && d.productId === LBP1120_PID
    );
    if (canon) {
      callback(canon.deviceId);
    } else if (details.deviceList.length > 0) {
      callback(details.deviceList[0].deviceId);
    } else {
      callback('');
    }
  });

  if (process.env.DEV_URL) {
    mainWindow.loadURL(process.env.DEV_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
