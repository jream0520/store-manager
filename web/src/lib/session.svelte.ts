import type { Settings } from "./types";

/** App-wide signed-in state and settings, shared across pages. */
export const session = $state({
  checked: false,
  authenticated: false,
  setupRequired: false,
  settings: { shopName: "", currency: "USD" } as Settings,
});
