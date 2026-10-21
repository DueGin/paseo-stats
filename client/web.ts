import { Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const localStorage: { getItem(key: string): string | null } | undefined;

// The app's explicit language choice; null means it follows the system locale.
export function hostLanguage(): string | null {
  if (Platform.OS !== "web" || typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem("@paseo:app-settings");
    const language = raw ? JSON.parse(raw)?.language : null;
    return typeof language === "string" && language !== "system"
      ? language
      : null;
  } catch {
    return null;
  }
}
