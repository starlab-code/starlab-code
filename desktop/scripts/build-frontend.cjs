const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const desktopDir = path.resolve(__dirname, "..");
const repoDir = path.resolve(desktopDir, "..");
const frontendDir = path.join(repoDir, "frontend");
const frontendDistDir = path.join(frontendDir, "dist");
const desktopAppDir = path.join(desktopDir, "app");

function loadRootEnv() {
  const envPath = path.join(repoDir, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

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

const apiBaseUrl = process.env.STARLAB_API_BASE_URL || process.env.VITE_API_BASE_URL;

if (!apiBaseUrl) {
  console.error("Missing backend URL.");
  console.error("Set STARLAB_API_BASE_URL in the repository root .env file.");
  console.error("See .env.example for the expected format.");
  process.exit(1);
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const build = spawnSync(npmCommand, ["run", "build"], {
  cwd: frontendDir,
  env: {
    ...process.env,
    VITE_API_BASE_URL: apiBaseUrl,
  },
  stdio: "inherit",
});

if (build.status !== 0) {
  process.exit(build.status || 1);
}

fs.rmSync(desktopAppDir, { recursive: true, force: true });
fs.cpSync(frontendDistDir, desktopAppDir, { recursive: true });

console.log(`Packaged frontend copied to ${desktopAppDir}`);
console.log(`API base URL: ${apiBaseUrl}`);
