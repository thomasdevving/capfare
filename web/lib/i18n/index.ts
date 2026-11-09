import { en, type Dict } from "./en";
import { nl } from "./nl";

export type Locale = "en" | "nl";
export const dicts: Record<Locale, Dict> = { en, nl };
export function dict(l: Locale): Dict {
  return dicts[l] ?? en;
}
export type { Dict };
