const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Set();

ipcRenderer.on("starlab-update:state", (_event, payload) => {
  for (const cb of listeners) {
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
    listeners.add(callback);
    ipcRenderer.invoke("starlab-update:action", "request-state").catch(() => {});
    return () => {
      listeners.delete(callback);
    };
  },
});
