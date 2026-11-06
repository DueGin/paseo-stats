import { Platform } from "react-native";

// This plugin typechecks without the DOM library. Declare only what this module uses.
declare const window:
  { history: { readonly length: number; back(): void } } | undefined;

// Whether this session opened the stats screen from inside the app, so the
// history entry before it is an app page rather than another website.
let openedInApp = false;

export function markOpenedInApp(): void {
  openedInApp = true;
}

// Leaves the stats screen the way the host's close button does when it can go
// back. The plugin API has no way to close a screen, so this only works on web
// and desktop, and only when going back stays inside the app. Returns whether
// it left.
export function leaveScreen(): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  if (!openedInApp || window.history.length <= 1) return false;
  window.history.back();
  return true;
}
