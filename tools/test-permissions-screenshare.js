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

const setupHarness = ({ onWayland = false, dialogChoice = 0, dialogThrows = false, sources = [] } = {}) => {
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

  const win = { isDestroyed: () => false };

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
    BrowserWindow: undefined,
    nativeTheme: { shouldUseDarkColors: true },
    ipcMain: { on: () => {}, removeListener: () => {} },
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

  console.log("\npermissions and screenshare security checks pass");
  if (failures > 0) process.exit(1);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
