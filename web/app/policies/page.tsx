import AppPage from "@/components/app/AppPage";
import PoliciesClient from "@/components/app/PoliciesClient";
import { serverConfig } from "@/lib/config";
export const metadata = { title: "My policies — CapFare" };
export const dynamic = "force-dynamic";
export default function Page() {
  const c = serverConfig();
  return (
    <AppPage title="My policies">
      <PoliciesClient registry={c.registry} demo={c.demo} />
    </AppPage>
  );
}
