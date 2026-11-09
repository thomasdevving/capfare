import AppPage from "@/components/app/AppPage";
import CreditClient from "@/components/app/CreditClient";
import { serverConfig } from "@/lib/config";
export const metadata = { title: "Credit — CapFare" };
export const dynamic = "force-dynamic";
export default function Page() {
  const c = serverConfig();
  return (
    <AppPage title="Credit and payouts">
      <CreditClient registry={c.registry} token={c.token} tokenIsMock={c.demo} />
    </AppPage>
  );
}
