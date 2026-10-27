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
    this.failedAttempts = 0;
    this.lockoutUntil = 0;
    this.lastActivity = Date.now();
    this.load();
  }

  load() {
    const { salt, hash } = storage.loadSecurityState();
    if (salt && hash) {
      this.salt = salt;
      this.hash = hash;
      this.isLocked = true;
      if (this.config.get('lock.enabled') !== true) {
        this.config.set('lock.enabled', true);
        try {
          this.config.save();
        } catch (_) {}
      }
    } else {
      this.salt = null;
      this.hash = null;
      this.isLocked = false;
      if (this.config.get('lock.enabled') === true) {
        this.config.set('lock.enabled', false);
        try {
          this.config.save();
        } catch (_) {}
      }
    }
  }

  save() {
    storage.saveSecurityState(this.salt, this.hash);
  }

  hasPasscode() {
    return !!(this.salt && this.hash);
  }

  isEnabled() {
    return this.hasPasscode();
  }

  setPasscode(newPin, currentPin) {
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
    if (!this.hasPasscode()) return true;
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

    // 1. Unlink credentials file from disk FIRST.
    // If unlinking fails, credentials remain intact on disk, abort immediately.
    try {
      storage.removeSecurityFile();
    } catch (err) {
      throw new Error(`Failed to remove credentials file: ${err.message}`);
    }

    // 2. Commit config to disk to reflect disabled lock state
    this.config.set('lock.enabled', false);
    try {
      this.config.save({ throwOnError: true });
    } catch (cfgErr) {
      // Config save failed: restore security credentials to avoid leaving
      // an inconsistent or unmanaged state.
      let restoreErr = null;
      try {
        storage.saveSecurityState(prevSalt, prevHash);
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

    this.salt = null;
    this.hash = null;
    this.isLocked = false;
    return true;
  }

  verify(pin) {
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
};
