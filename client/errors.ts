import { ERRORS } from "../shared/errors.ts";
import type { PlainKey, Translate } from "./i18n";

type Rule = [RegExp, (match: RegExpExecArray, t: Translate) => string];

const PATTERNS: Rule[] = [
  [/^GitHub HTTP (\d+)$/, (m, t) => t("error.githubHttp", { status: m[1] })],
  [/^HTTP (\d+)$/, (m, t) => t("error.http", { status: m[1] })],
  [
    /^timed out after (\d+)ms$/,
    (m, t) =>
      t("error.timeout", { seconds: Math.max(1, Math.round(+m[1] / 1000)) }),
  ],
  [
    /^No update to (\S+) is available$/,
    (m, t) => t("error.noUpdate", { tag: m[1] }),
  ],
  [/^exit (-?\d+|null)$/, (m, t) => t("error.exit", { code: m[1] })],
  [/^fetch failed$/i, (_m, t) => t("error.network")],
];

const FIXED: Record<string, PlainKey> = {
  [ERRORS.emptyPrices]: "error.emptyPrices",
  [ERRORS.cannotUpdate]: "error.cannotUpdate",
  [ERRORS.githubTimeout]: "error.githubTimeout",
};

// Shows an error the plugin's server produced in the reader's language.
// Messages the plugin does not own (file system, CLI output) pass through.
export function localizeError(message: string, t: Translate): string {
  const text = message.trim();
  const fixed = FIXED[text];
  if (fixed) return t(fixed);
  for (const [pattern, render] of PATTERNS) {
    const match = pattern.exec(text);
    if (match) return render(match, t);
  }
  return text;
}
