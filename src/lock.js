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
const {
  SECURITY_PATH,
  loadSecurityState,
  saveSecurityState,
  removeSecurityFile,
} = require('./lock/storage.js');

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
    const { salt, hash } = loadSecurityState();
    if (salt && hash) {
      this.salt = salt;
      this.hash = hash;
      if (this.config.get('lock.enabled') !== false) {
        this.isLocked = true;
      }
    }
  }

  save() {
    saveSecurityState(this.salt, this.hash);
  }

  hasPasscode() {
    return !!(this.salt && this.hash);
  }

  isEnabled() {
    return this.hasPasscode() && this.config.get('lock.enabled') !== false;
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
      saveSecurityState(salt, derived);
      this.salt = salt;
      this.hash = derived;
      this.config.set('lock.enabled', true);
      this.config.save({ throwOnError: true });
      this.failedAttempts = 0;
      this.isLocked = false;
      return true;
    } catch (err) {
      if (prevSalt && prevHash) {
        try { saveSecurityState(prevSalt, prevHash); } catch (_) {}
      } else {
        try { removeSecurityFile(); } catch (_) {}
      }
      this.salt = prevSalt;
      this.hash = prevHash;
      this.config.set('lock.enabled', prevEnabled);
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

    try {
      removeSecurityFile();
      this.salt = null;
      this.hash = null;
      this.config.set('lock.enabled', false);
      this.config.save({ throwOnError: true });
      this.isLocked = false;
      return true;
    } catch (err) {
      if (prevSalt && prevHash) {
        try { saveSecurityState(prevSalt, prevHash); } catch (_) {}
      }
      this.salt = prevSalt;
      this.hash = prevHash;
      this.config.set('lock.enabled', prevEnabled);
      throw new Error(`Failed to persist lock removal: ${err.message}`);
    }
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
  SECURITY_PATH,
};
