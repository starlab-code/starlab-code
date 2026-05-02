// Windows-only low-level keyboard hook to block OS-level shortcuts
// (Win key, Alt+Tab, Alt+Esc, Alt+F4, Ctrl+Esc, virtual desktop shortcuts)
// while a student is in kiosk mode.
//
// Note: Ctrl+Alt+Del cannot be blocked from user-mode code on Windows — it is the
// Secure Attention Sequence and only Group Policy / Shell replacement can affect it.

const WH_KEYBOARD_LL = 13;
const HC_ACTION = 0;

const VK_TAB = 0x09;
const VK_ESCAPE = 0x1b;
const VK_SPACE = 0x20;
const VK_LEFT = 0x25;
const VK_RIGHT = 0x27;
const VK_D = 0x44;
const VK_F = 0x46;
const VK_LWIN = 0x5b;
const VK_RWIN = 0x5c;
const VK_F4 = 0x73;
const VK_MENU = 0x12;
const VK_LMENU = 0xa4;
const VK_RMENU = 0xa5;
const VK_CONTROL = 0x11;
const VK_LCONTROL = 0xa2;
const VK_RCONTROL = 0xa3;

const LLKHF_ALTDOWN = 0x20;

let koffi = null;
let user32 = null;
let kernel32 = null;
let SetWindowsHookExW = null;
let UnhookWindowsHookEx = null;
let CallNextHookEx = null;
let GetAsyncKeyState = null;
let GetModuleHandleW = null;
let HOOKPROC = null;
let KBDLLHOOKSTRUCT = null;
let loadAttempted = false;
let loadOk = false;
let lastError = null;

let installed = false;
let hookHandle = null;
let registeredCallback = null;

function tryLoad() {
  if (loadAttempted) return loadOk;
  loadAttempted = true;
  if (process.platform !== "win32") {
    lastError = new Error("kiosk hook is only supported on Windows");
    return false;
  }
  try {
    koffi = require("koffi");
    user32 = koffi.load("user32.dll");
    kernel32 = koffi.load("kernel32.dll");

    KBDLLHOOKSTRUCT = koffi.struct("KBDLLHOOKSTRUCT", {
      vkCode: "uint32_t",
      scanCode: "uint32_t",
      flags: "uint32_t",
      time: "uint32_t",
      dwExtraInfo: "uintptr_t",
    });

    HOOKPROC = koffi.proto("intptr_t __stdcall HOOKPROC(int code, uintptr_t wParam, intptr_t lParam)");

    SetWindowsHookExW = user32.func(
      "SetWindowsHookExW",
      "void*",
      ["int", koffi.pointer(HOOKPROC), "void*", "uint32_t"],
    );
    UnhookWindowsHookEx = user32.func("UnhookWindowsHookEx", "bool", ["void*"]);
    CallNextHookEx = user32.func(
      "CallNextHookEx",
      "intptr_t",
      ["void*", "int", "uintptr_t", "intptr_t"],
    );
    GetAsyncKeyState = user32.func("GetAsyncKeyState", "int16_t", ["int"]);
    GetModuleHandleW = kernel32.func("GetModuleHandleW", "void*", ["void*"]);

    loadOk = true;
    return true;
  } catch (error) {
    lastError = error;
    return false;
  }
}

function isPressed(vk) {
  return (GetAsyncKeyState(vk) & 0x8000) !== 0;
}

function shouldBlock(kbd) {
  const vk = kbd.vkCode;
  const altDown = (kbd.flags & LLKHF_ALTDOWN) !== 0;
  const winDown = isPressed(VK_LWIN) || isPressed(VK_RWIN);
  const ctrlDown = isPressed(VK_CONTROL) || isPressed(VK_LCONTROL) || isPressed(VK_RCONTROL);

  // In lockdown mode, Alt and Win are shell-navigation keys first. Blocking the
  // modifier itself is stricter than waiting for Alt+Tab/Win+Arrow, and prevents
  // the shell switcher from opening before the second key arrives.
  if (vk === VK_MENU || vk === VK_LMENU || vk === VK_RMENU) return true;
  if (vk === VK_LWIN || vk === VK_RWIN) return true;
  if (winDown) return true;
  if (altDown && (vk === VK_TAB || vk === VK_ESCAPE || vk === VK_F4)) return true;
  if (altDown && vk === VK_SPACE) return true;
  if (ctrlDown && winDown && (vk === VK_LEFT || vk === VK_RIGHT || vk === VK_D || vk === VK_F4)) {
    return true;
  }
  if (ctrlDown && altDown && vk === VK_TAB) return true;
  if (vk === VK_ESCAPE) {
    if (ctrlDown) {
      return true;
    }
  }
  return false;
}

function hookProc(code, wParam, lParam) {
  if (code !== HC_ACTION) {
    return CallNextHookEx(null, code, wParam, lParam);
  }
  try {
    const kbd = koffi.decode(lParam, KBDLLHOOKSTRUCT);
    if (shouldBlock(kbd)) return 1;
  } catch {
    // If decoding fails for any reason, pass the event through rather than swallow it.
  }
  return CallNextHookEx(null, code, wParam, lParam);
}

function install() {
  if (installed) return true;
  if (!tryLoad()) return false;
  try {
    registeredCallback = koffi.register(hookProc, koffi.pointer(HOOKPROC));
    const hMod = GetModuleHandleW(null);
    hookHandle = SetWindowsHookExW(WH_KEYBOARD_LL, registeredCallback, hMod, 0);
    if (!hookHandle) {
      koffi.unregister(registeredCallback);
      registeredCallback = null;
      lastError = new Error("SetWindowsHookExW returned NULL");
      return false;
    }
    installed = true;
    return true;
  } catch (error) {
    lastError = error;
    if (registeredCallback) {
      try {
        koffi.unregister(registeredCallback);
      } catch {
        // ignore
      }
      registeredCallback = null;
    }
    return false;
  }
}

function uninstall() {
  if (!installed) return;
  try {
    if (hookHandle) UnhookWindowsHookEx(hookHandle);
  } catch {
    // ignore
  }
  hookHandle = null;
  if (registeredCallback) {
    try {
      koffi.unregister(registeredCallback);
    } catch {
      // ignore
    }
    registeredCallback = null;
  }
  installed = false;
}

module.exports = {
  install,
  uninstall,
  isInstalled: () => installed,
  getLastError: () => lastError,
};
