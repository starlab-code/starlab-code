const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, Menu, net, protocol, shell, ipcMain, screen } = require("electron");

const kioskHook = require("./kiosk-hook.cjs");
const { getCurrentSsid } = require("./wifi.cjs");

const DEFAULT_APP_URL = "http://localhost:5173";
const LOCAL_APP_DIR = path.join(__dirname, "..", "app");
const UPDATE_CONFIG_PATH = path.join(__dirname, "..", "update-config.json");
const UPDATE_HTML_PATH = path.join(__dirname, "update.html");
const EXIT_PROMPT_HTML_PATH = path.join(__dirname, "exit-prompt.html");
const AUTH_TOKEN_STORAGE_KEY = "starlab-code-token";
// Desktop shell logo PNG path: replace desktop/assets/logo.png with your own PNG.
// This image is used for the Electron window icon when the desktop app starts.
const APP_ICON_PATH = path.join(__dirname, "..", "assets", "logo.png");
const UPDATE_FETCH_TIMEOUT_MS = 6000;

function loadRootEnv() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

loadRootEnv();

protocol.registerSchemesAsPrivileged([
  {
    scheme: "starlab",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const updateState = {
  status: "checking",
  manifest: null,
  progress: { downloaded: 0, total: 0 },
  error: null,
  currentVersion: "",
};

let installLaunched = false;
let mainWindowRef = null;
let currentRole = null; // 'student' | 'teacher' | null
let exitPromptWindow = null;
let exitResolver = null;
let isQuittingAfterStorageCleanup = false;

function hasBundledApp() {
  return fs.existsSync(path.join(LOCAL_APP_DIR, "index.html"));
}

function getAppUrl() {
  if (process.env.STARLAB_DESKTOP_URL) {
    return process.env.STARLAB_DESKTOP_URL;
  }
  if (!app.isPackaged) {
    return DEFAULT_APP_URL;
  }
  if (hasBundledApp()) {
    return "starlab://app/index.html";
  }
  return DEFAULT_APP_URL;
}

function readUpdateConfig() {
  let cfg = {};
  try {
    const raw = fs.readFileSync(UPDATE_CONFIG_PATH, "utf8");
    cfg = JSON.parse(raw) || {};
  } catch {
    cfg = {};
  }
  if (process.env.STARLAB_API_BASE_URL) {
    cfg.apiBaseUrl = process.env.STARLAB_API_BASE_URL;
  }
  if (!cfg.apiBaseUrl) cfg.apiBaseUrl = "";
  return cfg;
}

function getAcademySsids(cfg) {
  const fromEnv = process.env.STARLAB_ACADEMY_SSIDS;
  if (fromEnv) {
    return fromEnv.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (cfg && Array.isArray(cfg.academySSIDs)) {
    return cfg.academySSIDs.map((s) => String(s).trim()).filter(Boolean);
  }
  if (cfg && typeof cfg.academySSID === "string" && cfg.academySSID.trim()) {
    return [cfg.academySSID.trim()];
  }
  return [];
}

function getExitPassword(cfg) {
  if (process.env.STARLAB_EXIT_PASSWORD) return String(process.env.STARLAB_EXIT_PASSWORD);
  if (cfg && typeof cfg.exitPassword === "string") return cfg.exitPassword;
  return "";
}

function compareVersions(left, right) {
  const parse = (value) =>
    String(value || "0.0.0")
      .replace(/^v/i, "")
      .split(".")
      .map((part) => Number.parseInt(part.replace(/\D/g, "") || "0", 10))
      .concat([0, 0, 0])
      .slice(0, 3);

  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] > b[index]) return 1;
    if (a[index] < b[index]) return -1;
  }
  return 0;
}

function safeFileName(value) {
  return String(value || "Starlab-Code-Setup.exe").replace(/[<>:"/\\|?*\x00-\x1F]/g, "-");
}

function snapshotState() {
  return {
    status: updateState.status,
    manifest: updateState.manifest,
    progress: { ...updateState.progress },
    error: updateState.error,
    currentVersion: updateState.currentVersion,
  };
}

function broadcastState() {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  const wc = mainWindowRef.webContents;
  if (wc.isLoading()) return;
  wc.send("starlab-update:state", snapshotState());
}

async function clearRendererAuthToken() {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  const wc = mainWindowRef.webContents;
  if (wc.isDestroyed() || wc.isLoading()) return;
  try {
    await wc.executeJavaScript(
      `try { window.localStorage.removeItem(${JSON.stringify(AUTH_TOKEN_STORAGE_KEY)}); true; } catch { false; }`,
      true,
    );
  } catch {
    // Best effort only: renderer-side logout also clears this token.
  }
}

function shouldCheckForUpdates() {
  if (!app.isPackaged && !process.env.STARLAB_CHECK_UPDATES_IN_DEV) return false;
  const { apiBaseUrl } = readUpdateConfig();
  return Boolean(apiBaseUrl);
}

async function fetchUpdateManifest(apiBaseUrl) {
  const url = new URL("/desktop/update", apiBaseUrl);
  url.searchParams.set("version", app.getVersion());
  url.searchParams.set("platform", process.platform);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPDATE_FETCH_TIMEOUT_MS);
  try {
    const response = await net.fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Update check failed: ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}

async function downloadInstaller(manifest) {
  const downloadUrl = manifest.download_url;
  const response = await net.fetch(downloadUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") || "0");
  const fileName = safeFileName(
    path.basename(new URL(downloadUrl).pathname) || `Starlab Code Setup ${manifest.latest_version}.exe`,
  );
  const filePath = path.join(app.getPath("downloads"), fileName);
  const reader = response.body.getReader();
  const writer = fs.createWriteStream(filePath);
  let downloaded = 0;
  let lastBroadcast = 0;

  updateState.progress = { downloaded: 0, total: contentLength };
  broadcastState();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.byteLength;
      writer.write(Buffer.from(value));

      if (mainWindowRef && !mainWindowRef.isDestroyed()) {
        const fraction = contentLength > 0 ? Math.min(downloaded / contentLength, 1) : -1;
        mainWindowRef.setProgressBar(fraction);
      }

      const now = Date.now();
      if (now - lastBroadcast > 120 || downloaded === contentLength) {
        updateState.progress = { downloaded, total: contentLength };
        broadcastState();
        lastBroadcast = now;
      }
    }
  } finally {
    await new Promise((resolve) => writer.end(resolve));
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.setProgressBar(-1);
    }
  }

  updateState.progress = { downloaded, total: contentLength || downloaded };
  broadcastState();
  return filePath;
}

function launchSilentInstaller(filePath) {
  if (installLaunched) return;
  installLaunched = true;

  // Release the keyboard hook before the installer runs so it can replace files cleanly.
  try { kioskHook.uninstall(); } catch { /* ignore */ }

  const exePath = process.execPath;
  const cmdLine = `start "" /wait "${filePath}" /S & start "" "${exePath}"`;

  const child = spawn(cmdLine, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: true,
  });
  child.unref();
}

function forceQuit() {
  try { kioskHook.uninstall(); } catch { /* ignore */ }
  try {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      mainWindowRef.removeAllListeners("close");
      mainWindowRef.destroy();
    }
  } catch {
    // ignore
  }
  app.exit(0);
}

async function runUpdateFlow(manifest) {
  updateState.manifest = manifest;
  updateState.status = "downloading";
  updateState.error = null;
  updateState.progress = { downloaded: 0, total: 0 };
  broadcastState();

  try {
    const filePath = await downloadInstaller(manifest);
    updateState.status = "installing";
    updateState.error = null;
    broadcastState();

    await new Promise((resolve) => setTimeout(resolve, 700));

    launchSilentInstaller(filePath);

    setTimeout(() => app.quit(), 500);
    setTimeout(forceQuit, 2500);
  } catch (error) {
    updateState.status = "failed";
    updateState.error = error instanceof Error ? error.message : String(error);
    broadcastState();
  }
}

function loadMainApp() {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  mainWindowRef.loadURL(getAppUrl());
}

async function bootstrapAfterSplash() {
  if (!shouldCheckForUpdates()) {
    loadMainApp();
    return;
  }

  updateState.status = "checking";
  broadcastState();

  const { apiBaseUrl } = readUpdateConfig();
  let manifest = null;
  try {
    manifest = await fetchUpdateManifest(apiBaseUrl);
  } catch {
    loadMainApp();
    return;
  }

  const updateAvailable =
    manifest &&
    manifest.available &&
    manifest.download_url &&
    compareVersions(manifest.latest_version, app.getVersion()) > 0;

  if (!updateAvailable) {
    loadMainApp();
    return;
  }

  await runUpdateFlow(manifest);
}

function engageStudentKiosk() {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  if (!mainWindowRef.isFullScreen()) mainWindowRef.setFullScreen(true);
  if (!mainWindowRef.isKiosk()) mainWindowRef.setKiosk(true);
  mainWindowRef.setAlwaysOnTop(true, "screen-saver");
  if (!kioskHook.install()) {
    const err = kioskHook.getLastError();
    if (err && process.env.STARLAB_SHOW_UPDATE_ERRORS) {
      console.error("[starlab-kiosk] failed to install keyboard hook", err);
    }
  }
}

function disengageStudentKiosk() {
  try { kioskHook.uninstall(); } catch { /* ignore */ }
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  if (mainWindowRef.isKiosk()) mainWindowRef.setKiosk(false);
  if (mainWindowRef.isFullScreen()) mainWindowRef.setFullScreen(false);
  mainWindowRef.setAlwaysOnTop(false);
}

function applyRole(role) {
  const normalized = role === "teacher" || role === "student" ? role : null;
  if (currentRole === normalized) {
    if (normalized === "student") engageStudentKiosk();
    return;
  }
  currentRole = normalized;
  if (normalized === "student") {
    engageStudentKiosk();
  } else {
    disengageStudentKiosk();
  }
}

async function showExitPasswordPrompt() {
  return new Promise((resolve) => {
    if (exitPromptWindow && !exitPromptWindow.isDestroyed()) {
      try { exitPromptWindow.focus(); } catch { /* ignore */ }
      resolve(false);
      return;
    }

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = display.bounds;
    const child = new BrowserWindow({
      parent: mainWindowRef || undefined,
      modal: true,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      resizable: false,
      maximizable: false,
      minimizable: false,
      frame: false,
      fullscreen: true,
      kiosk: true,
      alwaysOnTop: true,
      show: false,
      skipTaskbar: true,
      backgroundColor: "#0f172a",
      title: "나가기 확인",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        preload: path.join(__dirname, "preload.cjs"),
      },
    });

    exitPromptWindow = child;

    let settled = false;
    const settle = (ok) => {
      if (settled) return;
      settled = true;
      exitResolver = null;
      try {
        if (!child.isDestroyed()) {
          if (child.isKiosk()) child.setKiosk(false);
          if (child.isFullScreen()) child.setFullScreen(false);
          child.destroy();
        }
      } catch {
        // ignore
      }
      if (exitPromptWindow === child) exitPromptWindow = null;
      resolve(ok);
    };
    exitResolver = settle;

    child.loadFile(EXIT_PROMPT_HTML_PATH);

    const keepPromptLocked = () => {
      if (settled) return;
      if (child.isDestroyed()) return;
      child.restore();
      if (!child.isFullScreen()) child.setFullScreen(true);
      if (!child.isKiosk()) child.setKiosk(true);
      child.setAlwaysOnTop(true, "screen-saver");
      child.focus();
    };

    child.once("ready-to-show", () => {
      if (child.isDestroyed()) return;
      child.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      keepPromptLocked();
      child.show();
    });

    child.on("leave-full-screen", keepPromptLocked);
    child.on("leave-kiosk", keepPromptLocked);
    child.on("minimize", (event) => {
      event.preventDefault();
      keepPromptLocked();
    });
    child.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      if ((input.key || "").toLowerCase() === "f11") {
        event.preventDefault();
      }
    });

    child.on("closed", () => {
      if (!settled) settle(false);
    });
  });
}

async function requestStudentUnlock() {
  if (currentRole !== "student") return { ok: true, gated: false };

  const cfg = readUpdateConfig();
  const password = getExitPassword(cfg);
  const academySsids = getAcademySsids(cfg);

  let onAcademy = false;
  if (academySsids.length > 0) {
    const ssid = await getCurrentSsid();
    onAcademy = Boolean(
      ssid && academySsids.some((entry) => entry.toLowerCase() === ssid.toLowerCase()),
    );
  }

  // No password configured, or off the academy network → exit freely.
  if (!password || !onAcademy) {
    return { ok: true, gated: false };
  }

  const confirmed = await showExitPasswordPrompt();
  return { ok: confirmed, gated: true };
}

async function handleExitRequest() {
  const result = await requestStudentUnlock();
  if (result.ok) {
    await clearRendererAuthToken();
    isQuittingAfterStorageCleanup = true;
    setTimeout(() => app.quit(), 80);
  }
  return result;
}

ipcMain.handle("starlab-update:action", async (event, action) => {
  if (action === "retry") {
    if (updateState.status === "failed" && updateState.manifest) {
      void runUpdateFlow(updateState.manifest);
    }
    return { ok: true };
  }
  if (action === "request-state") {
    const sender = event.sender;
    if (sender && !sender.isDestroyed()) {
      sender.send("starlab-update:state", snapshotState());
    }
    return { ok: true };
  }
  return { ok: false };
});

ipcMain.handle("starlab-app:set-role", async (_event, role) => {
  applyRole(role);
  return { ok: true, role: currentRole };
});

ipcMain.handle("starlab-app:request-exit", async () => {
  return await handleExitRequest();
});

ipcMain.handle("starlab-app:request-logout", async () => {
  return await requestStudentUnlock();
});

ipcMain.handle("starlab-exit-prompt:submit", async (_event, password) => {
  const cfg = readUpdateConfig();
  const expected = getExitPassword(cfg);
  if (!expected) return false;
  const ok = String(password || "") === expected;
  if (ok && exitResolver) {
    exitResolver(true);
  }
  return ok;
});

ipcMain.on("starlab-exit-prompt:cancel", () => {
  if (exitResolver) exitResolver(false);
});

function registerBundledAppProtocol() {
  protocol.handle("starlab", (request) => {
    const url = new URL(request.url);
    let requestPath = decodeURIComponent(url.pathname);

    if (!requestPath || requestPath === "/") {
      requestPath = "/index.html";
    }

    const filePath = path.normalize(path.join(LOCAL_APP_DIR, requestPath));
    const appRoot = path.normalize(LOCAL_APP_DIR);

    if (!filePath.startsWith(appRoot)) {
      return new Response("Not found", { status: 404 });
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return net.fetch(pathToFileURL(filePath).toString());
    }

    return net.fetch(pathToFileURL(path.join(LOCAL_APP_DIR, "index.html")).toString());
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: "Starlab Code",
    icon: APP_ICON_PATH,
    backgroundColor: "#eef2fb",
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  mainWindowRef = mainWindow;
  updateState.currentVersion = app.getVersion();

  const appUrl = getAppUrl();

  // Always start on the update splash so we can route based on update availability
  // without ever showing the login flow first.
  mainWindow.loadFile(UPDATE_HTML_PATH);

  mainWindow.once("ready-to-show", () => {
    if (mainWindow.isDestroyed()) return;
    mainWindow.show();
    mainWindow.focus();
  });

  // Snap back into kiosk fullscreen *only when a student is signed in*.
  // Teacher / pre-login flows are free to use windowed mode.
  const enforceKioskIfStudent = () => {
    if (mainWindow.isDestroyed()) return;
    if (installLaunched) return;
    if (currentRole !== "student") return;
    if (!mainWindow.isFullScreen()) mainWindow.setFullScreen(true);
    if (!mainWindow.isKiosk()) mainWindow.setKiosk(true);
  };
  mainWindow.on("leave-full-screen", enforceKioskIfStudent);
  mainWindow.on("leave-kiosk", enforceKioskIfStudent);
  mainWindow.on("minimize", (event) => {
    if (installLaunched) return;
    if (currentRole !== "student") return;
    event.preventDefault();
    mainWindow.restore();
    enforceKioskIfStudent();
  });

  // Block window-level fullscreen-toggle keys when locked to a student.
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (currentRole !== "student") return;
    if (input.type !== "keyDown") return;
    const key = (input.key || "").toLowerCase();
    if (key === "f11") {
      event.preventDefault();
      return;
    }
    if ((input.control || input.meta) && input.shift && key === "f") {
      event.preventDefault();
    }
  });

  // After the splash renders, run the update check / load the main app.
  mainWindow.webContents.once("did-finish-load", () => {
    broadcastState();
    void bootstrapAfterSplash();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (appUrl.startsWith("starlab://")) {
      return;
    }
    if (url !== appUrl && !url.startsWith(`${appUrl}/`) && !url.startsWith(`${appUrl}?`)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // If the renderer reloads / re-navigates, role state in main is stale from the
  // renderer's perspective. Reset to "no role" so the renderer can re-announce after
  // it logs in again.
  mainWindow.webContents.on("did-finish-load", () => {
    if (mainWindow.isDestroyed()) return;
    if (currentRole !== null) {
      // Renderer will call setRole() again from its boot useEffect; until then,
      // leave the lockdown active to avoid a flash of unlocked state.
    }
  });

  mainWindow.on("closed", () => {
    if (mainWindowRef === mainWindow) {
      mainWindowRef = null;
    }
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  registerBundledAppProtocol();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", (event) => {
  if (isQuittingAfterStorageCleanup) return;
  event.preventDefault();
  isQuittingAfterStorageCleanup = true;
  void clearRendererAuthToken().finally(() => app.quit());
});

app.on("will-quit", () => {
  try { kioskHook.uninstall(); } catch { /* ignore */ }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
