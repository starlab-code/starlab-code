const { contextBridge, ipcRenderer } = require("electron");

const updateListeners = new Set();

ipcRenderer.on("starlab-update:state", (_event, payload) => {
  for (const cb of updateListeners) {
    try {
      cb(payload);
    } catch {
      // ignore listener errors so one broken handler can't break the others
    }
  }
});

contextBridge.exposeInMainWorld("starlabUpdate", {
  invoke(action) {
    return ipcRenderer.invoke("starlab-update:action", action);
  },
  onState(callback) {
    if (typeof callback !== "function") return () => {};
    updateListeners.add(callback);
    ipcRenderer.invoke("starlab-update:action", "request-state").catch(() => {});
    return () => {
      updateListeners.delete(callback);
    };
  },
});

// Main app bridge — used by the renderer to tell the desktop shell about the
// signed-in user role and to request app exit.
contextBridge.exposeInMainWorld("starlabApp", {
  isDesktop: true,
  setRole(role) {
    return ipcRenderer.invoke("starlab-app:set-role", role || null);
  },
  requestExit() {
    return ipcRenderer.invoke("starlab-app:request-exit");
  },
  requestLogout() {
    return ipcRenderer.invoke("starlab-app:request-logout");
  },
});

// Bridge used only inside the exit-password prompt window.
contextBridge.exposeInMainWorld("starlabExitPrompt", {
  submit(password) {
    return ipcRenderer.invoke("starlab-exit-prompt:submit", password);
  },
  cancel() {
    ipcRenderer.send("starlab-exit-prompt:cancel");
  },
});
