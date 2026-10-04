import type { AccessoryKind } from "./types.js";

/** The answer that leaves an accessory exactly as it is. */
export const NO_CHANGE = "no_change";

/** The levels each kind of accessory can be set to. The first is its resting level. */
export const LEVELS: Record<AccessoryKind, Record<string, string>> = {
  light: {
    off: "The light is off",
    soft: "Dim, gentle lighting (30%)",
    standard: "Normal everyday lighting (60%)",
    full: "Maximum brightness (100%)",
  },
  blinds: {
    closed: "The blinds are closed",
    open: "The blinds are open",
  },
};

export function restingLevel(kind: AccessoryKind): string {
  return Object.keys(LEVELS[kind])[0] as string;
}
