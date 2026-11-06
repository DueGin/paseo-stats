// Errors the server reports to the client as plain English text. The client
// recognises these and shows them in the reader's language (client/errors.ts),
// so keep the wording here and change both sides together.
export const ERRORS = {
  emptyPrices: "empty price list",
  cannotUpdate: "This installation cannot update itself",
  githubTimeout: "GitHub request timed out",
} as const;

export function httpError(status: number, service?: string): string {
  return service ? `${service} HTTP ${status}` : `HTTP ${status}`;
}

export function timeoutError(ms: number): string {
  return `timed out after ${ms}ms`;
}

export function noUpdateError(tag: string): string {
  return `No update to ${tag} is available`;
}

export function exitError(code: number | null): string {
  return `exit ${code}`;
}
