/**
 * Search state of Skyline Travel (demo) carried in the URL:
 *   from, to, date, pax           the search
 *   ret                           return date (return trips)
 *   leg=2, o, of                  choosing the return flight; o/of = chosen outbound flight and fare
 */
export interface Trip {
  from: string;
  to: string;
  date: string;
  pax: number;
  ret?: string;
  leg: 1 | 2;
  o?: string;
  of?: string;
}

export function tripOf(q: Record<string, string | undefined>): Trip {
  const ret = q.ret && /^\d{4}-\d{2}-\d{2}$/.test(q.ret) ? q.ret : undefined;
  return {
    from: q.from ?? "AMS",
    to: q.to ?? "BCN",
    date: q.date ?? "2027-06-14",
    pax: Math.min(4, Math.max(1, Number(q.pax ?? 1) || 1)),
    ret,
    leg: ret && q.leg === "2" && q.o && q.of ? 2 : 1,
    o: q.o,
    of: q.of,
  };
}

/** The flight being chosen on this step: route and date. */
export function legOf(t: Trip): { from: string; to: string; date: string } {
  return t.leg === 2 ? { from: t.to, to: t.from, date: t.ret! } : { from: t.from, to: t.to, date: t.date };
}

export function tripQuery(t: Trip, extra: Record<string, string> = {}): string {
  const q: Record<string, string> = { from: t.from, to: t.to, date: t.date, pax: String(t.pax) };
  if (t.ret) q.ret = t.ret;
  if (t.leg === 2) Object.assign(q, { leg: "2", o: t.o!, of: t.of! });
  return new URLSearchParams({ ...q, ...extra }).toString();
}
