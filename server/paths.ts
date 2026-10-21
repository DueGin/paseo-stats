/// <reference types="node" />
import { homedir } from "node:os";
import { join } from "node:path";

export type LogProvider = "claude" | "codex" | "pi" | "omp";

export const SUPPORTED_PROVIDERS: readonly LogProvider[] = [
  "claude",
  "codex",
  "pi",
  "omp",
];

export type LogRoots = Record<LogProvider, string[]>;

type Env = Record<string, string | undefined>;

export function resolveLogRoots(
  env: Env = process.env,
  home: string = homedir(),
): LogRoots {
  const claudeDirs = env.CLAUDE_CONFIG_DIR
    ? env.CLAUDE_CONFIG_DIR.split(",").map((dir) => dir.trim())
    : [join(home, ".claude"), join(home, ".config", "claude")];
  const codexHome = env.CODEX_HOME || join(home, ".codex");
  const piDir = env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent");
  return {
    claude: claudeDirs.filter(Boolean).map((dir) => join(dir, "projects")),
    codex: [join(codexHome, "sessions"), join(codexHome, "archived_sessions")],
    pi: [join(piDir, "sessions")],
    omp: [join(home, ".omp", "agent", "sessions")],
  };
}

export function resolveDataDir(
  env: Env = process.env,
  home: string = homedir(),
): string {
  const paseoHome = env.PASEO_HOME || join(home, ".paseo");
  return join(paseoHome, "plugin-data", "paseo-stats");
}
