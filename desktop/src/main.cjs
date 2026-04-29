const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, Menu, net, protocol, shell, ipcMain } = require("electron");

const DEFAULT_APP_URL = "http://localhost:5173";
const LOCAL_APP_DIR = path.join(__dirname, "..", "app");
const UPDATE_CONFIG_PATH = path.join(__dirname, "..", "update-config.json");
const UPDATE_HTML_PATH = path.join(__dirname, "update.html");
const UPDATE_FETCH_TIMEOUT_MS = 6000;

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

  const exePath = process.execPath;
  // `start "" /wait` runs the silent NSIS installer and waits for it to finish replacing files,
  // then `start ""` re-launches the (now-updated) app exe. `shell: true` routes through
  // `cmd /d /s /c` so the nested quoting is handled correctly.
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

    // Let the renderer paint the "installing" frame before we tear the window down.
    await new Promise((resolve) => setTimeout(resolve, 700));

    launchSilentInstaller(filePath);

    // Quit so the installer can replace the running exe; hard-exit if soft quit hangs.
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
    // Backend unreachable — fall through to the main app, don't block startup.
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
    backgroundColor: "#eef2fb",
    autoHideMenuBar: true,
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

  // Once the splash has rendered, decide where to go: either run the update flow,
  // or replace the splash with the main app.
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

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
