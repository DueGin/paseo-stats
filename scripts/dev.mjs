#!/usr/bin/env node
// Hot reload for development: watches the plugin sources and runs
// `paseo plugin reload` on every change, so the app picks up edits right away.
//
//   npm run dev [-- --id <plugin-id>] [-- --home <paseo-home>]
import { execFile } from "node:child_process";
import { readFileSync, realpathSync, watch } from "node:fs";
import { relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
const manifest = JSON.parse(
  readFileSync(new URL("../paseo-plugin.json", import.meta.url), "utf8"),
);
const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};
const home = option("home");
const cli = process.env.PASEO_CLI || "paseo";
const WATCHED = [
  "client",
  "server",
  "shared",
  "index.client.tsx",
  "index.server.ts",
  "paseo-plugin.json",
];
const DEBOUNCE_MS = 250;

function paseo(args) {
  return new Promise((resolve, reject) => {
    execFile(
      cli,
      [...args, ...(home ? ["--home", home] : [])],
      { shell: process.platform === "win32", maxBuffer: 8 << 20 },
      (error, stdout, stderr) =>
        error
          ? reject(new Error((stderr || error.message).trim()))
          : resolve(stdout),
    );
  });
}

function log(message) {
  const time = new Date().toLocaleTimeString();
  console.log(`[${time}] ${message}`);
}

function samePath(path) {
  try {
    return realpathSync(path) === root;
  } catch {
    return false;
  }
}

async function findPlugin() {
  const plugins = JSON.parse(await paseo(["plugin", "ls", "--json"]));
  return plugins.find((plugin) => samePath(plugin.path)) ?? null;
}

async function ensureInstalled() {
  const existing = await findPlugin();
  if (existing) return existing.id;
  const id = option("id") ?? manifest.id;
  log(`installing ${root} as ${id}`);
  try {
    await paseo(["plugin", "install", root, "--id", id, "--json"]);
  } catch (error) {
    throw new Error(
      `${error.message}\nIf ${id} is already installed from another source, run: npm run dev -- --id ${id}-dev`,
    );
  }
  return id;
}

async function report(id) {
  const plugin = (await findPlugin()) ?? { status: "missing" };
  const detail = plugin.error ? ` (${plugin.error})` : "";
  log(`${id}: ${plugin.status}${detail}`);
}

const id = await ensureInstalled();
await report(id);
log(`watching ${root}; press Ctrl+C to stop`);

let timer = null;
let reloading = Promise.resolve();
const changed = new Set();

watch(root, { recursive: true }, (_event, filename) => {
  if (!filename) return;
  const path = relative(root, `${root}${sep}${filename}`);
  if (
    !WATCHED.some((entry) => path === entry || path.startsWith(entry + sep))
  ) {
    return;
  }
  changed.add(path);
  clearTimeout(timer);
  timer = setTimeout(() => {
    const files = [...changed].join(", ");
    changed.clear();
    reloading = reloading.then(async () => {
      log(`changed: ${files}`);
      try {
        await paseo(["plugin", "reload", id, "--json"]);
      } catch (error) {
        log(`reload failed: ${error.message}`);
      }
      await report(id).catch((error) => log(error.message));
    });
  }, DEBOUNCE_MS);
});
