/// <reference types="vite/client" />

interface StarlabAppBridge {
  isDesktop: true;
  setRole(role: "teacher" | "student" | null): Promise<{ ok: boolean }>;
  requestExit(): Promise<{ ok: boolean; gated: boolean }>;
  requestLogout(): Promise<{ ok: boolean; gated: boolean }>;
}

interface Window {
  starlabApp?: StarlabAppBridge;
}
