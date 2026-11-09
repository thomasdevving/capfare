import AppPage from "@/components/app/AppPage";
import ConfirmClient from "./ConfirmClient";
export const metadata = { title: "Confirm alerts — CapFare", robots: { index: false } };
export default function Page() {
  return (
    <AppPage title="Email alerts" intro="Confirming your address for CapFare alerts.">
      <ConfirmClient />
    </AppPage>
  );
}
