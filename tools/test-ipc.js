'use strict';

/*
 * IPC boundary security tests.
 *
 * Verifies that web page scripts inside web.whatsapp.com cannot abuse Electron
 * IPC channels to access settings, manipulate locks, steal focus, or cause DoS.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { EventEmitter } = require('events');
const { pathToFileURL } = require('url');

const mainSource = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
const start = mainSource.indexOf('const wireIpc = () => {');
const end = mainSource.indexOf('\n};\n\n/* Where the chooser opens:', start);
if (start < 0 || end < 0) throw new Error('Could not find wireIpc in main.js');
const wireIpcSnippet = mainSource.slice(start, end + 3);

let failures = 0;
const check = (label, ok, details = '') => {
  if (ok) {
    console.log('  ok   ' + label);
  } else {
    failures++;
    console.log('  FAIL ' + label + (details ? ' (' + details + ')' : ''));
  }
};

const setupRig = () => {
  const handlers = new Map();
  const listeners = new Map();

  const ipcMain = {
    handle: (channel, fn) => handlers.set(channel, fn),
    on: (channel, fn) => {
      if (!listeners.has(channel)) listeners.set(channel, []);
      listeners.get(channel).push(fn);
    },
  };

  const createFakeWindow = (name) => {
    const webContents = new EventEmitter();
    webContents.isDestroyed = () => false;
    webContents.send = () => {};
    webContents.focus = () => {};
    webContents.insertText = () => {};
    const win = new EventEmitter();
    win.webContents = webContents;
    win.isDestroyed = () => false;
    win.close = () => {};
    win.loadURL = async () => {};
    return win;
  };

  const win = createFakeWindow('main');
  const settingsWin = createFakeWindow('settings');
  const fontsWin = createFakeWindow('fonts');
  const lockWin = createFakeWindow('lock');
  const aboutWin = createFakeWindow('about');

  let bannerCalls = 0;
  const banners = {
    show: () => {
      bannerCalls++;
      return { dispose: () => {} };
    },
    closeMessage: () => 1,
    keys: () => [],
  };

  let pageFontStack = '';
  let showWindowCalls = 0;

  const context = {
    ipcMain,
    win,
    settingsWin,
    fontsWin,
    lockWin,
    aboutWin,
    banners,
    bannersAreOurs: () => true,
    storeBannersAreOurs: () => true,
    storeLive: false,
    mpris: { present: () => {}, withdraw: () => {} },
    pathToFileURL,
    path,
    URL,
    __dirname: path.resolve(__dirname, '../src'),
    console: { log: () => {}, warn: () => {} },
    config: {
      get: key => {
        if (key === 'notifications.enabled') return true;
        if (key === 'view.theme') return 'dark';
        if (key === 'lock.timeout') return 15;
        return null;
      },
    },
    app: { getPath: () => '/tmp' },
    themes: {
      THEMES: {
        dark: { name: 'Dark' },
        oled: { name: 'OLED', bg: '#000', text: '#fff', accent: '#00a884' },
      },
      markFor: () => ({ theme: 'dark', accent: 'green' }),
      getWebThemeCss: () => '/* css */',
      MARK: 'data-theme',
      ACCENT_MARK: 'data-accent',
    },
    fontFaceCss: () => '/* font faces */',
    desktopAccent: () => 'green',
    nativeTheme: { shouldUseDarkColors: true },
    autostart: { isEnabled: () => true },
    desktop: { interfaceFont: () => 'Sans' },
    fonts: {
      defaultFor: () => 'Noto',
      installed: () => ({ latin: [], arabic: [] }),
      learn: () => {},
    },
    session: {
      defaultSession: {
        getCacheSize: async () => 1024,
        clearCache: async () => {},
        clearCodeCaches: async () => {},
        availableSpellCheckerLanguages: ['en-US'],
      },
    },
    uiFont: () => 'Sans',
    forcingFont: () => true,
    pageFontStack,
    applyStyle: () => {},
    showWindowForClick: () => { showWindowCalls++; },
    links: {
      digitsOf: str => (typeof str === 'string' && /^\d+$/.test(str) ? str : null),
      inviteOf: str => (typeof str === 'string' && /^[A-Za-z0-9_-]+$/.test(str) ? str : null),
    },
    bidi: {
      paragraph: t => t,
      line: (...args) => args.filter(Boolean).join(' '),
      words: (...args) => args.filter(Boolean).join(' '),
      did: (...args) => args.filter(Boolean).join(' '),
    },
    readBody: (body) => ({ sender: 'Alice', message: body, mark: '' }),
    pushName: n => n,
    mediaFromWords: () => null,
    kindOf: () => 'message',
    playTone: () => {},
    describeThenNotify: () => {},
    pageBanners: new Map(),
    chatTitles: new Map(),
    ringingBanners: new Set(),
    unreadChatNames: new Set(),
    withdrawing: new Map(),
    unreadMessages: 0,
    setBadge: () => {},
    tray: { setAttention: () => {} },
    openChat: '',
    withdrawOpen: () => {},
    withdrawRead: () => {},
    lock: {
      verify: pass => pass === '1234',
      hasPasscode: () => true,
      setPasscode: (newPin, currentPin) => {
        if (!currentPin || currentPin !== '1234') {
          throw new Error('Current passcode is required to change passcode');
        }
        return true;
      },
      removePasscode: () => {},
    },
    unlockApp: () => {},
    lockApp: () => true,
    openCustomCss: async () => {},
    setTheme: () => {},
    setAutostart: () => {},
    changeSetting: () => ({ ok: true }),
    openSite: () => {},
    checkForUpdates: (resolve) => resolve && resolve({ ok: true }),
    manifest: { license: 'GPL', author: 'Author' },
    currentVersion: () => '1.0.0',
    lastUpdate: null,
    lastUpdateAt: 0,
    aboutShouldCheck: false,
    UPDATE_FRESH_MS: 600000,
    TITLE: 'WhatsApp',
    APP_ID: 'io.github.seotarek.whatsapp-desktop',
    process: { versions: { electron: '1.0', chrome: '1.0', node: '1.0' } },
    Date,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    Math,
    Boolean,
    SEP: '\u001e',
    pendingText: '',
  };

  vm.runInNewContext(wireIpcSnippet + '\nwireIpc();', context);

  return {
    handlers,
    listeners,
    win,
    settingsWin,
    fontsWin,
    lockWin,
    aboutWin,
    context,
    getBannerCalls: () => bannerCalls,
    getShowWindowCalls: () => showWindowCalls,
  };
};

async function run() {
  const rig = setupRig();
  const settingsGet = rig.handlers.get('settings:get');
  const settingsSet = rig.handlers.get('settings:set');
  const lockUnlock = rig.handlers.get('lock:unlock');
  const lockSet = rig.handlers.get('lock:set-passcode');

  // 1. WhatsApp Web calling settings:get
  const waEvent = {
    sender: rig.win.webContents,
    senderFrame: { url: 'https://web.whatsapp.com/', parent: null },
  };
  const waResult = await settingsGet(waEvent);
  check('settings:get returns null to https://web.whatsapp.com/', waResult === null);

  // 2. Iframe inside WhatsApp Web calling settings:get
  const iframeEvent = {
    sender: rig.win.webContents,
    senderFrame: { url: 'https://web.whatsapp.com/subframe', parent: {} },
  };
  const iframeResult = await settingsGet(iframeEvent);
  check('settings:get returns null to iframes', iframeResult === null);

  // 3. Connection splash connection.html calling settings:get
  const connUrl = pathToFileURL(path.resolve(__dirname, '../src/connection.html')).href;
  const connEvent = {
    sender: rig.win.webContents,
    senderFrame: { url: connUrl, parent: null },
  };
  const connResult = await settingsGet(connEvent);
  check('settings:get returns minimal tokens to connection.html',
    connResult !== null &&
    connResult.theme === 'dark' &&
    connResult.font === 'Sans' &&
    connResult.palettes !== undefined &&
    connResult.fonts === undefined &&
    connResult.spellcheckAvailable === undefined &&
    connResult.autostart === undefined
  );

  // 4. Settings window settings.html calling settings:get
  const settingsUrl = pathToFileURL(path.resolve(__dirname, '../src/settings.html')).href;
  const settingsEvent = {
    sender: rig.settingsWin.webContents,
    senderFrame: { url: settingsUrl, parent: null },
  };
  const settingsResult = await settingsGet(settingsEvent);
  check('settings:get returns full configuration to settings.html',
    settingsResult !== null &&
    settingsResult.theme === 'dark' &&
    settingsResult.fonts !== undefined &&
    settingsResult.autostart === true
  );

  // 5. WhatsApp Web attempting to call settings:set
  const waSetResult = await settingsSet(waEvent, 'privacy.stealth', true);
  check('settings:set rejects calls from https://web.whatsapp.com/',
    waSetResult && waSetResult.ok === false
  );

  // 6. Settings window calling settings:set with unauthorized key
  const invalidKeyResult = await settingsSet(settingsEvent, 'malicious.payload', true);
  check('settings:set rejects keys outside allowed namespaces',
    invalidKeyResult && invalidKeyResult.ok === false
  );

  // 7. Settings window calling settings:set with authorized key
  const validKeyResult = await settingsSet(settingsEvent, 'privacy.stealth', true);
  check('settings:set accepts keys in allowed namespaces from settings.html',
    validKeyResult && validKeyResult.ok === true
  );

  // 7b. Protection of lock settings via settings:set
  const lockEnabledResult = await settingsSet(settingsEvent, 'lock.enabled', false);
  check('settings:set rejects tampering with lock.enabled',
    lockEnabledResult && lockEnabledResult.ok === false
  );

  const lockTimeoutResult = await settingsSet(settingsEvent, 'lock.timeout', 20);
  check('settings:set accepts valid lock.timeout',
    lockTimeoutResult && lockTimeoutResult.ok === true
  );

  const invalidTimeoutResult = await settingsSet(settingsEvent, 'lock.timeout', -5);
  check('settings:set rejects invalid negative lock.timeout',
    invalidTimeoutResult && invalidTimeoutResult.ok === false
  );

  const lockSystemResult = await settingsSet(settingsEvent, 'lock.on-system-lock', true);
  check('settings:set accepts valid lock.on-system-lock',
    lockSystemResult && lockSystemResult.ok === true
  );

  const invalidLockSystemResult = await settingsSet(settingsEvent, 'lock.on-system-lock', 'invalid');
  check('settings:set rejects non-boolean lock.on-system-lock',
    invalidLockSystemResult && invalidLockSystemResult.ok === false
  );

  const unknownLockKeyResult = await settingsSet(settingsEvent, 'lock.unknown_key', 'val');
  check('settings:set rejects arbitrary keys under lock namespace',
    unknownLockKeyResult && unknownLockKeyResult.ok === false
  );

  // 8. WhatsApp Web attempting to unlock or modify lock
  const waUnlockResult = await lockUnlock(waEvent, '1234');
  check('lock:unlock rejects calls from https://web.whatsapp.com/',
    waUnlockResult && waUnlockResult.ok === false
  );

  const waLockSetResult = await lockSet(waEvent, '9999');
  check('lock:set-passcode rejects calls from https://web.whatsapp.com/',
    waLockSetResult && waLockSetResult.ok === false
  );

  // 8b. Authenticated passcode changing
  const lockSetNoCurrent = await lockSet(settingsEvent, '5678');
  check('lock:set-passcode requires current passcode when lock is set',
    lockSetNoCurrent && lockSetNoCurrent.ok === false
  );

  const lockSetWrongCurrent = await lockSet(settingsEvent, '5678', '9999');
  check('lock:set-passcode rejects incorrect current passcode',
    lockSetWrongCurrent && lockSetWrongCurrent.ok === false
  );

  const lockSetCorrectCurrent = await lockSet(settingsEvent, '5678', '1234');
  check('lock:set-passcode succeeds with correct current passcode',
    lockSetCorrectCurrent && lockSetCorrectCurrent.ok === true
  );

  // 9. Fail-closed on missing event or sender
  const nullEventResult = await settingsGet(null);
  check('fail-closed on null event', nullEventResult === null);

  const noSenderResult = await settingsGet({});
  check('fail-closed on event with no sender', noSenderResult === null);

  // 10. Rate limiting & input validation on wa:font-stack
  const fontStackHandler = rig.listeners.get('wa:font-stack')[0];
  let learned = false;
  rig.context.fonts.learn = () => { learned = true; };

  learned = false;
  fontStackHandler(waEvent, '<script>alert(1)</script>');
  check('wa:font-stack rejects strings with invalid characters', learned === false);

  learned = false;
  fontStackHandler(waEvent, 'Roboto, Segoe UI');
  check('wa:font-stack accepts valid font stack', learned === true);

  learned = false;
  fontStackHandler(waEvent, 'Open Sans, Noto Sans');
  check('wa:font-stack throttles burst calls within 5 seconds', learned === false);

  // 11. Rate limiting on wa:focus-request
  const focusHandler = rig.listeners.get('wa:focus-request')[0];
  const initialFocusCalls = rig.getShowWindowCalls();

  focusHandler(waEvent);
  check('wa:focus-request accepts first request', rig.getShowWindowCalls() === initialFocusCalls + 1);

  focusHandler(waEvent);
  focusHandler(waEvent);
  check('wa:focus-request throttles rapid focus requests within 1000ms', rig.getShowWindowCalls() === initialFocusCalls + 1);

  // 12. Notification flood protection on wa:page-notification
  const notifyHandler = rig.listeners.get('wa:page-notification')[0];
  const initialBannerCount = rig.getBannerCalls();
  for (let i = 0; i < 20; i++) {
    notifyHandler(waEvent, {
      title: 'Sender',
      body: 'Message ' + i,
      id: 'msg-' + i,
      chat: 'chat-1',
    });
  }
  const notificationsRaised = rig.getBannerCalls() - initialBannerCount;
  check('wa:page-notification enforces maximum 10 notifications/sec flood cap',
    notificationsRaised === 10,
    `raised ${notificationsRaised} instead of 10`
  );

  // 13. URL Origin & HTTPS Security Checks
  const secureScope = {};
  const isWhatsAppSecureCode = mainSource.slice(
    mainSource.indexOf('const isWhatsAppSecure ='),
    mainSource.indexOf('const isOwnPage =')
  );
  const isOwnPageCode = mainSource.slice(
    mainSource.indexOf('const isOwnPage ='),
    mainSource.indexOf('const ALLOWED_EXTERNAL_PROTOCOLS =')
  );
  vm.runInNewContext(isWhatsAppSecureCode + '\n' + isOwnPageCode + '\nsecureScope.isWhatsAppSecure = isWhatsAppSecure; secureScope.isOwnPage = isOwnPage;', { URL, secureScope });
  const { isWhatsAppSecure, isOwnPage } = secureScope;

  check('isWhatsAppSecure accepts https://web.whatsapp.com/', isWhatsAppSecure('https://web.whatsapp.com/'));
  check('isWhatsAppSecure accepts https://chat.whatsapp.com/invite', isWhatsAppSecure('https://chat.whatsapp.com/invite'));
  check('isWhatsAppSecure rejects http://web.whatsapp.com/', !isWhatsAppSecure('http://web.whatsapp.com/'));
  check('isWhatsAppSecure rejects blob: URL', !isWhatsAppSecure('blob:https://web.whatsapp.com/uuid'));
  check('isWhatsAppSecure rejects data: URL', !isWhatsAppSecure('data:text/html,<h1>hack</h1>'));
  check('isWhatsAppSecure rejects spoofed domain', !isWhatsAppSecure('https://web.whatsapp.com.attacker.com/'));
  check('isWhatsAppSecure rejects non-string input', !isWhatsAppSecure(null) && !isWhatsAppSecure(undefined) && !isWhatsAppSecure(123));

  check('isOwnPage accepts https://web.whatsapp.com/', isOwnPage('https://web.whatsapp.com/'));
  check('isOwnPage rejects http://web.whatsapp.com/', !isOwnPage('http://web.whatsapp.com/'));
  check('isOwnPage rejects subdomains like faq.whatsapp.com', !isOwnPage('https://faq.whatsapp.com/'));
  check('isOwnPage rejects non-string input', !isOwnPage(null) && !isOwnPage(undefined));

  console.log('\nipc security checks pass');
  if (failures > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
