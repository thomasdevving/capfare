import AppPage from "@/components/app/AppPage";
import AccountClient from "@/components/app/AccountClient";
export const metadata = { title: "Account — CapFare" };
export default function Page() {
  return (
    <AppPage title="Your account" intro="A readable account name protected by a passkey. No seed phrase, no crypto wallet needed.">
      <AccountClient />
    </AppPage>
  );
}
