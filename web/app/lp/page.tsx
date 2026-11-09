import AppPage from "@/components/app/AppPage";
import LpClient from "@/components/app/LpClient";
export const metadata = { title: "LP dashboard — CapFare" };
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <AppPage title="Liquidity providers" intro="Two independent vaults. Premiums in, payouts out, weekly epochs, every policy fully collateralised.">
      <LpClient />
    </AppPage>
  );
}
