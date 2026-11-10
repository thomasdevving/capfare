import { existsSync } from "node:fs";
import { join } from "node:path";
import AppPage from "@/components/app/AppPage";
import { serverConfig } from "@/lib/config";

export const metadata = { title: "Get the extension — CapFare" };
export const dynamic = "force-dynamic";

/** Install steps for the Chrome extension, with a ready build when the deployment ships one. */
export default function Page() {
  const c = serverConfig();
  // The hosted demo's image packs a build for this deployment (deploy/Dockerfile).
  const zip = existsSync(join(process.cwd(), "public", "capfare-extension.zip"));
  const skyline = c.skylineUrl ? `${c.skylineUrl}/booker` : "/booker";
  return (
    <AppPage title="Get the extension" intro="The CapFare extension for Chrome (and other Chromium browsers) reads the flight on a booking page and shows what it costs to lock a maximum price. Testnet prototype: no real money.">
      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>Install</h2>
        <ol className="fine">
          {zip ? (
            <li>
              <a className="btn btn-primary" href="/capfare-extension.zip" download>
                Download the extension (.zip)
              </a>{" "}
              and unzip it. This build talks to this CapFare demo{c.skylineUrl ? " and checks the demo booking site automatically" : ""}.
            </li>
          ) : (
            <li>
              Build it from the repository: <code>CAPFARE_APP_URL={c.siteUrl} pnpm --filter @capfare/extension build</code> (the result is in <code>extension/build</code>).
            </li>
          )}
          <li>
            Open <code>chrome://extensions</code> and switch on <strong>Developer mode</strong> (top right).
          </li>
          <li>
            Press <strong>Load unpacked</strong> and choose the <code>{zip ? "capfare-extension" : "extension/build"}</code> folder.
          </li>
          <li>Pin CapFare from the puzzle-piece menu so its icon stays in the toolbar.</li>
        </ol>
      </section>
      <section className="card">
        <h2 style={{ fontSize: "var(--s4)" }}>Try it</h2>
        <p>
          <a className="btn btn-primary" href={skyline}>
            Open Skyline Travel, the demo booking site
          </a>
        </p>
        <ul className="fine">
          <li>Search a flight (for example Amsterdam to Barcelona): CapFare offers a Price Cap on the results.</li>
          <li>Book with any test card number such as 4242 4242 4242 4242. Nothing is charged; the confirmation email lands in the site&apos;s demo inbox.</li>
          <li>On the confirmation page CapFare offers a Drop Guarantee; on the manage-booking page, <strong>Verify with CapFare</strong> checks the booking for a claim.</li>
          <li>On any other site, press the CapFare icon and <strong>Check this page</strong>, or switch on automatic checks there. On testnet, prices come from the demo price source, so offers appear for demo routes.</li>
        </ul>
        <p className="muted">
          No extension? <a href="/quote">Check a flight</a> in the web app, or paste a link from any booking site there.
        </p>
      </section>
    </AppPage>
  );
}
