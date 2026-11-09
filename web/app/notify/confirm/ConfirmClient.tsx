"use client";
import { useEffect, useState } from "react";
import { errText, getJson, Msg } from "@/components/app/ui";

export default function ConfirmClient() {
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const token = new URLSearchParams(location.search).get("token") ?? "";
    getJson(`/api/notify/confirm?token=${encodeURIComponent(token)}`)
      .then(() => setState({ ok: true, text: "Your email address is confirmed. You'll get an email when something needs your attention." }))
      .catch((e) => setState({ ok: false, text: errText(e) }));
  }, []);
  if (!state) return <p>Confirming…</p>;
  return (
    <>
      <Msg kind={state.ok ? "ok" : "error"}>{state.text}</Msg>
      <p><a href="/policies">Go to your policies</a></p>
    </>
  );
}
