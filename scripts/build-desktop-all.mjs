import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const releaseDir = path.join(projectRoot, "release");
const rawArgs = process.argv.slice(2);

const targets = rawArgs.includes("--mac-only")
  ? [
      ["--mac", "--arm64"],
      ["--mac", "--x64"]
    ]
  : [
      ["--mac", "--arm64"],
      ["--mac", "--x64"],
      ["--win", "--x64"]
    ];

function runBuild(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(__dirname, "build-desktop.mjs"), ...args], {
      cwd: projectRoot,
      stdio: "inherit"
    });

    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Desktop packaging failed for args: ${args.join(" ")}`));
    });
  });
}

if (fs.existsSync(releaseDir)) {
  fs.rmSync(releaseDir, { recursive: true, force: true });
}

for (const targetArgs of targets) {
  await runBuild(targetArgs);
}
