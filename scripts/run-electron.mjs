import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

let electronCliPath;

try {
  electronCliPath = require.resolve("electron/cli.js");
} catch {
  console.error("Missing dependency: electron. Run `npm install` first.");
  process.exit(1);
}

const child = spawn(process.execPath, [electronCliPath, "."], {
  cwd: projectRoot,
  stdio: "inherit"
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
