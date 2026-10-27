/*
 * The passcode, and the thing a lock over the window alone would leave open.
 *
 * The window being covered is the easy half and the one everybody writes. The
 * half that matters as much is the banner: a client with a passcode on it that
 * still raises "Ahmed: see you at eight" on the desktop has handed over exactly
 * what the passcode was covering, to somebody who never touched the machine.
 * That check is at the bottom of this file and it is the reason it exists.
 *
 * Nothing here needs a window, a bus or an account -- the passcode is PBKDF2
 * over a file, and the redaction is one decision in src/notify.js.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

/* Its own config directory, so running the tests never touches the one the
   client on this machine is using. The version this came from wrote a real
   accounts.json and a real config file into ~/.config on every `make test`. */
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'wa-lock-'));
process.env.XDG_CONFIG_HOME = sandbox;

const { LockManager } = require('../src/lock.js');
const storage = require('../src/lock/storage.js');

let failures = 0;
const check = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { console.log('  ok   ' + label); return; }
  failures++;
  console.log('  FAIL ' + label +
              '\n         got  ' + JSON.stringify(got) +
              '\n         want ' + JSON.stringify(want));
};

const fake = (values = {}) => ({
  d: { ...values },
  get(k) { return this.d[k]; },
  set(k, v) { this.d[k] = v; },
  save(options) {
    if (this.failSave) {
      if (options && options.throwOnError) throw new Error('Simulated config write failure');
      return false;
    }
    return true;
  },
});

/* With no passcode set there is nothing to ask, and nothing may be in the way. */
const open = new LockManager(fake());
check('a client with no passcode is not locked', open.isLocked, false);
check('and it is not enabled on the strength of a config key alone',
      open.isEnabled(), false);
check('anything gets past a lock that was never set', open.verify('whatever'), true);

/* Setting one. */
const lock = new LockManager(fake());
check('a passcode shorter than four characters is refused', (() => {
  try { lock.setPasscode('12'); return 'accepted'; } catch (e) { return 'refused'; }
})(), 'refused');
lock.setPasscode('open sesame');
check('a passcode that was set is held', lock.hasPasscode(), true);
check('and the lock is on once there is one to check', lock.isEnabled(), true);

check('the wrong passcode does not get in', lock.verify('open sesam'), false);
check('the right one does', lock.verify('open sesame'), true);

/* What is on disk, which is the part worth being careful about. */
const onDisk = JSON.parse(fs.readFileSync(path.join(sandbox, 'whatsapp-desktop', 'security.json'), 'utf8'));
check('the passcode itself is not written anywhere',
      JSON.stringify(onDisk).includes('open sesame'), false);
check('what is written is a salt and a hash',
      [typeof onDisk.salt, typeof onDisk.hash], ['string', 'string']);
check('and the file is readable by nobody else',
      (fs.statSync(path.join(sandbox, 'whatsapp-desktop', 'security.json')).mode & 0o777).toString(8),
      '600');

/* Two clients, same passcode: the salt is what keeps one answer from reading
   across to another machine's file. Asked of the crypto directly, because the
   config directory is resolved once per process and a second LockManager in
   this one would write beside the first. */
const { deriveHash, generateSalt } = require('../src/lock/crypto.js');
const saltA = generateSalt();
const saltB = generateSalt();
check('two salts are not the same salt', saltA === saltB, false);
check('the same passcode under two salts does not hash the same',
      deriveHash('open sesame', saltA) === deriveHash('open sesame', saltB), false);
check('and the hash that is stored is what the right passcode derives to',
      deriveHash('open sesame', onDisk.salt), onDisk.hash);
lock.removePasscode('open sesame');

/* Wrong answers, and the wait that follows enough of them. */
const guessed = new LockManager(fake());
guessed.setPasscode('1234');
for (let i = 0; i < 5; i++) guessed.verify('0000');
check('five wrong answers buy a wait', (() => {
  try { guessed.verify('1234'); return 'let in'; } catch (e) { return e.message; }
})().startsWith('Too many failed attempts'), true);

/* Taking it off again. */
const removing = new LockManager(fake());
check('the passcode cannot be removed by someone who does not know it', (() => {
  try { removing.removePasscode('9999'); return 'removed'; } catch (e) { return 'refused'; }
})(), 'refused');
check('missing passcode cannot remove the lock', (() => {
  try { removing.removePasscode(); return 'removed'; } catch (e) { return 'refused'; }
})(), 'refused');
check('empty passcode cannot remove the lock', (() => {
  try { removing.removePasscode(''); return 'removed'; } catch (e) { return 'refused'; }
})(), 'refused');
check('whitespace passcode cannot remove the lock', (() => {
  try { removing.removePasscode(' '); return 'removed'; } catch (e) { return 'refused'; }
})(), 'refused');
check(
  'lock remains active after rejected removal attempts',
  removing.hasPasscode(),
  true
);

/* Changing an existing passcode requires authenticating with the current one. */
check('passcode cannot be changed without current passcode', (() => {
  try { removing.setPasscode('5678'); return 'changed'; } catch (e) { return 'refused'; }
})(), 'refused');
check('passcode cannot be changed with wrong current passcode', (() => {
  try { removing.setPasscode('5678', '9999'); return 'changed'; } catch (e) { return 'refused'; }
})(), 'refused');
check('passcode can be changed with correct current passcode', (() => {
  try { removing.setPasscode('5678', '1234'); return removing.verify('5678'); } catch (e) { return false; }
})(), true);

removing.removePasscode('5678');
check('and it can by someone who does', removing.hasPasscode(), false);

/*
 * The banner, which is the half this is really for.
 */
const notify = require.resolve('../src/notify.js');
delete require.cache[notify];
const Module = require('module');
const load = Module._load;
const raised = [];
const electron = {
  Notification: class {
    static isSupported() { return true; }
    constructor(options) { raised.push(options); }
    show() {}
    close() {}
    on() {}
  },
  nativeImage: { createFromPath: () => ({ isEmpty: () => true }) },
};
let Banners;
try {
  Module._load = function (request, ...args) {
    return request === 'electron' ? electron : load.call(this, request, ...args);
  };
  ({ Banners } = require('../src/notify.js'));
} finally {
  Module._load = load;
}

let locked = false;
const banners = new Banners({ isLocked: () => locked });

banners.show({
  key: 'Ahmed', title: 'Ahmed', body: 'Ahmed: see you at eight',
  redacted: '\u{1F4AC} Message',
});
check('unlocked, a banner carries the message',
      raised[raised.length - 1].body, 'Ahmed: see you at eight');

locked = true;
banners.show({
  key: 'Ahmed', title: 'Ahmed', body: 'Ahmed: the password is hunter2',
  redacted: '\u{1F4AC} Message',
});
const covered = raised[raised.length - 1];
check('locked, it says a message arrived and not a word of it',
      covered.body, '\u{1F4AC} Message');
check('and the words are nowhere in what the desktop was handed',
      JSON.stringify(covered).includes('hunter2'), false);

locked = false;
banners.show({ key: 'Ahmed', title: 'Ahmed', body: 'readable again' });
check('unlocking lets the next one through again',
      raised[raised.length - 1].body, 'readable again');

/* Config persistence failure & atomic rollback */
const failingConfig = fake();
failingConfig.failSave = true;
const failLock = new LockManager(failingConfig);

let threwOnSet = false;
try {
  failLock.setPasscode('secret123');
} catch (e) {
  threwOnSet = e.message.includes('Failed to persist lock configuration');
}
check('setPasscode throws when config save fails', threwOnSet, true);
check('lock state rolled back after failed setPasscode', failLock.hasPasscode(), false);
check('lock.enabled not set after failed setPasscode', failingConfig.get('lock.enabled'), undefined);

// Now set with working config, then test remove failure rollback
const workingConfig = fake();
const rollbackLock = new LockManager(workingConfig);
rollbackLock.setPasscode('secret123');
check('passcode set with working config', rollbackLock.hasPasscode(), true);

workingConfig.failSave = true;
let threwOnRemove = false;
try {
  rollbackLock.removePasscode('secret123');
} catch (e) {
  threwOnRemove = e.message.includes('Failed to persist lock configuration');
}
check('removePasscode throws when config save fails', threwOnRemove, true);
check('lock state retained after failed removePasscode', rollbackLock.hasPasscode(), true);
check('lock.enabled remains true after failed removePasscode', workingConfig.get('lock.enabled'), true);

// Clean removal after failure
workingConfig.failSave = false;
rollbackLock.removePasscode('secret123');
check('clean removal removes credentials after rollback test', rollbackLock.hasPasscode(), false);
check('clean removal sets lock.enabled to false', workingConfig.get('lock.enabled'), false);

/* Authority: security.json is the single source of truth */
const authConfig = fake({ 'lock.enabled': false });
const authLock = new LockManager(authConfig);
authLock.setPasscode('truth123');
check('passcode is active', authLock.isEnabled(), true);
check('lock.enabled set to true after setPasscode', authConfig.get('lock.enabled'), true);

// Tamper config to simulate crash or user editing config to false
authConfig.set('lock.enabled', false);

// Fresh manager startup: must read security.json, lock the app, keep isEnabled = true, and heal config
const restartedLock = new LockManager(authConfig);
check('valid security.json locks app on load even if lock.enabled was false', restartedLock.isLocked, true);
check('isEnabled returns true on valid credentials even if lock.enabled was false', restartedLock.isEnabled(), true);
check('config key is healed to lock.enabled = true', authConfig.get('lock.enabled'), true);

restartedLock.removePasscode('truth123');
check('after clean removal, isLocked is false', restartedLock.isLocked, false);
check('after clean removal, isEnabled is false', restartedLock.isEnabled(), false);

/* Edge case: stageSecurityRemoval throws during removePasscode */
const unremovableLock = new LockManager(fake());
unremovableLock.setPasscode('keepme123');
const origStage = storage.stageSecurityRemoval;
storage.stageSecurityRemoval = () => {
  throw new Error('EPERM: operation not permitted');
};
let threwOnRemoveFile = false;
try {
  unremovableLock.removePasscode('keepme123');
} catch (e) {
  threwOnRemoveFile = e.message.includes('Failed to remove credentials file');
} finally {
  storage.stageSecurityRemoval = origStage;
}
check('removePasscode throws when credentials file removal fails', threwOnRemoveFile, true);
check('passcode retained after credentials file removal failure', unremovableLock.hasPasscode(), true);
unremovableLock.removePasscode('keepme123');
check('unremovableLock cleaned up after test', unremovableLock.hasPasscode(), false);

/* Edge case: failure of abortSecurityRemoval during removePasscode config failure */
const restoreFailConfig = fake();
const restoreFailLock = new LockManager(restoreFailConfig);
restoreFailLock.setPasscode('restorefail');
restoreFailConfig.failSave = true;
const origAbort = storage.abortSecurityRemoval;
storage.abortSecurityRemoval = () => {
  throw new Error('Disk full');
};
let threwBoth = false;
try {
  restoreFailLock.removePasscode('restorefail');
} catch (e) {
  threwBoth = e.message.includes('and failed to restore credentials file: Disk full');
} finally {
  storage.abortSecurityRemoval = origAbort;
}
check('removePasscode surfaces both errors when restore fails', threwBoth, true);
restoreFailConfig.failSave = false;
try { restoreFailLock.removePasscode('restorefail'); } catch (_) {}
try { storage.removeSecurityFile(); } catch (_) {}

/* Edge case: failure of rollback during setPasscode config failure */
const origRemove = storage.removeSecurityFile;
const setFailConfig = fake();
setFailConfig.failSave = true;
const setFailLock = new LockManager(setFailConfig);
storage.removeSecurityFile = () => {
  throw new Error('ReadOnlyFS');
};
let threwSetRollback = false;
try {
  setFailLock.setPasscode('setfail');
} catch (e) {
  threwSetRollback = e.message.includes('and rollback failed: ReadOnlyFS');
} finally {
  storage.removeSecurityFile = origRemove;
}
check('setPasscode surfaces rollback failure when rollback throws', threwSetRollback, true);
try { storage.removeSecurityFile(); } catch (_) {}

/* Transactional recovery: crash during removal transaction followed by restart */
const crashConfig = fake();
const crashLock = new LockManager(crashConfig);
crashLock.setPasscode('crashrecover');
check('crashLock passcode set', crashLock.hasPasscode(), true);

// Simulate crash after Phase 1 (staged removal): credentials moved to pending-delete, config not saved
fs.renameSync(storage.SECURITY_PATH, storage.SECURITY_STAGE_PATH);
check('main security.json absent during simulated crash', fs.existsSync(storage.SECURITY_PATH), false);
check('staged pending-delete file exists during simulated crash', fs.existsSync(storage.SECURITY_STAGE_PATH), true);

// Startup of fresh LockManager simulates application launch after crash
const recoveredLock = new LockManager(crashConfig);
check('restarted LockManager fails closed and locks app after crash during removal', recoveredLock.isLocked, true);
check('restarted LockManager restored credentials from stage', recoveredLock.hasPasscode(), true);
check('restarted LockManager can verify original passcode', recoveredLock.verify('crashrecover'), true);
check('main security.json was restored to disk', fs.existsSync(storage.SECURITY_PATH), true);
check('staged pending-delete file was cleaned up', fs.existsSync(storage.SECURITY_STAGE_PATH), false);
recoveredLock.removePasscode('crashrecover');

/* Corrupted security.json fails closed into protective lockdown */
const corruptConfig = fake();
const corruptLock = new LockManager(corruptConfig);
corruptLock.setPasscode('validfirst');

// Corrupt security.json on disk with malformed JSON
fs.writeFileSync(storage.SECURITY_PATH, '<<< INVALID JSON CORRUPTED DATA >>>', { mode: 0o600 });

// New LockManager startup simulates application launch with corrupted credentials
const startupCorruptLock = new LockManager(corruptConfig);
check('startup with corrupted security.json enters isLocked = true', startupCorruptLock.isLocked, true);
check('startup with corrupted security.json enters isCorrupted = true', startupCorruptLock.isCorrupted, true);
check('startup with corrupted security.json reports isEnabled = true', startupCorruptLock.isEnabled(), true);
check('startup with corrupted security.json does not wipe lock.enabled from config', corruptConfig.get('lock.enabled'), true);

let threwOnCorruptVerify = false;
try {
  startupCorruptLock.verify('anything');
} catch (e) {
  threwOnCorruptVerify = e.message.includes('Security credentials file is corrupted or unreadable');
}
check('verify() refuses any passcode and throws recovery error when corrupted', threwOnCorruptVerify, true);

let threwOnCorruptRemove = false;
try {
  startupCorruptLock.removePasscode('anything');
} catch (e) {
  threwOnCorruptRemove = e.message.includes('Cannot remove passcode while security storage is corrupted');
}
check('removePasscode() refused while security storage is corrupted', threwOnCorruptRemove, true);

// Clean up corrupt file
try { fs.unlinkSync(storage.SECURITY_PATH); } catch (_) {}

/* Missing security.json when config has lock.enabled = true fails closed */
const missingCredsConfig = fake({ 'lock.enabled': true });
const missingCredsLock = new LockManager(missingCredsConfig);
check('missing credentials when config has lock.enabled=true enters isLocked = true', missingCredsLock.isLocked, true);
check('missing credentials when config has lock.enabled=true enters isCorrupted = true', missingCredsLock.isCorrupted, true);
check('missing credentials when config has lock.enabled=true reports isEnabled = true', missingCredsLock.isEnabled(), true);

fs.rmSync(sandbox, { recursive: true, force: true });

console.log(failures ? `\n${failures} lock check(s) failed` : '\nlock checks pass');
process.exit(failures ? 1 : 0);
