"use strict";

/*
 * Integration tests for media permissions and screen sharing.
 *
 * Verifies:
 *  1. details.isMainFrame === true is strictly required for sensitive media/clipboard permissions.
 *  2. Iframes, missing details, and subframes are strictly rejected.
 *  3. Insecure protocols and unauthorized origins are strictly rejected.
 *  4. Screen sharing requires top-level frame, explicit user gesture, and https://web.whatsapp.com origin.
 *  5. Screen sharing on X11 presents a real source picker and fails closed if declined or cancelled.
 *  6. Screen sharing on Wayland verifies frame, user gesture, and origin before portal handoff.
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let failures = 0;
const check = (label, ok, details = "") => {
  if (ok) {
    console.log("  ok   " + label);
  } else {
    failures++;
    console.log("  FAIL " + label + (details ? " (" + details + ")" : ""));
  }
};

const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");

const setupHarness = ({
  onWayland = false,
  dialogChoice = 0,
  dialogThrows = false,
  sources = [],
  enableGuiPicker = false,
  guiAction = "select",
  selectedGuiIndex = 0,
  pickerThrows = false,
} = {}) => {
  let permissionRequestHandler = null;
  let permissionCheckHandler = null;
  let devicePermissionHandler = null;
  let displayMediaRequestHandler = null;

  const ses = {
    setPermissionRequestHandler: fn => { permissionRequestHandler = fn; },
    setPermissionCheckHandler: fn => { permissionCheckHandler = fn; },
    setDevicePermissionHandler: fn => { devicePermissionHandler = fn; },
    setDisplayMediaRequestHandler: fn => { displayMediaRequestHandler = fn; },
  };

  const desktopCapturer = {
    getSources: async () => sources,
  };

  let dialogOptionsCaptured = null;
  const dialog = {
    showMessageBoxSync: (win, opts) => {
      dialogOptionsCaptured = opts;
      if (dialogThrows) throw new Error("Simulated dialog failure");
      return dialogChoice;
    },
  };

  let lastPickerWindow = null;
  let sentSources = null;
  const ipcListeners = new Map();

  const ipcMain = {
    on: (channel, fn) => {
      if (!ipcListeners.has(channel)) ipcListeners.set(channel, []);
      ipcListeners.get(channel).push(fn);
    },
    removeListener: (channel, fn) => {
      if (ipcListeners.has(channel)) {
        const arr = ipcListeners.get(channel).filter(f => f !== fn);
        ipcListeners.set(channel, arr);
      }
    },
    listenerCount: channel => (ipcListeners.get(channel) || []).length,
  };

  class MockBrowserWindow {
    constructor(opts) {
      if (pickerThrows) throw new Error("Simulated picker window creation failure");
      this.opts = opts;
      this._destroyed = false;
      this.webContents = {
        once: (event, cb) => {
          if (event === "did-finish-load") {
            process.nextTick(() => {
              if (this._destroyed) return;
              cb();
              if (guiAction === "select") {
                const handlers = (ipcListeners.get("picker:select") || []).slice();
                handlers.forEach(h => h({ sender: this.webContents }, selectedGuiIndex));
              } else if (guiAction === "cancel") {
                const handlers = (ipcListeners.get("picker:cancel") || []).slice();
                handlers.forEach(h => h({ sender: this.webContents }));
              } else if (guiAction === "close") {
                this.close();
              }
            });
          }
        },
        send: (channel, data) => {
          if (channel === "picker:sources") sentSources = data;
        },
      };
      this._events = new Map();
      lastPickerWindow = this;
    }
    loadFile(filePath) { this.loadedFile = filePath; }
    isDestroyed() { return this._destroyed; }
    close() {
      if (this._destroyed) return;
      this._destroyed = true;
      const cbs = (this._events.get("closed") || []).slice();
      cbs.forEach(cb => cb());
    }
    on(event, cb) {
      if (!this._events.has(event)) this._events.set(event, []);
      this._events.get(event).push(cb);
    }
  }

  const win = enableGuiPicker
    ? { isDestroyed: () => false, webContents: {} }
    : { isDestroyed: () => false };

  const startPerm = mainSource.indexOf("const ALLOWED_PERMISSIONS =");
  const endScreen = mainSource.indexOf("\n};\n\n/* WhatsApp Web keys", startPerm);
  const codeSnippet = mainSource.slice(startPerm, endScreen + 3);

  const isWhatsAppWebSnippet = mainSource.slice(
    mainSource.indexOf("const isWhatsAppWeb ="),
    mainSource.indexOf("const isOwnPage =")
  );

  const context = {
    ses,
    desktopCapturer,
    dialog,
    win,
    onWayland,
    URL,
    console: { log: () => {}, warn: () => {} },
    Promise,
    setTimeout,
    BrowserWindow: enableGuiPicker ? MockBrowserWindow : undefined,
    nativeTheme: { shouldUseDarkColors: true },
    ipcMain,
    path: require('path'),
    __dirname: path.join(__dirname, '../src'),
  };

  vm.runInNewContext(
    isWhatsAppWebSnippet + "\n" +
    codeSnippet + "\n" +
    "wirePermissions(ses);\n" +
    "wireScreenSharing(ses);\n",
    context
  );

  return {
    askPermission: (contents, permission, details) => {
      let result = null;
      permissionRequestHandler(contents, permission, granted => { result = granted; }, details);
      return result;
    },
    checkPermission: (contents, permission, origin, details) => {
      return permissionCheckHandler(contents, permission, origin, details);
    },
    checkDevice: details => {
      return devicePermissionHandler(details);
    },
    requestScreenShare: async request => {
      let result = null;
      await displayMediaRequestHandler(request, res => { result = res; });
      return result;
    },
    getDialogOptions: () => dialogOptionsCaptured,
    getLastPickerWindow: () => lastPickerWindow,
    getSentSources: () => sentSources,
    getIpcListenerCount: channel => ipcMain.listenerCount(channel),
  };
};

async function run() {
  const defaultSources = [
    { id: "screen:0:0", name: "Primary Screen (Display 1)" },
    { id: "screen:1:0", name: "Secondary Screen (Display 2)" },
    { id: "window:1234:0", name: "Terminal Window" },
  ];

  /* ------------------------------------------------ Permission Request Handler */
  const h1 = setupHarness();
  const validContents = { getURL: () => "https://web.whatsapp.com/" };
  const insecureContents = { getURL: () => "http://web.whatsapp.com/" };
  const foreignContents = { getURL: () => "https://evil.com/" };
  const subdomContents = { getURL: () => "https://faq.whatsapp.com/" };

  // 1. Sensitive permissions require details.isMainFrame === true
  check("media permission granted to top main frame on https://web.whatsapp.com/",
    h1.askPermission(validContents, "media", { isMainFrame: true }) === true
  );
  check("media permission rejected for iframe (isMainFrame === false)",
    h1.askPermission(validContents, "media", { isMainFrame: false }) === false
  );
  check("media permission rejected when details has no isMainFrame",
    h1.askPermission(validContents, "media", {}) === false
  );
  check("media permission rejected when details is null/undefined",
    h1.askPermission(validContents, "media", null) === false
  );
  check("media permission rejected for insecure HTTP web.whatsapp.com",
    h1.askPermission(insecureContents, "media", { isMainFrame: true }) === false
  );
  check("media permission rejected for foreign origin",
    h1.askPermission(foreignContents, "media", { isMainFrame: true }) === false
  );
  check("media permission rejected for non-web whatsapp domain (faq.whatsapp.com)",
    h1.askPermission(subdomContents, "media", { isMainFrame: true }) === false
  );
  check("media permission rejected if requestingUrl is foreign",
    h1.askPermission(validContents, "media", { isMainFrame: true, requestingUrl: "https://evil.com/leak" }) === false
  );
  check("media permission granted if requestingUrl is internal blob:",
    h1.askPermission(validContents, "media", { isMainFrame: true, requestingUrl: "blob:https://web.whatsapp.com/123" }) === true
  );

  // Other sensitive permissions
  for (const perm of ["audioCapture", "videoCapture", "display-capture", "clipboard-read"]) {
    check(perm + " rejected for subframe",
      h1.askPermission(validContents, perm, { isMainFrame: false }) === false
    );
  }

  // Non-whitelisted permission
  check("geolocation permission rejected unconditionally",
    h1.askPermission(validContents, "geolocation", { isMainFrame: true }) === false
  );

  /* ------------------------------------------------ Permission Check Handler */
  check("checkHandler approves media for main frame on https://web.whatsapp.com",
    h1.checkPermission(validContents, "media", "https://web.whatsapp.com", { isMainFrame: true }) === true
  );
  check("checkHandler rejects media for subframe",
    h1.checkPermission(validContents, "media", "https://web.whatsapp.com", { isMainFrame: false }) === false
  );
  check("checkHandler rejects media for non-web origin",
    h1.checkPermission(validContents, "media", "https://faq.whatsapp.com", { isMainFrame: true }) === false
  );

  /* ------------------------------------------------ Device Permission Handler */
  check("device permission rejected for USB devices (default-deny)",
    h1.checkDevice({ deviceType: "usb", origin: "https://web.whatsapp.com" }) === false
  );
  check("device permission rejected for HID devices (default-deny)",
    h1.checkDevice({ deviceType: "hid", origin: "https://web.whatsapp.com" }) === false
  );
  check("device permission rejected for Serial devices (default-deny)",
    h1.checkDevice({ deviceType: "serial", origin: "https://web.whatsapp.com" }) === false
  );
  check("device permission rejected for Bluetooth devices (default-deny)",
    h1.checkDevice({ deviceType: "bluetooth", origin: "https://web.whatsapp.com" }) === false
  );
  check("device permission rejected by default even for whatsapp origin",
    h1.checkDevice({ origin: "https://web.whatsapp.com" }) === false
  );

  /* ------------------------------------------------ Screen Sharing Handler (X11) */
  // 1. Frame validation
  check("screenshare rejected if request has no frame", (await h1.requestScreenShare({
    securityOrigin: "https://web.whatsapp.com",
    userGesture: true,
    frame: null,
  })).video === null);

  check("screenshare rejected if request is from subframe", (await h1.requestScreenShare({
    securityOrigin: "https://web.whatsapp.com",
    userGesture: true,
    frame: { parent: {} },
  })).video === null);

  // 2. User Gesture validation
  check("screenshare rejected if userGesture is false", (await h1.requestScreenShare({
    securityOrigin: "https://web.whatsapp.com",
    userGesture: false,
    frame: { parent: null },
  })).video === null);

  // 3. Origin validation
  check("screenshare rejected for insecure or non-web origin", (await h1.requestScreenShare({
    securityOrigin: "https://faq.whatsapp.com",
    userGesture: true,
    frame: { parent: null },
  })).video === null);

  // 4. User confirmation & real source picker on X11
  const hX11Confirm = setupHarness({ onWayland: false, dialogChoice: 1, sources: defaultSources });
  const shareResult = await hX11Confirm.requestScreenShare({
    securityOrigin: "https://web.whatsapp.com",
    userGesture: true,
    frame: { parent: null },
  });
  check("screenshare dialog presents source choices and Cancel option",
    Array.isArray(hX11Confirm.getDialogOptions()?.buttons) &&
    hX11Confirm.getDialogOptions()?.buttons.includes("Cancel") &&
    hX11Confirm.getDialogOptions()?.buttons.includes("Secondary Screen (Display 2)")
  );
  check("screenshare dialog sets Cancel as defaultId and cancelId",
    hX11Confirm.getDialogOptions()?.defaultId === hX11Confirm.getDialogOptions()?.cancelId &&
    hX11Confirm.getDialogOptions()?.buttons[hX11Confirm.getDialogOptions()?.defaultId] === "Cancel"
  );
  check("screenshare returns selected source when user picks choice",
    shareResult.video && shareResult.video.id === "screen:1:0"
  );

  // Check all sources without 4-source cap
  const sixSources = [
    { id: "screen:0", name: "Screen 0" },
    { id: "screen:1", name: "Screen 1" },
    { id: "window:1", name: "Win 1" },
    { id: "window:2", name: "Win 2" },
    { id: "window:3", name: "Win 3" },
    { id: "window:4", name: "Win 4" },
  ];
  const hX11AllSources = setupHarness({ onWayland: false, dialogChoice: 6, sources: sixSources });
  await hX11AllSources.requestScreenShare({
    securityOrigin: "https://web.whatsapp.com",
    userGesture: true,
    frame: { parent: null },
  });
  check("screenshare dialog presents all sources without 4-source cap",
    hX11AllSources.getDialogOptions()?.buttons.length === 7 &&
    hX11AllSources.getDialogOptions()?.buttons.includes("Win 4")
  );

  // 5. User cancels or declines
  const hX11Cancel = setupHarness({ onWayland: false, dialogChoice: 3, sources: defaultSources });
  const cancelResult = await hX11Cancel.requestScreenShare({
    securityOrigin: "https://web.whatsapp.com",
    userGesture: true,
    frame: { parent: null },
  });
  check("screenshare returns video: null when user cancels dialog",
    cancelResult.video === null
  );

  // 6. Fail-closed on dialog exception
  const hX11Error = setupHarness({ onWayland: false, dialogThrows: true, sources: defaultSources });
  const errorResult = await hX11Error.requestScreenShare({
    securityOrigin: "https://web.whatsapp.com",
    userGesture: true,
    frame: { parent: null },
  });
  check("screenshare fails closed (video: null) when dialog throws",
    errorResult.video === null
  );

  /* ------------------------------------------------ Screen Sharing Handler (Wayland) */
  const hWayland = setupHarness({ onWayland: true });
  const waylandResult = await hWayland.requestScreenShare({
    securityOrigin: "https://web.whatsapp.com",
    userGesture: true,
    frame: { parent: null },
  });
  check("screenshare on Wayland delegates to desktop portal after verifying frame, gesture, and origin",
    waylandResult.video && waylandResult.video.id === "screen:0:0"
  );

  const waylandDenied = await hWayland.requestScreenShare({
    securityOrigin: "https://evil.com",
    userGesture: true,
    frame: { parent: null },
  });
  check("screenshare on Wayland blocks non-whatsapp origin before portal delegation",
    waylandDenied.video === null
  );

  /* ------------------------------------------------ Screen Sharing GUI Picker (showPickerWindow) */
  // 1. GUI picker launches, serializes all sources, and user selects an item
  const hGuiSelect = setupHarness({
    onWayland: false,
    enableGuiPicker: true,
    guiAction: "select",
    selectedGuiIndex: 1,
    sources: defaultSources,
  });
  const guiSelectResult = await hGuiSelect.requestScreenShare({
    securityOrigin: "https://web.whatsapp.com",
    userGesture: true,
    frame: { parent: null },
  });
  const pickerWin = hGuiSelect.getLastPickerWindow();
  check("GUI picker launches modal BrowserWindow with share-picker.html",
    pickerWin &&
    pickerWin.opts.modal === true &&
    pickerWin.opts.width === 680 &&
    pickerWin.opts.height === 540 &&
    pickerWin.opts.webPreferences.preload.endsWith("share-picker-preload.js") &&
    pickerWin.loadedFile.endsWith("share-picker.html")
  );
  check("GUI picker serializes all sources via did-finish-load",
    Array.isArray(hGuiSelect.getSentSources()) &&
    hGuiSelect.getSentSources().length === defaultSources.length &&
    hGuiSelect.getSentSources()[0].isScreen === true
  );
  check("GUI picker returns selected source on picker:select IPC",
    guiSelectResult.video && guiSelectResult.video.id === "screen:1:0"
  );
  check("GUI picker cleans up IPC listeners and closes window after selection",
    pickerWin.isDestroyed() === true &&
    hGuiSelect.getIpcListenerCount("picker:select") === 0 &&
    hGuiSelect.getIpcListenerCount("picker:cancel") === 0
  );

  // 2. GUI picker cancelled by user
  const hGuiCancel = setupHarness({
    onWayland: false,
    enableGuiPicker: true,
    guiAction: "cancel",
    sources: defaultSources,
  });
  const guiCancelResult = await hGuiCancel.requestScreenShare({
    securityOrigin: "https://web.whatsapp.com",
    userGesture: true,
    frame: { parent: null },
  });
  check("GUI picker returns video: null on picker:cancel IPC",
    guiCancelResult.video === null &&
    hGuiCancel.getLastPickerWindow().isDestroyed() === true &&
    hGuiCancel.getIpcListenerCount("picker:select") === 0
  );

  // 3. GUI picker closed by user
  const hGuiClose = setupHarness({
    onWayland: false,
    enableGuiPicker: true,
    guiAction: "close",
    sources: defaultSources,
  });
  const guiCloseResult = await hGuiClose.requestScreenShare({
    securityOrigin: "https://web.whatsapp.com",
    userGesture: true,
    frame: { parent: null },
  });
  check("GUI picker fails closed (video: null) on window closed event",
    guiCloseResult.video === null &&
    hGuiClose.getIpcListenerCount("picker:select") === 0
  );

  // 4. GUI picker instantiation failure falls back cleanly to dialog
  const hGuiFallback = setupHarness({
    onWayland: false,
    enableGuiPicker: true,
    pickerThrows: true,
    dialogChoice: 0,
    sources: defaultSources,
  });
  const guiFallbackResult = await hGuiFallback.requestScreenShare({
    securityOrigin: "https://web.whatsapp.com",
    userGesture: true,
    frame: { parent: null },
  });
  check("GUI picker failure falls back cleanly to dialog",
    guiFallbackResult.video && guiFallbackResult.video.id === "screen:0:0"
  );

  /* ------------------------------------------------ share-picker.html DOM Functional Tests */
  const htmlContent = fs.readFileSync(path.join(__dirname, "..", "src", "share-picker.html"), "utf8");
  const scriptMatch = /<script>([\s\S]*?)<\/script>/.exec(htmlContent);
  check("share-picker.html contains client script block", !!scriptMatch);
  const scriptCode = scriptMatch[1];

  function createPickerDomEnv() {
    class MockElement {
      constructor(tag, id = "", className = "") {
        this.tagName = tag.toUpperCase();
        this.id = id;
        this.className = className;
        const classSet = new Set(className ? className.split(/\s+/).filter(Boolean) : []);
        const self = this;
        this.classList = {
          add(...cls) { cls.forEach(c => classSet.add(c)); self.className = Array.from(classSet).join(' '); },
          remove(...cls) { cls.forEach(c => classSet.delete(c)); self.className = Array.from(classSet).join(' '); },
          toggle(cls, force) {
            if (force === undefined) {
              if (classSet.has(cls)) classSet.delete(cls);
              else classSet.add(cls);
            } else if (force) {
              classSet.add(cls);
            } else {
              classSet.delete(cls);
            }
            self.className = Array.from(classSet).join(' ');
          },
          contains(cls) { return classSet.has(cls); }
        };
        this.children = [];
        this.dataset = {};
        this.listeners = {};
        this.disabled = false;
        this._innerHTML = "";
        this.textContent = "";
        this.title = "";
        this.src = "";
      }
      set innerHTML(val) {
        this._innerHTML = val;
        this.children = [];
      }
      get innerHTML() {
        return this._innerHTML;
      }
      appendChild(child) {
        this.children.push(child);
        return child;
      }
      addEventListener(event, fn) {
        this.listeners[event] = this.listeners[event] || [];
        this.listeners[event].push(fn);
      }
      click() {
        (this.listeners["click"] || []).forEach(fn => fn({ target: this }));
      }
      dblclick() {
        (this.listeners["dblclick"] || []).forEach(fn => fn({ target: this }));
      }
    }

    const listEl = new MockElement("main", "sourcesList");
    const shareBtn = new MockElement("button", "shareBtn", "btn btn-primary");
    shareBtn.disabled = true;
    const cancelBtn = new MockElement("button", "cancelBtn", "btn btn-secondary");
    const filterAll = new MockElement("button", "", "filter-btn active");
    filterAll.dataset.filter = "all";
    const filterScreen = new MockElement("button", "", "filter-btn");
    filterScreen.dataset.filter = "screen";
    const filterWindow = new MockElement("button", "", "filter-btn");
    filterWindow.dataset.filter = "window";
    const filterBtns = [filterAll, filterScreen, filterWindow];

    let selectedApiIndex = null;
    let cancelled = false;
    let onSourcesCallback = null;

    const mockDoc = {
      activeElement: cancelBtn,
      getElementById(id) {
        if (id === "sourcesList") return listEl;
        if (id === "shareBtn") return shareBtn;
        if (id === "cancelBtn") return cancelBtn;
        return null;
      },
      querySelectorAll(selector) {
        if (selector === ".filter-btn") return filterBtns;
        if (selector === ".source-card") return listEl.children;
        return [];
      },
      createElement(tag) {
        return new MockElement(tag);
      }
    };

    const windowListeners = {};
    const mockWindow = {
      addEventListener(event, fn) {
        windowListeners[event] = windowListeners[event] || [];
        windowListeners[event].push(fn);
      },
      dispatchKeydown(key) {
        (windowListeners["keydown"] || []).forEach(fn => fn({ key }));
      },
      pickerApi: {
        onSources(fn) {
          onSourcesCallback = fn;
        },
        select(idx) {
          selectedApiIndex = idx;
        },
        cancel() {
          cancelled = true;
        }
      }
    };

    const ctx = vm.createContext({
      document: mockDoc,
      window: mockWindow,
      console,
      Number,
      Array,
      Boolean,
    });

    vm.runInContext(scriptCode, ctx);

    return {
      listEl,
      shareBtn,
      cancelBtn,
      filterBtns: { all: filterAll, screen: filterScreen, window: filterWindow },
      mockDoc,
      mockWindow,
      loadSources: (srcs) => onSourcesCallback && onSourcesCallback(srcs),
      getSelectedApiIndex: () => selectedApiIndex,
      isCancelled: () => cancelled,
    };
  }

  const domEnv = createPickerDomEnv();
  const sampleSources = [
    { index: 0, id: "screen:0:0", name: "Entire Screen 1", isScreen: true, thumbnail: "data:image/png;base64,abc" },
    { index: 1, id: "window:1:0", name: "Visual Studio Code", isScreen: false, thumbnail: "" },
    { index: 2, id: "window:2:0", name: "Terminal", isScreen: false, thumbnail: "" },
  ];

  // 1. Initial render
  domEnv.loadSources(sampleSources);
  check("share-picker DOM renders cards for all sources initially",
    domEnv.listEl.children.length === 3
  );
  check("share-picker DOM initial share button is disabled",
    domEnv.shareBtn.disabled === true
  );

  // 2. Filter tabs
  domEnv.filterBtns.screen.click();
  check("share-picker DOM filter by 'screen' shows only screen sources",
    domEnv.listEl.children.length === 1 && domEnv.listEl.children[0].dataset.index === 0
  );
  domEnv.filterBtns.window.click();
  check("share-picker DOM filter by 'window' shows only window sources",
    domEnv.listEl.children.length === 2 && domEnv.listEl.children[0].dataset.index === 1
  );
  domEnv.filterBtns.all.click();
  check("share-picker DOM filter by 'all' restores full source list",
    domEnv.listEl.children.length === 3
  );

  // 3. Selection
  const firstCard = domEnv.listEl.children[0];
  firstCard.click();
  check("share-picker DOM clicking card selects it and enables share button",
    firstCard.classList.contains("selected") === true &&
    domEnv.shareBtn.disabled === false
  );

  // 4. Share button click
  domEnv.shareBtn.click();
  check("share-picker DOM clicking share button submits selected source index",
    domEnv.getSelectedApiIndex() === 0
  );

  // 5. Double click on card triggers immediate share
  const envDbl = createPickerDomEnv();
  envDbl.loadSources(sampleSources);
  envDbl.listEl.children[1].dblclick();
  check("share-picker DOM double clicking card selects and submits immediately",
    envDbl.getSelectedApiIndex() === 1
  );

  // 6. Cancel button click
  const envCancel = createPickerDomEnv();
  envCancel.loadSources(sampleSources);
  envCancel.cancelBtn.click();
  check("share-picker DOM clicking cancel button triggers pickerApi.cancel()",
    envCancel.isCancelled() === true
  );

  // 7. Keyboard: Escape triggers cancel
  const envEsc = createPickerDomEnv();
  envEsc.loadSources(sampleSources);
  envEsc.mockWindow.dispatchKeydown("Escape");
  check("share-picker DOM pressing Escape triggers pickerApi.cancel()",
    envEsc.isCancelled() === true
  );

  // 8. Keyboard: Enter on active Cancel button triggers cancel
  const envEnterCancel = createPickerDomEnv();
  envEnterCancel.loadSources(sampleSources);
  envEnterCancel.mockDoc.activeElement = envEnterCancel.cancelBtn;
  envEnterCancel.mockWindow.dispatchKeydown("Enter");
  check("share-picker DOM pressing Enter while Cancel is active triggers cancel",
    envEnterCancel.isCancelled() === true && envEnterCancel.getSelectedApiIndex() === null
  );

  // 9. Keyboard: Enter when card is selected submits share
  const envEnterShare = createPickerDomEnv();
  envEnterShare.loadSources(sampleSources);
  envEnterShare.mockDoc.activeElement = envEnterShare.shareBtn;
  envEnterShare.listEl.children[2].click();
  envEnterShare.mockWindow.dispatchKeydown("Enter");
  check("share-picker DOM pressing Enter with selected item submits share",
    envEnterShare.getSelectedApiIndex() === 2
  );

  console.log("\npermissions and screenshare security checks pass");
  if (failures > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
