export interface UsageEvent {
  key: string;
  ts: number;
  agentId: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
  reportedCost: number | null;
  session: string;
  native: boolean;
}

export interface AgentMeta {
  id: string;
  provider: string;
  title: string | null;
  cwd: string;
  projectKey: string | null;
  projectName: string | null;
  projectPath: string | null;
  parentId: string | null;
  createdAt: number | null;
  model: string | null;
  sessionId: string | null;
}

export function eventTokens(event: UsageEvent): number {
  return event.input + event.output + event.cacheRead + event.cacheWrite;
}
