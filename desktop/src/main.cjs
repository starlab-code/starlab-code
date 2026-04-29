const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, Menu, dialog, net, protocol, shell, ipcMain } = require("electron");

const DEFAULT_APP_URL = "http://localhost:5173";
const LOCAL_APP_DIR = path.join(__dirname, "..", "app");
const UPDATE_CONFIG_PATH = path.join(__dirname, "..", "update-config.json");
const OVERLAY_SCRIPT_PATH = path.join(__dirname, "update-overlay.js");

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
  status: "idle",
  manifest: null,
  progress: { downloaded: 0, total: 0 },
  error: null,
  installerPath: null,
};

let overlayScriptCache = null;
let installLaunched = false;

function hasBundledApp() {
  return fs.existsSync(path.join(LOCAL_APP_DIR, "index.html"));
}

function getAppUrl() {
  if (process.env.STARLAB_DESKTOP_URL) {
    return process.env.STARLAB_DESKTOP_URL;
  }
  if (hasBundledApp()) {
    return "starlab://app/index.html";
  }
  return DEFAULT_APP_URL;
}

function readUpdateConfig() {
  if (process.env.STARLAB_API_BASE_URL) {
    return { apiBaseUrl: process.env.STARLAB_API_BASE_URL };
  }

  try {
    const raw = fs.readFileSync(UPDATE_CONFIG_PATH, "utf8");
    return JSON.parse(raw);
  } catch {
    return { apiBaseUrl: "" };
  }
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

function loadOverlayScript() {
  if (overlayScriptCache) return overlayScriptCache;
  overlayScriptCache = fs.readFileSync(OVERLAY_SCRIPT_PATH, "utf8");
  return overlayScriptCache;
}

function getMainWindow() {
  const windows = BrowserWindow.getAllWindows();
  return windows.find((w) => !w.isDestroyed()) || null;
}

function snapshotState() {
  return {
    status: updateState.status,
    manifest: updateState.manifest,
    progress: { ...updateState.progress },
    error: updateState.error,
  };
}

function broadcastState() {
  const window = getMainWindow();
  if (!window || window.isDestroyed()) return;
  if (window.webContents.isLoading()) return;
  window.webContents.send("starlab-update:state", snapshotState());
}

async function injectOverlay(window) {
  if (!window || window.isDestroyed()) return;
  try {
    await window.webContents.executeJavaScript(loadOverlayScript(), true);
    broadcastState();
  } catch (error) {
    if (process.env.STARLAB_SHOW_UPDATE_ERRORS) {
      console.error("[starlab-update] overlay injection failed", error);
    }
  }
}

async function fetchUpdateManifest(apiBaseUrl) {
  if (!apiBaseUrl) return null;

  const url = new URL("/desktop/update", apiBaseUrl);
  url.searchParams.set("version", app.getVersion());
  url.searchParams.set("platform", process.platform);

  const response = await net.fetch(url.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Update check failed: ${response.status}`);
  }
  return response.json();
}

async function downloadInstaller(window, manifest) {
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

      if (window && !window.isDestroyed()) {
        const fraction = contentLength > 0 ? Math.min(downloaded / contentLength, 1) : -1;
        window.setProgressBar(fraction);
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
    if (window && !window.isDestroyed()) {
      window.setProgressBar(-1);
    }
  }

  updateState.progress = { downloaded, total: contentLength || downloaded };
  broadcastState();
  return filePath;
}

function launchSilentInstaller(filePath) {
  if (installLaunched) return;
  installLaunched = true;

  const exePath = process.execPath;
  // Run installer silently, wait for it to finish replacing files, then re-launch the app.
  // `&` chains regardless of exit code so we still relaunch on a benign installer warning.
  // `shell: true` routes through `cmd.exe /d /s /c` which handles the nested quotes correctly.
  const cmdLine = `start "" /wait "${filePath}" /S & start "" "${exePath}"`;

  const child = spawn(cmdLine, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    shell: true,
  });
  child.unref();
}

async function startUpdateFlow() {
  if (updateState.status === "downloading" || updateState.status === "installing") return;
  if (!updateState.manifest) return;

  const window = getMainWindow();
  updateState.status = "downloading";
  updateState.error = null;
  updateState.progress = { downloaded: 0, total: 0 };
  broadcastState();

  try {
    const filePath = await downloadInstaller(window, updateState.manifest);
    updateState.installerPath = filePath;
    updateState.status = "installing";
    updateState.error = null;
    broadcastState();

    // Give the renderer a beat to paint the "installing" state before we tear the window down.
    await new Promise((resolve) => setTimeout(resolve, 600));

    launchSilentInstaller(filePath);

    // Quit shortly after spawning so the installer can replace files cleanly.
    setTimeout(() => {
      try {
        app.quit();
      } catch {
        // ignore
      }
    }, 400);
  } catch (error) {
    updateState.status = "failed";
    updateState.error = error instanceof Error ? error.message : String(error);
    broadcastState();
  }
}

ipcMain.handle("starlab-update:action", async (event, action) => {
  const window = BrowserWindow.fromWebContents(event.sender) || getMainWindow();

  if (action === "install") {
    if (updateState.status === "available" || updateState.status === "failed") {
      void startUpdateFlow();
    }
    return { ok: true };
  }

  if (action === "retry") {
    if (updateState.status === "failed") {
      updateState.status = "available";
      void startUpdateFlow();
    }
    return { ok: true };
  }

  if (action === "dismiss") {
    if (updateState.manifest && updateState.manifest.force_update) {
      return { ok: false };
    }
    if (updateState.status !== "downloading" && updateState.status !== "installing") {
      updateState.status = "idle";
      updateState.error = null;
      broadcastState();
    }
    return { ok: true };
  }

  if (action === "request-state") {
    if (window && !window.isDestroyed()) {
      window.webContents.send("starlab-update:state", snapshotState());
    }
    return { ok: true };
  }

  return { ok: false };
});

async function checkForUpdates(mainWindow) {
  if (!app.isPackaged && !process.env.STARLAB_CHECK_UPDATES_IN_DEV) {
    return;
  }

  const { apiBaseUrl } = readUpdateConfig();
  if (!apiBaseUrl) return;

  try {
    const manifest = await fetchUpdateManifest(apiBaseUrl);
    if (!manifest?.available || !manifest.download_url) return;
    if (compareVersions(manifest.latest_version, app.getVersion()) <= 0) return;

    updateState.manifest = manifest;
    updateState.status = "available";
    updateState.error = null;
    await injectOverlay(mainWindow);
  } catch (error) {
    if (process.env.STARLAB_SHOW_UPDATE_ERRORS) {
      dialog.showErrorBox("업데이트 확인 실패", error instanceof Error ? error.message : String(error));
    }
  }
}

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
    backgroundColor: "#f7f8fb",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  const appUrl = getAppUrl();
  mainWindow.loadURL(appUrl);

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

  mainWindow.webContents.on("did-finish-load", () => {
    // Re-attach overlay on every load so reloads / navigation don't lose it.
    if (updateState.status !== "idle") {
      void injectOverlay(mainWindow);
    }
  });

  mainWindow.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      void checkForUpdates(mainWindow);
    }, 1500);
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
