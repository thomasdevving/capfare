"use client";
import type { Alert } from "@capfare/shared";

/** In-app alerts (same engine as push and email alerts). */
export function AlertList({ alerts }: { alerts: Alert[] }) {
  return (
    <ul className="alerts">
      {alerts.map((a) => (
        <li key={a.id} className={`alert ${a.urgency}`}>
          <div>
            <h3>{a.title}</h3>
            <p>{a.body}</p>
          </div>
          <a className={`btn btn-sm ${a.urgency === "info" ? "" : "btn-primary"}`} href={a.href}>{a.action}</a>
        </li>
      ))}
    </ul>
  );
}
