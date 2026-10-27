/*
 * File persistence for security passcode hashes (0600 mode).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('../config.js');

const SECURITY_PATH = path.join(CONFIG_DIR, 'security.json');

function loadSecurityState() {
  try {
    if (fs.existsSync(SECURITY_PATH)) {
      const content = fs.readFileSync(SECURITY_PATH, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && parsed.salt && parsed.hash) {
        return {
          salt: parsed.salt,
          hash: parsed.hash,
        };
      }
    }
  } catch (e) {
    console.warn('Could not read security.json:', e.message);
  }
  return { salt: null, hash: null };
}

function saveSecurityState(salt, hash) {
  try {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    fs.chmodSync(CONFIG_DIR, 0o700);
  } catch (err) {
    throw new Error(`Failed to secure config directory: ${err.message}`);
  }

  const data = {
    salt,
    hash,
    updatedAt: new Date().toISOString(),
  };

  const tempPath = `${SECURITY_PATH}.${process.pid}.${Date.now()}.tmp`;
  try {
    const fd = fs.openSync(tempPath, 'w', 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(data, null, 2), 0, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(tempPath, 0o600);
    fs.renameSync(tempPath, SECURITY_PATH);
    fs.chmodSync(SECURITY_PATH, 0o600);
    try {
      const dirFd = fs.openSync(CONFIG_DIR, 'r');
      try {
        fs.fsyncSync(dirFd);
      } finally {
        fs.closeSync(dirFd);
      }
    } catch (_) {}
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (e) {}
    console.warn('Could not write security.json:', err.message);
    throw new Error(`Failed to persist security credentials: ${err.message}`);
  }
}

function removeSecurityFile() {
  if (fs.existsSync(SECURITY_PATH)) {
    try {
      fs.unlinkSync(SECURITY_PATH);
    } catch (err) {
      console.warn('Could not delete security.json:', err.message);
      throw new Error(`Failed to delete security credentials file: ${err.message}`);
    }
  }
}

module.exports = {
  SECURITY_PATH,
  loadSecurityState,
  saveSecurityState,
  removeSecurityFile,
};
