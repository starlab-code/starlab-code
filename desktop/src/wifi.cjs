const { execFile } = require("child_process");

// Returns the SSID of the currently connected WLAN, or null if not on WiFi
// (cable, no WLAN driver, error, etc.). Windows-only — falls back to null
// on other platforms.
function getCurrentSsid() {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      resolve(null);
      return;
    }
    execFile(
      "netsh",
      ["wlan", "show", "interfaces"],
      { windowsHide: true, timeout: 4000 },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(parseSsid(stdout));
      },
    );
  });
}

function parseSsid(stdout) {
  if (!stdout) return null;
  // The output contains both `SSID                   : foo` and `BSSID ... : aa:bb:..`.
  // We must match the SSID line but skip BSSID. Multiple interfaces possible — first
  // connected one wins.
  const lines = String(stdout).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^bssid\b/i.test(trimmed)) continue;
    const match = trimmed.match(/^ssid\s*:\s*(.+?)\s*$/i);
    if (match) {
      const value = match[1];
      if (!value) return null;
      return value;
    }
  }
  return null;
}

module.exports = { getCurrentSsid, _parseSsid: parseSsid };
