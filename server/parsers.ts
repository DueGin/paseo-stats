import type { LogProvider } from "./paths.ts";
import type { UsageEvent } from "./types.ts";

export type ParsedUsage = Omit<UsageEvent, "agentId">;

export type ParserCarry = Record<string, string | number | null>;

export interface ParserState {
  session: string;
  native: boolean;
  carry: ParserCarry;
}

export interface LogParser {
  needles: readonly string[];
  parse(line: string, state: ParserState): ParsedUsage | null;
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : 0;
}

function parseJson(line: string): JsonRecord | null {
  try {
    return record(JSON.parse(line));
  } catch {
    return null;
  }
}

function timestamp(...values: unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

// Claude Code repeats an assistant message once per content block with the same
// usage, so the message and request ids identify one billed request.
export const claudeParser: LogParser = {
  needles: ['"usage"'],
  parse(line, state) {
    const entry = parseJson(line);
    if (!entry || entry.type !== "assistant") return null;
    const message = record(entry.message);
    const usage = record(message?.usage);
    const model = message?.model;
    if (!message || !usage || typeof model !== "string") return null;
    if (model === "<synthetic>") return null;
    const ts = timestamp(entry.timestamp);
    if (ts === null) return null;
    const input = count(usage.input_tokens);
    const output = count(usage.output_tokens);
    const cacheRead = count(usage.cache_read_input_tokens);
    const cacheWrite = count(usage.cache_creation_input_tokens);
    if (input + output + cacheRead + cacheWrite === 0) return null;
    const cacheCreation = record(usage.cache_creation);
    const id = message.id ?? entry.uuid;
    const sidechain = entry.isSidechain === true;
    const subagent =
      typeof entry.agentId === "string" ? entry.agentId : "sidechain";
    return {
      key: `claude:${String(id)}:${String(entry.requestId ?? "")}`,
      ts,
      model,
      input,
      output,
      cacheRead,
      cacheWrite,
      cacheWrite1h: Math.min(
        cacheWrite,
        count(cacheCreation?.ephemeral_1h_input_tokens),
      ),
      reportedCost: null,
      session:
        sidechain && !state.native
          ? `${state.session}/${subagent}`
          : state.session,
      native: state.native || sidechain,
    };
  },
};

// Codex reports cumulative totals plus the latest request. A repeated total is
// a duplicate emission; `last_token_usage` is that request's own usage.
export const codexParser: LogParser = {
  needles: ['"token_count"', '"turn_context"'],
  parse(line, state) {
    const entry = parseJson(line);
    if (!entry) return null;
    const payload = record(entry.payload);
    if (entry.type === "turn_context") {
      if (typeof payload?.model === "string") state.carry.model = payload.model;
      return null;
    }
    if (entry.type !== "event_msg" || payload?.type !== "token_count") {
      return null;
    }
    const info = record(payload.info);
    const last = record(info?.last_token_usage);
    const total = record(info?.total_token_usage);
    if (!info || !last || !total) return null;
    const totalTokens = count(total.total_tokens);
    if (state.carry.lastTotal === totalTokens) return null;
    state.carry.lastTotal = totalTokens;
    const ts = timestamp(entry.timestamp);
    if (ts === null) return null;
    const promptTokens = count(last.input_tokens);
    const cacheRead = Math.min(promptTokens, count(last.cached_input_tokens));
    const cacheWrite = Math.min(
      promptTokens - cacheRead,
      count(last.cache_write_input_tokens),
    );
    const output = count(last.output_tokens);
    const input = promptTokens - cacheRead - cacheWrite;
    if (input + output + cacheRead + cacheWrite === 0) return null;
    const model =
      typeof state.carry.model === "string" ? state.carry.model : "unknown";
    return {
      key: `codex:${state.session}:${totalTokens}`,
      ts,
      model,
      input,
      output,
      cacheRead,
      cacheWrite,
      cacheWrite1h: 0,
      reportedCost: null,
      session: state.session,
      native: state.native,
    };
  },
};

export const piParser: LogParser = {
  needles: ['"usage"'],
  parse(line, state) {
    const entry = parseJson(line);
    if (!entry || entry.type !== "message") return null;
    const message = record(entry.message);
    const usage = record(message?.usage);
    if (!message || message.role !== "assistant" || !usage) return null;
    const input = count(usage.input);
    const output = count(usage.output);
    const cacheRead = count(usage.cacheRead);
    const cacheWrite = count(usage.cacheWrite);
    if (input + output + cacheRead + cacheWrite === 0) return null;
    const ts = timestamp(entry.timestamp, message.timestamp);
    if (ts === null) return null;
    const cost = count(record(usage.cost)?.total);
    return {
      key: `pi:${state.session}:${String(entry.id ?? ts)}`,
      ts,
      model: typeof message.model === "string" ? message.model : "unknown",
      input,
      output,
      cacheRead,
      cacheWrite,
      cacheWrite1h: 0,
      reportedCost: cost > 0 ? cost : null,
      session: state.session,
      native: state.native,
    };
  },
};

export const PARSERS: Record<LogProvider, LogParser> = {
  claude: claudeParser,
  codex: codexParser,
  pi: piParser,
  omp: piParser,
};
