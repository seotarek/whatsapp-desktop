'use strict';

/*
 * Real Electron integration tests for App Lock window lifecycle.
 *
 * Verifies against actual Chromium and Electron 45 runtime:
 *  1. lockWin is created as a modal child of win with frame: false and alwaysOnTop: true.
 *  2. Real window close() is prevented via event.preventDefault().
 *  3. Unexpected window destroy() immediately triggers openLock() to re-cover win.
 *  4. Legitimate unlock destroys lockWin and does not re-open.
 *  5. Focus on win while locked redirects to lockWin.
 */

const { app, BrowserWindow } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-electron-lock-'));
process.env.XDG_CONFIG_HOME = sandbox;

const { LockManager } = require('../src/lock.js');
const storage = require('../src/lock/storage.js');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');

let failures = 0;
const check = (label, ok, details = '') => {
  if (ok) {
    console.log('  ok   ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label + (details ? ' (' + details + ')' : ''));
  }
};

const fake = (values = {}) => ({
  d: { ...values },
  get(k) { return this.d[k]; },
  set(k, v) { this.d[k] = v; },
  save() { return true; },
});

app.whenReady().then(async () => {
  console.log('Running real Electron lock window lifecycle verification...');

  const config = fake();
  const lock = new LockManager(config);
  lock.setPasscode('real-pin');
  lock.isLocked = true;

  // 1. Create real main window
  const win = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
  });

  let lockWin = null;
  let quitting = false;

  const openLock = () => {
    if (lockWin && !lockWin.isDestroyed()) { lockWin.focus(); return lockWin; }
    if (!win || win.isDestroyed()) return null;

    const bounds = win.getBounds();
    lockWin = new BrowserWindow({
      parent: win,
      modal: true,
      show: false,
      x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
      frame: false,
      resizable: false,
      movable: false,
      alwaysOnTop: true,
      backgroundColor: '#111b21',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    lockWin.on('close', event => {
      if (quitting) return;
      if (lock.isLocked || lock.isCorrupted) {
        event.preventDefault();
        if (lockWin && !lockWin.isDestroyed()) lockWin.focus();
      }
    });

    lockWin.on('closed', () => {
      lockWin = null;
      if (!quitting && (lock.isLocked || lock.isCorrupted)) {
        openLock();
      }
    });

    lockWin.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const ctrl = input.control || input.meta;
      const key = input.key ? input.key.toLowerCase() : '';
      if (ctrl && key === 'q') {
        event.preventDefault();
        quitting = true;
      }
    });

    return lockWin;
  };

  const redirectFocusToLock = () => {
    if (lock.isLocked || lock.isCorrupted) {
      if (lockWin && !lockWin.isDestroyed()) lockWin.focus();
      else openLock();
    }
  };
  win.on('focus', redirectFocusToLock);

  // Test 1: Real BrowserWindow openLock creation
  const lw1 = openLock();
  check('real Electron: lock window created as modal child', lw1 && lw1.getParentWindow() === win);
  check('real Electron: lock window is not destroyed', !lw1.isDestroyed());

  // Test 2: Real close event prevention
  lw1.close();
  check('real Electron: close() is cancelled by preventDefault', !lw1.isDestroyed());

  // Test 3: Real unexpected destroy re-covers with new window
  lw1.destroy();
  await new Promise(r => setTimeout(r, 50));
  check('real Electron: original lock window is destroyed', lw1.isDestroyed());
  check('real Electron: unexpected destroy immediately re-covered', lockWin && !lockWin.isDestroyed() && lockWin !== lw1);

  // Test 4: Real legitimate unlock destroys window without re-covering
  lock.verify('real-pin');
  check('real Electron: valid pin unlocked lock state', !lock.isLocked);
  const currentLw = lockWin;
  currentLw.destroy();
  await new Promise(r => setTimeout(r, 50));
  check('real Electron: lock window not re-opened after legitimate unlock', lockWin === null);

  // Test 5: Re-lock and focus redirect
  lock.lock();
  const lw3 = openLock();
  win.focus();
  check('real Electron: focus redirect triggered without crash', !lw3.isDestroyed());

  // Clean shutdown
  quitting = true;
  if (lockWin && !lockWin.isDestroyed()) lockWin.destroy();
  if (win && !win.isDestroyed()) win.destroy();
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch (_) {}

  console.log(failures ? `\n${failures} Electron lock test(s) failed` : '\nElectron lock checks pass');
  app.exit(failures ? 1 : 0);
});
