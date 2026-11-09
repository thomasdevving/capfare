import AppPage from "@/components/app/AppPage";
import ClaimClient from "@/components/app/ClaimClient";
import { serverConfig } from "@/lib/config";
export const metadata = { title: "Claim — CapFare" };
export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = serverConfig();
  return (
    <AppPage title="Claim">
      <ClaimClient id={Number(id)} registry={c.registry} demo={c.demo} />
    </AppPage>
  );
}
