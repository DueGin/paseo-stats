#!/usr/bin/env node
// Fails when package.json, package-lock.json, shared/version.ts and the
// optional release tag (vX.Y.Z) disagree.
import { readFileSync } from "node:fs";

const root = new URL("..", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

const pkg = JSON.parse(read("package.json"));
const lock = JSON.parse(read("package-lock.json"));
const plugin = /export const PLUGIN_VERSION = "([^"]*)";/.exec(
  read("shared/version.ts"),
)?.[1];

const versions = {
  "package.json": pkg.version,
  "package-lock.json": lock.version,
  'package-lock.json packages[""]': lock.packages?.[""]?.version,
  "shared/version.ts": plugin,
};
const tag = process.argv[2];
if (tag) versions[`tag ${tag}`] = tag.replace(/^v/, "");

const mismatched = Object.entries(versions).filter(
  ([, value]) => value !== pkg.version,
);
if (mismatched.length > 0) {
  for (const [source, value] of Object.entries(versions)) {
    console.error(`${source}: ${value}`);
  }
  console.error(
    "Versions disagree. Bump with `npm version <patch|minor|major>`.",
  );
  process.exit(1);
}
console.log(`version ${pkg.version} OK${tag ? ` for ${tag}` : ""}`);
