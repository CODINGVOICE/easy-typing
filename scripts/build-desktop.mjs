import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const rawArgs = process.argv.slice(2);

let electronBuilderCliPath;

try {
  electronBuilderCliPath = require.resolve("electron-builder/out/cli/cli.js");
} catch {
  console.error("Missing dependency: electron-builder. Run `npm install` first.");
  process.exit(1);
}

const bundledElectronDistPath = path.join(projectRoot, "node_modules", "electron", "dist");
const localElectronDropDir = path.join(projectRoot, "electron-dist");
const bundledElectronExecutablePath = path.join(
  bundledElectronDistPath,
  "Electron.app",
  "Contents",
  "MacOS",
  "Electron"
);
const explicitArch = rawArgs.some((arg) =>
  ["--arm64", "--x64", "--ia32", "--universal"].includes(arg)
);
const targetsCurrentMac = process.platform === "darwin" && rawArgs.includes("--mac");
const injectedArgs = [];
const targetsArm64 = rawArgs.includes("--arm64");
const targetsX64 = rawArgs.includes("--x64");
const releaseDir = path.join(projectRoot, "release");
const targetsWin = rawArgs.includes("--win");
const dirOnlyBuild = rawArgs.includes("--dir");

function hasMacNotarizationCredentials() {
  return (
    Boolean(process.env.APPLE_API_KEY) &&
    Boolean(process.env.APPLE_API_KEY_ID) &&
    Boolean(process.env.APPLE_API_ISSUER)
  ) || (
    Boolean(process.env.APPLE_ID) &&
    Boolean(process.env.APPLE_APP_SPECIFIC_PASSWORD)
  ) || Boolean(process.env.APPLE_KEYCHAIN_PROFILE);
}

function warnIfMacBuildWillSkipNotarization() {
  if (!targetsCurrentMac || dirOnlyBuild || hasMacNotarizationCredentials()) {
    return;
  }

  console.warn(
    [
      "Warning: macOS build will be signed only if a Developer ID certificate is available,",
      "but notarization credentials were not provided.",
      "The app may run locally, yet downloads from GitHub Releases can be blocked by Gatekeeper",
      "with a damaged or unverifiable app message.",
      "Provide one of the following before building for release:",
      "APPLE_API_KEY + APPLE_API_KEY_ID + APPLE_API_ISSUER,",
      "or APPLE_ID + APPLE_APP_SPECIFIC_PASSWORD,",
      "or APPLE_KEYCHAIN_PROFILE."
    ].join(" ")
  );
}

function getElectronDistOverride() {
  if (targetsCurrentMac && targetsArm64) {
    if (
      fs.existsSync(bundledElectronDistPath) &&
      fs.existsSync(bundledElectronExecutablePath)
    ) {
      return bundledElectronDistPath;
    }
  }

  if (targetsCurrentMac && fs.existsSync(localElectronDropDir)) {
    return localElectronDropDir;
  }

  if (targetsWin && fs.existsSync(localElectronDropDir)) {
    return localElectronDropDir;
  }

  return null;
}

function renameReleaseArtifacts() {
  if (!fs.existsSync(releaseDir)) {
    return;
  }

  for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
    if (targetsCurrentMac && targetsArm64 && entry.isDirectory() && entry.name === "mac-arm64") {
      const sourcePath = path.join(releaseDir, entry.name);
      const targetPath = path.join(releaseDir, "macos-arm64");

      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }

      fs.renameSync(sourcePath, targetPath);
      continue;
    }

    if (targetsCurrentMac && targetsX64 && entry.isDirectory() && entry.name === "mac") {
      const sourcePath = path.join(releaseDir, entry.name);
      const targetPath = path.join(releaseDir, "macos-amd64");

      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }

      fs.renameSync(sourcePath, targetPath);
      continue;
    }

    if (targetsWin && entry.isDirectory() && entry.name === "win-unpacked") {
      const sourcePath = path.join(releaseDir, entry.name);
      const targetPath = path.join(releaseDir, "win64-unpacked");

      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }

      fs.renameSync(sourcePath, targetPath);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    let renamedFile = entry.name;

    if (targetsCurrentMac && targetsX64) {
      renamedFile = renamedFile
        .replace(/-x64-macos\.zip$/, "-amd64-macos.zip")
        .replace(/-x64-macos\.zip\.blockmap$/, "-amd64-macos.zip.blockmap");
    }

    if (renamedFile === entry.name) {
      continue;
    }

    const sourcePath = path.join(releaseDir, entry.name);
    const targetPath = path.join(releaseDir, renamedFile);

    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { force: true });
    }

    fs.renameSync(sourcePath, targetPath);
  }
}

function createWindowsInstallerZip() {
  if (!targetsWin || !fs.existsSync(releaseDir)) {
    return;
  }

  const installerName = fs
    .readdirSync(releaseDir)
    .find((name) => /-win64\.exe$/.test(name) && !name.endsWith(".blockmap"));

  if (!installerName) {
    return;
  }

  const installerPath = path.join(releaseDir, installerName);
  const installerZipPath = installerPath.replace(/\.exe$/, ".zip");
  const legacyArchiveDir = installerPath.replace(/\.exe$/, "");

  if (fs.existsSync(installerZipPath)) {
    fs.rmSync(installerZipPath, { force: true });
  }

  if (fs.existsSync(legacyArchiveDir)) {
    fs.rmSync(legacyArchiveDir, { recursive: true, force: true });
  }

  let result;

  if (process.platform === "darwin") {
    result = spawnSync("zip", ["-j", installerZipPath, installerPath], { stdio: "inherit" });
  } else if (process.platform === "win32") {
    const escapedInstallerPath = installerPath.replace(/'/g, "''");
    const escapedInstallerZipPath = installerZipPath.replace(/'/g, "''");

    result = spawnSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -LiteralPath '${escapedInstallerPath}' -DestinationPath '${escapedInstallerZipPath}' -Force`
      ],
      { stdio: "inherit" }
    );
  } else {
    result = spawnSync("zip", ["-j", installerZipPath, installerPath], { stdio: "inherit" });
  }

  if (result.status !== 0) {
    throw new Error("Failed to create Windows installer zip.");
  }
}

function removeNonZipReleaseArtifacts() {
  if (dirOnlyBuild || !fs.existsSync(releaseDir)) {
    return;
  }

  for (const entry of fs.readdirSync(releaseDir, { withFileTypes: true })) {
    const entryPath = path.join(releaseDir, entry.name);

    if (entry.isFile() && entry.name.endsWith(".zip")) {
      continue;
    }

    fs.rmSync(entryPath, { recursive: true, force: true });
  }
}


if (targetsCurrentMac && os.machine() === "arm64" && !explicitArch) {
  injectedArgs.push("--arm64");
}


const electronDistOverride = getElectronDistOverride();

if (electronDistOverride && (targetsArm64 || targetsX64)) {
  injectedArgs.push(`-c.electronDist=${electronDistOverride}`);
}

warnIfMacBuildWillSkipNotarization();

const childArgs = [...injectedArgs, ...rawArgs];

const child = spawn(process.execPath, [electronBuilderCliPath, ...childArgs], {
  cwd: projectRoot,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  if (code === 0) {
    try {
      renameReleaseArtifacts();
      createWindowsInstallerZip();
      removeNonZipReleaseArtifacts();
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
      return;
    }
  }

  process.exit(code ?? 1);
});
