import { en, type Dict } from "./en";

export type Locale = "en";
export const dicts: Record<Locale, Dict> = { en };
export function dict(l: Locale): Dict {
  return dicts[l] ?? en;
}
export type { Dict };
