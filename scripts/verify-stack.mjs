import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const INNGEST_URL = "http://localhost:8288";
const WEB_URL = "http://localhost:3000";
const READY_TIMEOUT_MS = 120_000;
const SYNC_SETTLE_MS = 15_000;
const STOP_GRACE_MS = 10_000;

const verifyScript = process.argv[2] ?? "verify";
const rootDir = fileURLToPath(new URL("..", import.meta.url));
const webDir = fileURLToPath(new URL("../apps/web", import.meta.url));
const logPath = join(tmpdir(), "sovereign-dev-stack.log");

const say = (message) => process.stdout.write(`[verify-stack] ${message}\n`);

// Any HTTP response (even 404/500) proves the server is listening;
// only a connection error or timeout means "not up".
async function isUp(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

let stack = null;
let stackExited = false;

function startStack() {
  const log = openSync(logPath, "w");
  // detached:true puts the stack in its own process group, so we can
  // stop turbo AND its children (next, inngest) with one signal.
  stack = spawn("pnpm", ["run", "dev:all"], {
    cwd: rootDir,
    detached: true,
    stdio: ["ignore", log, log]
  });
  stack.on("exit", () => {
    stackExited = true;
  });
  stack.on("error", () => {
    stackExited = true;
  });
}

function killGroup(signal) {
  try {
    process.kill(-stack.pid, signal);
  } catch {
    // group already gone
  }
}

async function stopStack() {
  if (!stack || stackExited) return;
  say("stopping dev stack");
  killGroup("SIGTERM");
  const deadline = Date.now() + STOP_GRACE_MS;
  while (!stackExited && Date.now() < deadline) await sleep(200);
  if (!stackExited) killGroup("SIGKILL");
}

async function waitUntilUp(url, label) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await isUp(url)) {
      say(`${label} is up`);
      return;
    }
    if (stackExited) {
      throw new Error(`dev stack exited before ${label} came up (log: ${logPath})`);
    }
    await sleep(1000);
  }
  throw new Error(
    `${label} not reachable at ${url} after ${READY_TIMEOUT_MS / 1000}s (log: ${logPath})`
  );
}

function runVerify() {
  return new Promise((resolve) => {
    const child = spawn("pnpm", ["run", verifyScript], {
      cwd: webDir,
      stdio: "inherit"
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    await stopStack();
    process.exit(130);
  });
}

async function main() {
  let startedByUs = false;

  if (await isUp(INNGEST_URL)) {
    say("Inngest already running: reusing it (this script will not stop it)");
  } else {
    say(`starting dev stack (log: ${logPath})`);
    startStack();
    startedByUs = true;
  }

  try {
    await waitUntilUp(INNGEST_URL, "Inngest dev server");
    await waitUntilUp(WEB_URL, "web app");
    if (startedByUs) {
      say(`waiting ${SYNC_SETTLE_MS / 1000}s for Inngest to sync functions`);
      await sleep(SYNC_SETTLE_MS);
    }
  } catch (error) {
    say(error instanceof Error ? error.message : String(error));
    await stopStack();
    return 2;
  }

  say(`running: pnpm run ${verifyScript}`);
  const code = await runVerify();
  await stopStack();
  return code;
}

process.exit(await main());
