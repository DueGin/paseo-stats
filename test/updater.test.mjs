import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  Updater,
  cliCandidates,
  compareVersions,
  findInstallation,
  githubRepository,
} from "../server/updater.ts";
import { PLUGIN_VERSION } from "../shared/version.ts";

const [major, minor, patch] = PLUGIN_VERSION.split(".").map(Number);
const NEWER = `v${major}.${minor}.${patch + 1}`;

test("compareVersions orders releases and prereleases", () => {
  assert.ok(compareVersions("v0.2.0", "0.1.9") > 0);
  assert.ok(compareVersions("0.1.0", "0.1.0-beta.2") > 0);
  assert.ok(compareVersions("0.1.0-beta.10", "0.1.0-beta.9") > 0);
  assert.equal(compareVersions("1.0.0", "v1.0.0"), 0);
});

test("cliCandidates honours PASEO_CLI, then PATH, then known installs", () => {
  const mac = cliCandidates(
    { PASEO_CLI: "/opt/paseo", PATH: "/usr/bin:/bin" },
    "darwin",
    "/Users/a",
  );
  assert.deepEqual(mac.slice(0, 3), [
    "/opt/paseo",
    "/usr/bin/paseo",
    "/bin/paseo",
  ]);
  assert.ok(
    mac.includes("/Applications/Paseo.app/Contents/Resources/bin/paseo"),
  );
  const win = cliCandidates({ PATH: "C:\\bin" }, "win32", "C:\\Users\\a");
  assert.equal(win[0], join("C:\\bin", "paseo.cmd"));
});

test("githubRepository parses https and ssh remotes", () => {
  assert.equal(githubRepository("https://github.com/me/repo.git"), "me/repo");
  assert.equal(githubRepository("git@github.com:me/repo"), "me/repo");
  assert.equal(githubRepository("/tmp/local.git"), null);
});

test("findInstallation prefers the default id and reads the source kind", () => {
  assert.deepEqual(
    findInstallation([
      { id: "other", installation: { identity: { kind: "directory" } } },
      {
        id: "paseo-stats",
        installation: {
          identity: {
            kind: "git",
            remote: "https://github.com/fork/paseo-stats.git",
          },
        },
      },
    ]),
    { id: "paseo-stats", kind: "git", repository: "fork/paseo-stats" },
  );
  assert.deepEqual(
    findInstallation([
      {
        id: "stats-renamed",
        installation: {
          identity: {
            kind: "git",
            remote: "https://github.com/me/paseo-stats",
          },
        },
      },
    ]),
    { id: "stats-renamed", kind: "git", repository: "me/paseo-stats" },
  );
  assert.equal(findInstallation([{ id: "x" }]), null);
});

function fakeDeps({ kind = "git", release = NEWER, status = 200 } = {}) {
  const calls = { exec: [], spawn: [], fetch: [] };
  let child;
  const deps = {
    env: { PATH: "/bin", PASEO_HOME: "/tmp/home" },
    platform: "darwin",
    home: "/Users/a",
    exists: (path) => path === "/bin/paseo",
    exec: async (command, args) => {
      calls.exec.push([command, ...args]);
      return {
        stdout: JSON.stringify([
          {
            id: "paseo-stats",
            installation: {
              identity: {
                kind,
                remote: "https://github.com/me/paseo-stats.git",
              },
            },
          },
        ]),
      };
    },
    fetch: async (url) => {
      calls.fetch.push(url);
      return {
        ok: status === 200,
        status,
        json: async () => ({
          tag_name: release,
          html_url: `https://github.com/me/paseo-stats/releases/tag/${release}`,
          published_at: "2026-10-21T00:00:00Z",
        }),
      };
    },
    spawn: (command, args) => {
      calls.spawn.push([command, ...args]);
      child = Object.assign(new EventEmitter(), { unref() {} });
      return child;
    },
  };
  return { deps, calls, child: () => child };
}

const dataDir = () => mkdtempSync(join(tmpdir(), "paseo-stats-update-"));

test("check reports a newer release and caches it", async () => {
  const { deps, calls } = fakeDeps();
  const updater = new Updater(dataDir(), deps);
  const status = await updater.check();
  assert.equal(status.updateAvailable, true);
  assert.equal(status.latestTag, NEWER);
  assert.equal(status.install, "git");
  assert.equal(status.blocked, null);
  assert.deepEqual(calls.fetch, [
    "https://api.github.com/repos/me/paseo-stats/releases/latest",
  ]);
  assert.deepEqual(calls.exec[0], [
    "/bin/paseo",
    "plugin",
    "ls",
    "--json",
    "--home",
    "/tmp/home",
  ]);
  await updater.check();
  assert.equal(calls.fetch.length, 1);
  await updater.check(true);
  assert.equal(calls.fetch.length, 2);
});

test("check handles no releases, older releases and blocked installs", async () => {
  const none = await new Updater(
    dataDir(),
    fakeDeps({ status: 404 }).deps,
  ).check();
  assert.equal(none.latestTag, null);
  assert.equal(none.updateAvailable, false);
  assert.equal(none.error, null);

  const older = await new Updater(
    dataDir(),
    fakeDeps({ release: "v0.0.1" }).deps,
  ).check();
  assert.equal(older.updateAvailable, false);

  const local = await new Updater(
    dataDir(),
    fakeDeps({ kind: "directory" }).deps,
  ).check();
  assert.equal(local.blocked, "directory");

  const noCli = fakeDeps();
  noCli.deps.exists = () => false;
  const missing = await new Updater(dataDir(), noCli.deps).check();
  assert.equal(missing.blocked, "no_cli");
  assert.equal(missing.updateAvailable, true);
});

test("apply runs paseo plugin update for the latest tag and reports failures", async () => {
  const fake = fakeDeps();
  const updater = new Updater(dataDir(), fake.deps);
  await assert.rejects(updater.apply("v9.9.9"), /No update/);
  const started = await updater.apply(NEWER);
  assert.equal(started.applying, true);
  assert.deepEqual(fake.calls.spawn[0], [
    "/bin/paseo",
    "plugin",
    "update",
    "paseo-stats",
    "--ref",
    NEWER,
    "--json",
    "--home",
    "/tmp/home",
  ]);
  fake.child().emit("exit", 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  const after = await updater.check();
  assert.equal(after.applying, false);
  assert.equal(after.applyError, "exit 1");

  const npm = fakeDeps({ kind: "npm" });
  await new Updater(dataDir(), npm.deps).apply(NEWER);
  assert.deepEqual(npm.calls.spawn[0].slice(4, 6), [
    "--version",
    NEWER.slice(1),
  ]);

  const local = new Updater(dataDir(), fakeDeps({ kind: "directory" }).deps);
  await assert.rejects(local.apply(NEWER), /cannot update itself/);
});
