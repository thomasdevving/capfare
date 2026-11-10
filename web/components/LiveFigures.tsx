"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { dict, type Locale } from "@/lib/i18n";
import { clock, usdc } from "@/lib/format";

interface Lite {
  network: string;
  updatedAt: number;
  totalAssets: string;
  locked: string;
  pendingWithdrawals: string;
  activePolicies: number;
  invariantOk: boolean;
}

const KEY = "capfare.overview.lite";

export default function LiveFigures({ locale, compact = false }: { locale: Locale; compact?: boolean }) {
  const t = dict(locale).payout;
  const [data, setData] = useState<Lite | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "error">("loading");

  useEffect(() => {
    let alive = true;
    try {
      const c = localStorage.getItem(KEY);
      if (c) setData(JSON.parse(c));
    } catch {
      /* ignore */
    }
    const load = () =>
      fetch("/api/overview?lite=1")
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
        .then((j: Lite) => {
          if (!alive) return;
          setData(j);
          setStatus("ok");
          localStorage.setItem(KEY, JSON.stringify(j));
        })
        .catch(() => alive && setStatus("error"));
    load();
    const id = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const stale = data && Date.now() / 1000 - data.updatedAt > 180;
  const show = data && (status === "ok" || status === "error");

  return (
    <div>
      {show ? (
        <table className="live-table">
          <caption className="visually-hidden">{t.title}</caption>
          <tbody>
            <tr>
              <th scope="row">{t.rows.assets}{!compact && <span className="net">{data!.network} · tUSDC</span>}</th>
              <td className="v">{usdc(data!.totalAssets, 0)}</td>
            </tr>
            <tr>
              <th scope="row">{t.rows.locked}{!compact && <span className="net">{data!.network}</span>}</th>
              <td className="v">{usdc(data!.locked, 0)}</td>
            </tr>
            <tr>
              <th scope="row">{t.rows.active}{!compact && <span className="net">{data!.network}</span>}</th>
              <td className="v">{data!.activePolicies}</td>
            </tr>
            <tr>
              <th scope="row">
                {t.rows.solvency}
                {!compact && <span className="net">{t.solvencyDetail} · {data!.network}</span>}
              </th>
              <td className={`v ${data!.invariantOk ? "pass" : "fail"}`}>{data!.invariantOk ? t.passed : t.failed}</td>
            </tr>
          </tbody>
        </table>
      ) : null}
      <p className={`status-line ${status === "error" ? "error" : ""}`} role="status">
        {status === "loading" && !data ? t.loading : null}
        {status === "error" ? t.error(data ? clock(data.updatedAt) : null) : null}
        {status === "ok" && data ? (stale ? t.stale(clock(data.updatedAt)) : `${t.updated(clock(data.updatedAt))}. ${t.sumNote}`) : null}
      </p>
      <p>
        <Link href="/transparency">{t.link}</Link>
      </p>
    </div>
  );
}
