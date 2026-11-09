import { Suspense } from "react";
import AppPage from "@/components/app/AppPage";
import QuoteClient from "@/components/app/QuoteClient";
import { serverConfig } from "@/lib/config";
export const metadata = { title: "Check a flight — CapFare" };
export const dynamic = "force-dynamic";
export default function Page() {
  const c = serverConfig();
  return (
    <AppPage title="Check a flight" intro="Protect one exact flight, or any flight on a route and day; one-way or return, for up to 9 travellers on one booking. The premium comes from the public formula on the blockchain.">
      <Suspense>
        <QuoteClient cfg={{ registry: c.registry, token: c.token, demo: c.demo }} />
      </Suspense>
    </AppPage>
  );
}
