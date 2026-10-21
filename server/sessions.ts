/// <reference types="node" />
import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { readFirstLine } from "./jsonl.ts";
import type { LogProvider, LogRoots } from "./paths.ts";

export interface SessionFile {
  path: string;
  session: string;
  native: boolean;
}

export interface CodexThreadMeta {
  id: string;
  parent: string | null;
}

export interface SessionIndex {
  find(provider: LogProvider, sessionId: string): SessionFile[];
}

const UUID_SUFFIX =
  /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

async function list(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function isJsonl(entry: Dirent): boolean {
  return entry.isFile() && entry.name.endsWith(".jsonl");
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

// <root>/<project>/<session>.jsonl, plus <root>/<project>/<session>/subagents/*.jsonl
export async function indexClaude(
  roots: readonly string[],
): Promise<Map<string, SessionFile[]>> {
  const sessions = new Map<string, SessionFile[]>();
  for (const root of roots) {
    for (const project of await list(root)) {
      if (!project.isDirectory()) continue;
      const projectDir = join(root, project.name);
      for (const entry of await list(projectDir)) {
        if (isJsonl(entry)) {
          const session = entry.name.slice(0, -".jsonl".length);
          push(sessions, session, {
            path: join(projectDir, entry.name),
            session,
            native: false,
          });
        } else if (entry.isDirectory()) {
          const subagentDir = join(projectDir, entry.name, "subagents");
          for (const file of await list(subagentDir)) {
            if (!isJsonl(file)) continue;
            push(sessions, entry.name, {
              path: join(subagentDir, file.name),
              session: `${entry.name}/${file.name.slice(0, -".jsonl".length)}`,
              native: true,
            });
          }
        }
      }
    }
  }
  return sessions;
}

// <root>/<session dir>/<timestamp>_<session>.jsonl
export async function indexPi(
  roots: readonly string[],
): Promise<Map<string, SessionFile[]>> {
  const sessions = new Map<string, SessionFile[]>();
  for (const root of roots) {
    for (const dir of await list(root)) {
      if (!dir.isDirectory()) continue;
      const sessionDir = join(root, dir.name);
      for (const entry of await list(sessionDir)) {
        if (!isJsonl(entry)) continue;
        const stem = entry.name.slice(0, -".jsonl".length);
        const separator = stem.indexOf("_");
        const session = separator === -1 ? stem : stem.slice(separator + 1);
        push(sessions, session, {
          path: join(sessionDir, entry.name),
          session,
          native: false,
        });
      }
    }
  }
  return sessions;
}

async function walkJsonl(dir: string, depth: number, out: string[]) {
  for (const entry of await list(dir)) {
    const path = join(dir, entry.name);
    if (isJsonl(entry)) out.push(path);
    else if (entry.isDirectory() && depth > 0) {
      await walkJsonl(path, depth - 1, out);
    }
  }
}

export function parseCodexMeta(line: string | null): CodexThreadMeta | null {
  if (!line) return null;
  try {
    const entry = JSON.parse(line);
    if (entry?.type !== "session_meta") return null;
    const payload = entry.payload ?? {};
    const spawn = payload.source?.subagent?.thread_spawn;
    const parent = payload.parent_thread_id ?? spawn?.parent_thread_id ?? null;
    return {
      id: String(payload.id ?? payload.session_id),
      parent: typeof parent === "string" ? parent : null,
    };
  } catch {
    return null;
  }
}

// Rollouts live at <root>/YYYY/MM/DD/rollout-<time>-<thread>.jsonl. A
// subagent's thread records its parent, so a Paseo agent owns its whole tree.
export async function indexCodex(
  roots: readonly string[],
  metaCache: Record<string, CodexThreadMeta>,
): Promise<Map<string, SessionFile[]>> {
  const paths: string[] = [];
  for (const root of roots) await walkJsonl(root, 3, paths);
  const files = new Map<string, string>();
  const children = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const path of paths) {
    if (!UUID_SUFFIX.test(basename(path))) continue;
    seen.add(path);
    let meta: CodexThreadMeta | null = metaCache[path] ?? null;
    if (!meta) {
      meta = parseCodexMeta(await readFirstLine(path).catch(() => null));
      if (!meta) continue;
      metaCache[path] = meta;
    }
    files.set(meta.id, path);
    if (meta.parent) push(children, meta.parent, meta.id);
  }
  for (const path of Object.keys(metaCache)) {
    if (!seen.has(path)) delete metaCache[path];
  }
  const sessions = new Map<string, SessionFile[]>();
  for (const [id, path] of files) {
    const owned: SessionFile[] = [{ path, session: id, native: false }];
    const queue = [...(children.get(id) ?? [])];
    const visited = new Set([id]);
    while (queue.length > 0) {
      const child = queue.shift() as string;
      if (visited.has(child)) continue;
      visited.add(child);
      const childPath = files.get(child);
      if (childPath)
        owned.push({ path: childPath, session: child, native: true });
      queue.push(...(children.get(child) ?? []));
    }
    sessions.set(id, owned);
  }
  return sessions;
}

export async function buildSessionIndex(
  roots: LogRoots,
  codexMetaCache: Record<string, CodexThreadMeta>,
): Promise<SessionIndex> {
  const [claude, codex, pi, omp] = await Promise.all([
    indexClaude(roots.claude),
    indexCodex(roots.codex, codexMetaCache),
    indexPi(roots.pi),
    indexPi(roots.omp),
  ]);
  const byProvider: Record<LogProvider, Map<string, SessionFile[]>> = {
    claude,
    codex,
    pi,
    omp,
  };
  return {
    find: (provider, sessionId) => byProvider[provider].get(sessionId) ?? [],
  };
}
