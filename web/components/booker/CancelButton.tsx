"use client";
import { useState } from "react";

export default function CancelButton({ ref_, token, refundable }: { ref_: string; token: string; refundable: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="sk-btn danger"
      disabled={busy}
      onClick={async () => {
        if (!confirm(refundable ? "Cancel this booking? The fare will be refunded (demo)." : "Cancel this booking? This ticket is non-refundable.")) return;
        setBusy(true);
        await fetch("/api/booker/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ref: ref_, token }) });
        location.reload();
      }}
    >
      Cancel booking
    </button>
  );
}
