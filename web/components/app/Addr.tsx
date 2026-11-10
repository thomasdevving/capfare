"use client";
import { useEffect, useState } from "react";
import { accountUrl } from "@/lib/explorer";

/** A NEAR account or contract id, linked to the block explorer on public networks. */
/** `linkOnly`: render nothing without an explorer (for "see it on the explorer" links). */
export default function Addr({ id, children, linkOnly = false }: { id: string; children?: React.ReactNode; linkOnly?: boolean }) {
  const [href, setHref] = useState<string | undefined>();
  useEffect(() => setHref(accountUrl(id)), [id]);
  const label = children ?? <span className="mono-wrap">{id}</span>;
  if (!href) return linkOnly ? null : <>{label}</>;
  return <a href={href} target="_blank" rel="noopener" title={`${id} on NearBlocks`}>{label}</a>;
}
