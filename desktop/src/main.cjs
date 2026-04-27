const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, Menu, net, protocol, shell } = require("electron");

const DEFAULT_APP_URL = "http://localhost:5173";
const LOCAL_APP_DIR = path.join(__dirname, "..", "app");

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
