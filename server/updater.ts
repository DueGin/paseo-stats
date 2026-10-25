/// <reference types="node" />
import { existsSync, openSync, closeSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { execCommand, spawnProcess } from "@getpaseo/plugin/server";
import type { UpdateStatus } from "../shared/update.ts";
import {
  PLUGIN_ID,
  PLUGIN_REPOSITORY,
  PLUGIN_VERSION,
} from "../shared/version.ts";

const CHECK_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;
const LOG_TAIL_BYTES = 2_000;

type Env = Record<string, string | undefined>;

export interface Installation {
  id: string;
  kind: UpdateStatus["install"];
  repository: string;
  // Registry listings pin a reviewed revision; the CLI refuses to move them.
  registry: boolean;
}

export interface Release {
  tag: string;
  version: string;
  url: string;
  publishedAt: string | null;
}

export interface UpdaterDeps {
  fetch(
    url: string,
    init: { headers: Record<string, string> },
  ): Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
  }>;
  exec(command: string, args: string[]): Promise<{ stdout: string }>;
  spawn(command: string, args: string[], logPath: string): ChildProcess;
  exists(path: string): boolean;
  env: Env;
  platform: NodeJS.Platform;
  home: string;
}

const defaultDeps: UpdaterDeps = {
  fetch: (url, init) => fetch(url, init),
  exec: (command, args) => execCommand(command, args, { timeout: 30_000 }),
  spawn: (command, args, logPath) => {
    const log = openSync(logPath, "a");
    try {
      // Detached so it outlives this process: a successful update reloads us.
      return spawnProcess(command, args, {
        detached: true,
        stdio: ["ignore", log, log],
      });
    } finally {
      closeSync(log);
    }
  },
  exists: existsSync,
  env: process.env,
  platform: process.platform,
  home: homedir(),
};

interface Semver {
  core: [number, number, number];
  pre: string | null;
}

export function parseVersion(text: string): Semver | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec(
    text.trim(),
  );
  if (!match) return null;
  return { core: [+match[1], +match[2], +match[3]], pre: match[4] ?? null };
}

export function compareVersions(a: string, b: string): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  for (let i = 0; i < 3; i += 1) {
    if (left.core[i] !== right.core[i]) return left.core[i] - right.core[i];
  }
  if (left.pre === right.pre) return 0;
  if (left.pre === null) return 1;
  if (right.pre === null) return -1;
  return left.pre.localeCompare(right.pre, "en", { numeric: true });
}

export function cliCandidates(env: Env, platform: string, home: string) {
  const names =
    platform === "win32" ? ["paseo.cmd", "paseo.exe", "paseo"] : ["paseo"];
  const onPath = (env.PATH ?? "")
    .split(platform === "win32" ? ";" : ":")
    .filter(Boolean)
    .flatMap((dir) => names.map((name) => join(dir, name)));
  const known =
    platform === "darwin"
      ? [
          "/Applications/Paseo.app/Contents/Resources/bin/paseo",
          join(home, "Applications/Paseo.app/Contents/Resources/bin/paseo"),
          join(home, ".local/bin/paseo"),
        ]
      : platform === "win32"
        ? [
            join(
              env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
              "Programs",
              "Paseo",
              "resources",
              "bin",
              "paseo.cmd",
            ),
          ]
        : [join(home, ".local/bin/paseo"), "/usr/local/bin/paseo"];
  return [env.PASEO_CLI, ...onPath, ...known].filter((path): path is string =>
    Boolean(path),
  );
}

export function githubRepository(remote: unknown): string | null {
  if (typeof remote !== "string") return null;
  const match =
    /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(
      remote,
    );
  return match ? `${match[1]}/${match[2]}` : null;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

// Picks this plugin out of `paseo plugin ls --json`: the default id, or an
// install whose Git remote points at this repository under another id.
export function findInstallation(list: unknown): Installation | null {
  if (!Array.isArray(list)) return null;
  const entries = list.map((item) => {
    const entry = record(item) ?? {};
    const identity = record(record(entry.installation)?.identity) ?? {};
    return {
      id: String(entry.id ?? ""),
      kind: String(identity.kind ?? ""),
      remote: identity.remote ?? identity.url,
      packageName: identity.packageName,
      registry: Boolean(identity.registry),
    };
  });
  const repoName = PLUGIN_REPOSITORY.split("/")[1];
  const match =
    entries.find((entry) => entry.id === PLUGIN_ID) ??
    entries.find((entry) =>
      githubRepository(entry.remote)?.endsWith(`/${repoName}`),
    ) ??
    entries.find((entry) => entry.packageName === PLUGIN_ID);
  if (!match) return null;
  const kind = match.registry
    ? ("registry" as const)
    : match.kind === "git" || match.kind === "npm" || match.kind === "directory"
      ? match.kind
      : ("unknown" as const);
  return {
    id: match.id,
    kind,
    repository: githubRepository(match.remote) ?? PLUGIN_REPOSITORY,
    registry: match.registry,
  };
}

export class Updater {
  private readonly deps: UpdaterDeps;
  private readonly logPath: string;
  private status: UpdateStatus;
  private checking: Promise<UpdateStatus> | null = null;
  private child: ChildProcess | null = null;

  constructor(dataDir: string, deps: Partial<UpdaterDeps> = {}) {
    this.deps = { ...defaultDeps, ...deps };
    this.logPath = join(dataDir, "update.log");
    this.status = {
      currentVersion: PLUGIN_VERSION,
      latestVersion: null,
      latestTag: null,
      releaseUrl: null,
      publishedAt: null,
      updateAvailable: false,
      install: "unknown",
      blocked: null,
      checkedAt: null,
      error: null,
      applying: false,
      applyError: null,
    };
  }

  check(refresh = false): Promise<UpdateStatus> {
    const fresh =
      this.status.checkedAt !== null &&
      Date.now() - this.status.checkedAt < CHECK_MAX_AGE_MS;
    if (fresh && !refresh) return Promise.resolve(this.snapshot());
    this.checking ??= this.runCheck().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  async apply(tag: string): Promise<UpdateStatus> {
    const status = await this.check(false);
    if (this.child) return this.snapshot();
    if (!status.updateAvailable || status.latestTag !== tag) {
      throw new Error(`No update to ${tag} is available`);
    }
    const cli = this.cli();
    const installation = await this.installation(cli);
    if (
      !cli ||
      !installation ||
      installation.kind === "directory" ||
      installation.kind === "registry"
    ) {
      throw new Error("This installation cannot update itself");
    }
    const target =
      installation.kind === "npm"
        ? ["--version", status.latestVersion ?? tag]
        : ["--ref", tag];
    const args = [
      "plugin",
      "update",
      installation.id,
      ...target,
      "--json",
      ...this.homeArgs(),
    ];
    await mkdir(dirname(this.logPath), { recursive: true });
    const child = this.deps.spawn(cli, args, this.logPath);
    this.child = child;
    this.status = { ...this.status, applying: true, applyError: null };
    child.on("error", (error) => this.finishApply(error.message));
    child.on("exit", (code) => {
      if (code === 0) this.finishApply(null);
      else
        void this.logTail().then((tail) =>
          this.finishApply(tail || `exit ${code}`),
        );
    });
    child.unref();
    return this.snapshot();
  }

  private finishApply(error: string | null) {
    this.child = null;
    this.status = { ...this.status, applying: false, applyError: error };
  }

  private snapshot(): UpdateStatus {
    return { ...this.status };
  }

  private homeArgs(): string[] {
    const home = this.deps.env.PASEO_HOME;
    return home ? ["--home", home] : [];
  }

  private cli(): string | null {
    const { env, platform, home } = this.deps;
    return (
      cliCandidates(env, platform, home).find((path) =>
        this.deps.exists(path),
      ) ?? null
    );
  }

  private async installation(cli: string | null): Promise<Installation | null> {
    if (!cli) return null;
    const { stdout } = await this.deps.exec(cli, [
      "plugin",
      "ls",
      "--json",
      ...this.homeArgs(),
    ]);
    return findInstallation(JSON.parse(stdout));
  }

  private async runCheck(): Promise<UpdateStatus> {
    const cli = this.cli();
    let installation: Installation | null = null;
    let error: string | null = null;
    try {
      installation = await this.installation(cli);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    let release: Release | null = null;
    try {
      release = await this.latestRelease(
        installation?.repository ?? PLUGIN_REPOSITORY,
      );
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    const updateAvailable =
      release !== null && compareVersions(release.version, PLUGIN_VERSION) > 0;
    const blocked: UpdateStatus["blocked"] = !cli
      ? "no_cli"
      : !installation
        ? "not_installed"
        : installation.kind === "directory"
          ? "directory"
          : installation.kind === "registry"
            ? "registry"
            : null;
    this.status = {
      ...this.status,
      latestVersion: release?.version ?? null,
      latestTag: release?.tag ?? null,
      releaseUrl: release?.url ?? null,
      publishedAt: release?.publishedAt ?? null,
      updateAvailable,
      install: installation?.kind ?? "unknown",
      blocked,
      checkedAt: Date.now(),
      error,
    };
    return this.snapshot();
  }

  private async latestRelease(repository: string): Promise<Release | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = await Promise.race([
      this.deps.fetch(
        `https://api.github.com/repos/${repository}/releases/latest`,
        {
          headers: {
            accept: "application/vnd.github+json",
            "user-agent": PLUGIN_ID,
          },
        },
      ),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("GitHub request timed out")),
          FETCH_TIMEOUT_MS,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const body = record(await response.json()) ?? {};
    const tag = typeof body.tag_name === "string" ? body.tag_name : null;
    if (!tag || !parseVersion(tag)) return null;
    return {
      tag,
      version: tag.replace(/^v/, ""),
      url: typeof body.html_url === "string" ? body.html_url : "",
      publishedAt:
        typeof body.published_at === "string" ? body.published_at : null,
    };
  }

  private async logTail(): Promise<string> {
    try {
      const text = await readFile(this.logPath, "utf8");
      return text.slice(-LOG_TAIL_BYTES).trim();
    } catch {
      return "";
    }
  }
}
