/*
 * File persistence for security passcode hashes (0600 mode).
 *
 * Provides crash-resilient persistence, atomic file replacement with fsync,
 * staged two-phase removal, and corruption detection (valid / missing / corrupted / staged_removal).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { CONFIG_DIR } = require('../config.js');

const SECURITY_PATH = path.join(CONFIG_DIR, 'security.json');
const SECURITY_STAGE_PATH = path.join(CONFIG_DIR, 'security.json.pending-delete');

/**
 * Commits directory metadata changes to physical disk via fsync on the directory file descriptor.
 * On POSIX systems, directory fsync ensures new inode links or unlinks survive sudden power loss.
 * On platforms or virtual filesystems where directory fsync is unsupported, this operates on a best-effort basis.
 */
function syncDir(dir) {
  try {
    const dirFd = fs.openSync(dir, 'r');
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
  } catch (_) {
    // Best-effort: unsupported on certain non-POSIX or virtual filesystem drivers
  }
}

/**
 * Loads and classifies security credentials state into one of four deterministic outcomes:
 * 1. { status: 'missing', salt: null, hash: null }
 * 2. { status: 'valid', salt: '...', hash: '...' }
 * 3. { status: 'staged_removal', salt: '...', hash: '...' }
 * 4. { status: 'corrupted', salt: null, hash: null, error: Error }
 */
function loadSecurityState() {
  let stageExists = false;
  try {
    stageExists = fs.existsSync(SECURITY_STAGE_PATH);
  } catch (_) {}

  let mainExists = false;
  try {
    mainExists = fs.existsSync(SECURITY_PATH);
  } catch (_) {}

  if (!mainExists && !stageExists) {
    return { status: 'missing', salt: null, hash: null };
  }

  if (mainExists) {
    try {
      const content = fs.readFileSync(SECURITY_PATH, 'utf8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed.salt === 'string' && parsed.salt.trim() &&
          typeof parsed.hash === 'string' && parsed.hash.trim()) {
        return {
          status: 'valid',
          salt: parsed.salt,
          hash: parsed.hash,
        };
      }
      return {
        status: 'corrupted',
        salt: null,
        hash: null,
        error: new Error('Malformed security credentials payload in security.json'),
      };
    } catch (err) {
      console.warn('Could not read security.json:', err.message);
      return {
        status: 'corrupted',
        salt: null,
        hash: null,
        error: err,
      };
    }
  }

  // Interrupted removal transaction occurred: stage file exists without main security.json
  try {
    const stageContent = fs.readFileSync(SECURITY_STAGE_PATH, 'utf8');
    const parsedStage = JSON.parse(stageContent);
    if (parsedStage && typeof parsedStage.salt === 'string' && parsedStage.salt.trim() &&
        typeof parsedStage.hash === 'string' && parsedStage.hash.trim()) {
      return {
        status: 'staged_removal',
        salt: parsedStage.salt,
        hash: parsedStage.hash,
      };
    }
    return {
      status: 'corrupted',
      salt: null,
      hash: null,
      error: new Error('Malformed staged credentials payload in security.json.pending-delete'),
    };
  } catch (err) {
    return {
      status: 'corrupted',
      salt: null,
      hash: null,
      error: err,
    };
  }
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
    syncDir(CONFIG_DIR);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (e) {}
    console.warn('Could not write security.json:', err.message);
    throw new Error(`Failed to persist security credentials: ${err.message}`);
  }
}

/**
 * Atomically stages credentials for deletion by renaming to security.json.pending-delete.
 * Credentials remain intact on disk during config updates.
 */
function stageSecurityRemoval() {
  if (fs.existsSync(SECURITY_PATH)) {
    try {
      fs.renameSync(SECURITY_PATH, SECURITY_STAGE_PATH);
      syncDir(CONFIG_DIR);
    } catch (err) {
      throw new Error(`Failed to stage credentials removal: ${err.message}`);
    }
  }
}

/**
 * Finalizes credentials removal by deleting the staged pending-delete file and syncing the directory.
 */
function finalizeSecurityRemoval() {
  if (fs.existsSync(SECURITY_STAGE_PATH)) {
    try {
      fs.unlinkSync(SECURITY_STAGE_PATH);
      syncDir(CONFIG_DIR);
    } catch (err) {
      console.warn('Could not delete staged security file:', err.message);
      throw new Error(`Failed to finalize credentials removal: ${err.message}`);
    }
  }
  if (fs.existsSync(SECURITY_PATH)) {
    try {
      fs.unlinkSync(SECURITY_PATH);
      syncDir(CONFIG_DIR);
    } catch (_) {}
  }
}

/**
 * Rolls back staged removal by moving the staged file back to security.json.
 */
function abortSecurityRemoval() {
  if (fs.existsSync(SECURITY_STAGE_PATH)) {
    try {
      fs.renameSync(SECURITY_STAGE_PATH, SECURITY_PATH);
      syncDir(CONFIG_DIR);
    } catch (err) {
      throw new Error(`Failed to abort credentials removal: ${err.message}`);
    }
  }
}

function removeSecurityFile() {
  if (fs.existsSync(SECURITY_PATH)) {
    try {
      fs.unlinkSync(SECURITY_PATH);
      syncDir(CONFIG_DIR);
    } catch (err) {
      console.warn('Could not delete security.json:', err.message);
      throw new Error(`Failed to delete security credentials file: ${err.message}`);
    }
  }
  if (fs.existsSync(SECURITY_STAGE_PATH)) {
    try {
      fs.unlinkSync(SECURITY_STAGE_PATH);
      syncDir(CONFIG_DIR);
    } catch (_) {}
  }
}

module.exports = {
  SECURITY_PATH,
  SECURITY_STAGE_PATH,
  loadSecurityState,
  saveSecurityState,
  removeSecurityFile,
  stageSecurityRemoval,
  finalizeSecurityRemoval,
  abortSecurityRemoval,
  syncDir,
};
