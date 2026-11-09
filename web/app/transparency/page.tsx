import AppPage from "@/components/app/AppPage";
import TransparencyClient from "@/components/app/TransparencyClient";
export const metadata = { title: "Transparency — CapFare" };
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <AppPage title="Transparency" intro="Every number here is read live from the contracts. Nothing is hand-entered.">
      <TransparencyClient />
    </AppPage>
  );
}
