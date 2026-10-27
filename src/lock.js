/*
 * App Lock and Passcode Protection for WhatsApp Desktop.
 *
 * Provides PIN/passcode locking with PBKDF2 cryptographic hashing,
 * inactivity auto-lock timers, and rate-limiting against brute force.
 *
 * Stored in: ~/.config/whatsapp-desktop/security.json (mode 0600)
 *
 * Modularized into:
 *   - src/lock/crypto.js: PBKDF2 key derivation and constant-time verification
 *   - src/lock/storage.js: Secure file persistence (0600 mode) and cleanup
 */
'use strict';

const { deriveHash, generateSalt, verifyHash } = require('./lock/crypto.js');
const storage = require('./lock/storage.js');

class LockManager {
  constructor(config) {
    this.config = config;
    this.salt = null;
    this.hash = null;
    this.isLocked = false;
    this.isCorrupted = false;
    this.corruptionError = null;
    this.failedAttempts = 0;
    this.lockoutUntil = 0;
    this.lastActivity = Date.now();
    this.load();
  }

  load() {
    const state = storage.loadSecurityState();

    if (state.status === 'valid') {
      this.salt = state.salt;
      this.hash = state.hash;
      this.isLocked = true;
      this.isCorrupted = false;
      this.corruptionError = null;
      if (this.config.get('lock.enabled') !== true) {
        this.config.set('lock.enabled', true);
        try { this.config.save(); } catch (_) {}
      }
      try { storage.finalizeSecurityRemoval(); } catch (_) {}
      return;
    }

    if (state.status === 'staged_removal') {
      // Interrupted removal transaction detected
      if (this.config.get('lock.enabled') === false) {
        try { storage.finalizeSecurityRemoval(); } catch (_) {}
        this.salt = null;
        this.hash = null;
        this.isLocked = false;
        this.isCorrupted = false;
        this.corruptionError = null;
        return;
      }
      // Removal was interrupted before config was saved: recover credentials
      try {
        storage.abortSecurityRemoval();
        this.salt = state.salt;
        this.hash = state.hash;
        this.isLocked = true;
        this.isCorrupted = false;
        this.corruptionError = null;
        this.config.set('lock.enabled', true);
        try { this.config.save(); } catch (_) {}
        return;
      } catch (err) {
        this.salt = null;
        this.hash = null;
        this.isLocked = true;
        this.isCorrupted = true;
        this.corruptionError = err;
        return;
      }
    }

    if (state.status === 'corrupted') {
      // Credentials file is corrupted or unreadable: FAIL CLOSED
      this.salt = null;
      this.hash = null;
      this.isLocked = true;
      this.isCorrupted = true;
      this.corruptionError = state.error || new Error('Security credentials file is corrupted or unreadable');
      console.warn('App lock entering protective lockdown: credentials storage is corrupted or unreadable.');
      return;
    }

    // State is 'missing'
    if (this.config.get('lock.enabled') === true) {
      // Lock is enabled in configuration but credentials file is missing: FAIL CLOSED
      this.salt = null;
      this.hash = null;
      this.isLocked = true;
      this.isCorrupted = true;
      this.corruptionError = new Error('Lock is enabled in configuration but credentials file is missing');
      console.warn('App lock entering protective lockdown: lock is enabled in config but credentials file is missing.');
      return;
    }

    this.salt = null;
    this.hash = null;
    this.isLocked = false;
    this.isCorrupted = false;
    this.corruptionError = null;
  }

  save() {
    storage.saveSecurityState(this.salt, this.hash);
  }

  hasPasscode() {
    return !!(this.salt && this.hash);
  }

  isEnabled() {
    return this.hasPasscode() || this.isCorrupted;
  }

  setPasscode(newPin, currentPin) {
    if (this.isCorrupted) {
      throw new Error('Cannot change passcode while security storage is corrupted. Manual recovery required.');
    }
    if (this.hasPasscode()) {
      if (typeof currentPin !== 'string' || !currentPin.trim()) {
        throw new Error('Current passcode is required to change passcode');
      }
      if (!this.verify(currentPin)) {
        throw new Error('Incorrect current passcode');
      }
    }
    if (!newPin || typeof newPin !== 'string' || newPin.trim().length < 4) {
      throw new Error('Passcode must be at least 4 characters long');
    }
    const clean = newPin.trim();
    const salt = generateSalt();
    const derived = deriveHash(clean, salt);

    const prevSalt = this.salt;
    const prevHash = this.hash;
    const prevEnabled = this.config.get('lock.enabled');

    try {
      storage.saveSecurityState(salt, derived);
      this.salt = salt;
      this.hash = derived;
      this.config.set('lock.enabled', true);
      this.config.save({ throwOnError: true });
      this.failedAttempts = 0;
      this.isLocked = false;
      this.isCorrupted = false;
      this.corruptionError = null;
      return true;
    } catch (err) {
      let rollbackErr = null;
      if (prevSalt && prevHash) {
        try {
          storage.saveSecurityState(prevSalt, prevHash);
        } catch (rErr) {
          rollbackErr = rErr;
        }
      } else {
        try {
          storage.removeSecurityFile();
        } catch (rErr) {
          rollbackErr = rErr;
        }
      }
      this.salt = prevSalt;
      this.hash = prevHash;
      this.config.set('lock.enabled', prevEnabled);
      if (rollbackErr) {
        throw new Error(`Failed to persist lock configuration (${err.message}) and rollback failed: ${rollbackErr.message}`);
      }
      throw new Error(`Failed to persist lock configuration: ${err.message}`);
    }
  }

  removePasscode(currentPin) {
    if (!this.hasPasscode() && !this.isCorrupted) return true;
    if (this.isCorrupted) {
      throw new Error('Cannot remove passcode while security storage is corrupted. Manual recovery required.');
    }
    // Never remove an existing passcode without verifying it.
    if (typeof currentPin !== 'string' || !currentPin.trim()) {
      throw new Error('Current passcode is required');
    }
    if (!this.verify(currentPin)) {
      throw new Error('Incorrect passcode');
    }

    const prevSalt = this.salt;
    const prevHash = this.hash;
    const prevEnabled = this.config.get('lock.enabled');

    // 1. Stage removal: atomicity via POSIX rename to pending-delete
    try {
      storage.stageSecurityRemoval();
    } catch (err) {
      throw new Error(`Failed to remove credentials file: ${err.message}`);
    }

    // 2. Commit config to disk to reflect disabled lock state
    this.config.set('lock.enabled', false);
    try {
      this.config.save({ throwOnError: true });
    } catch (cfgErr) {
      // Config save failed: restore staged credentials back to security.json
      let restoreErr = null;
      try {
        storage.abortSecurityRemoval();
      } catch (rErr) {
        restoreErr = rErr;
      }
      this.salt = prevSalt;
      this.hash = prevHash;
      this.config.set('lock.enabled', prevEnabled);
      if (restoreErr) {
        throw new Error(`Failed to persist lock configuration (${cfgErr.message}) and failed to restore credentials file: ${restoreErr.message}`);
      }
      throw new Error(`Failed to persist lock configuration: ${cfgErr.message}`);
    }

    // 3. Finalize removal by unlinking the staged file
    try {
      storage.finalizeSecurityRemoval();
    } catch (finErr) {
      console.warn('Could not unlink staged file:', finErr.message);
    }

    this.salt = null;
    this.hash = null;
    this.isLocked = false;
    this.isCorrupted = false;
    this.corruptionError = null;
    return true;
  }

  verify(pin) {
    if (this.isCorrupted) {
      throw new Error('Security credentials file is corrupted or unreadable. Manual recovery required.');
    }
    if (!this.hasPasscode()) return true;
    if (Date.now() < this.lockoutUntil) {
      const waitSec = Math.ceil((this.lockoutUntil - Date.now()) / 1000);
      throw new Error(`Too many failed attempts. Try again in ${waitSec}s.`);
    }

    if (verifyHash(pin, this.salt, this.hash)) {
      this.failedAttempts = 0;
      this.isLocked = false;
      this.recordActivity();
      return true;
    }

    this.failedAttempts++;
    if (this.failedAttempts >= 5) {
      this.lockoutUntil = Date.now() + 30000; // 30s lockout
    }
    return false;
  }

  lock() {
    if (this.isEnabled()) {
      this.isLocked = true;
      return true;
    }
    return false;
  }

  unlock(pin) {
    return this.verify(pin);
  }

  recordActivity() {
    this.lastActivity = Date.now();
  }

  checkIdleTimeout() {
    if (!this.isEnabled() || this.isLocked) return false;
    const timeoutMin = Number(this.config.get('lock.timeout'));
    if (!timeoutMin || timeoutMin <= 0) return false;

    const idleMs = Date.now() - this.lastActivity;
    if (idleMs >= timeoutMin * 60 * 1000) {
      this.lock();
      return true;
    }
    return false;
  }
}

module.exports = {
  LockManager,
  SECURITY_PATH: storage.SECURITY_PATH,
  SECURITY_STAGE_PATH: storage.SECURITY_STAGE_PATH,
};
