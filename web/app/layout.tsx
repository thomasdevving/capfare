import type { Metadata, Viewport } from "next";
import "./globals.css";
import Sky from "@/components/Sky";
import { explorerUrl, serverConfig } from "@/lib/config";

const site = serverConfig().siteUrl;

export const metadata: Metadata = {
  metadataBase: new URL(site),
  title: "CapFare — lock the price of your flight",
  description: "Lock a maximum price on one specific flight, book anywhere, and get the difference back. Testnet prototype on NEAR.",
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "CapFare", title: "Lock the price of your flight. Book wherever you want.", description: "If the price goes up before you book, you get the difference back." },
  twitter: { card: "summary_large_image", title: "CapFare — lock the price of your flight", description: "If the price goes up before you book, you get the difference back." },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#121519" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The explorer base is read by client components (lib/explorer.ts) to link transactions and accounts.
    <html lang="en" data-explorer={explorerUrl(serverConfig().network)}>
      <body>
        <Sky />
        {children}
      </body>
    </html>
  );
}
