#!/usr/bin/env node
// npm `version` hook: copy the bumped package.json version into the plugin so
// the running code knows which release it is.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const { version } = JSON.parse(
  readFileSync(new URL("package.json", root), "utf8"),
);
const file = new URL("shared/version.ts", root);
const source = readFileSync(file, "utf8");
const next = source.replace(
  /export const PLUGIN_VERSION = "[^"]*";/,
  `export const PLUGIN_VERSION = "${version}";`,
);
if (next === source && !source.includes(`"${version}"`)) {
  throw new Error("PLUGIN_VERSION not found in shared/version.ts");
}
writeFileSync(file, next);
console.log(`shared/version.ts -> ${version}`);
