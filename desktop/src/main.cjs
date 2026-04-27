const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, Menu, dialog, net, protocol, shell } = require("electron");

const DEFAULT_APP_URL = "http://localhost:5173";
const LOCAL_APP_DIR = path.join(__dirname, "..", "app");
const UPDATE_CONFIG_PATH = path.join(__dirname, "..", "update-config.json");

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

async function downloadUpdate(mainWindow, manifest) {
  const downloadUrl = manifest.download_url;
  const response = await net.fetch(downloadUrl);
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") || "0");
  const fileName = safeFileName(path.basename(new URL(downloadUrl).pathname) || `Starlab Code Setup ${manifest.latest_version}.exe`);
  const filePath = path.join(app.getPath("downloads"), fileName);
  const reader = response.body.getReader();
  const writer = fs.createWriteStream(filePath);
  let downloaded = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.byteLength;
      writer.write(Buffer.from(value));
      if (contentLength > 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setProgressBar(Math.min(downloaded / contentLength, 1));
      }
    }
  } finally {
    await new Promise((resolve) => writer.end(resolve));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setProgressBar(-1);
    }
  }

  return filePath;
}

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

    const detail = manifest.release_notes
      ? `새 버전 ${manifest.latest_version}이 준비되었습니다.\n\n${manifest.release_notes}`
      : `새 버전 ${manifest.latest_version}이 준비되었습니다.`;
    const buttons = manifest.force_update ? ["다운로드"] : ["다운로드", "나중에"];
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Starlab Code 업데이트",
      message: "업데이트를 설치할 수 있습니다",
      detail,
      buttons,
      defaultId: 0,
      cancelId: manifest.force_update ? 0 : 1,
      noLink: true,
    });

    if (result.response !== 0) return;

    const filePath = await downloadUpdate(mainWindow, manifest);
    const installResult = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "다운로드 완료",
      message: "업데이트 설치 파일을 다운로드했습니다",
      detail: `다운로드 위치:\n${filePath}\n\n지금 설치 파일을 실행할까요?`,
      buttons: ["지금 실행", "나중에"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });

    if (installResult.response === 0) {
      await shell.openPath(filePath);
      if (manifest.force_update) {
        app.quit();
      }
    }
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
