import AppPage from "@/components/app/AppPage";
import VerifyClient from "@/components/app/VerifyClient";
import { serverConfig } from "@/lib/config";
export const metadata = { title: "Verify a booking — CapFare" };
export const dynamic = "force-dynamic";
export default function Page() {
  return (
    <AppPage title="Verify your booking" intro="A live check of your booking, straight from the booking site.">
      <VerifyClient registry={serverConfig().registry} />
    </AppPage>
  );
}
