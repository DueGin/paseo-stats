export type Language = "zh" | "en";

// Picks the first supported language from the reader's preferences, so a
// browser set to "fr, zh-TW" gets Chinese rather than English. Any Chinese
// variant maps to zh; everything unsupported falls back to English.
export function resolveLanguage(tags: readonly (string | null)[]): Language {
  for (const tag of tags) {
    const base = tag?.trim().toLowerCase().split(/[-_]/)[0];
    if (base === "zh") return "zh";
    if (base === "en") return "en";
  }
  return "en";
}

// The BCP 47 tag for number and date formatting.
export function localeTag(language: Language): string {
  return language === "zh" ? "zh-CN" : "en-US";
}
