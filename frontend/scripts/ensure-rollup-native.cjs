const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { createRequire } = require("node:module");
const { join } = require("node:path");

const nativePackageByPlatform = {
  "linux-x64": "@rollup/rollup-linux-x64-gnu",
};

const nativePackage = nativePackageByPlatform[`${process.platform}-${process.arch}`];

if (!nativePackage) {
  process.exit(0);
}

const localRequire = createRequire(join(__dirname, "..", "package.json"));

try {
  localRequire.resolve(nativePackage);
  process.exit(0);
} catch {
  // npm can skip Rollup's optional native package in CI installs. Install only
  // the platform package needed by the current Linux builder before Vite loads.
}

const lockPath = join(__dirname, "..", "package-lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));
const rollupPackage = lock.packages?.["node_modules/rollup"];
const version = rollupPackage?.optionalDependencies?.[nativePackage];

if (!version) {
  console.error(`Could not find ${nativePackage} version in package-lock.json.`);
  process.exit(1);
}

execFileSync(
  "npm",
  ["install", "--no-save", "--no-audit", "--no-fund", `${nativePackage}@${version}`],
  { cwd: join(__dirname, ".."), stdio: "inherit" },
);
