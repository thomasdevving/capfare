import Link from "next/link";
import { Logo } from "./Logo";
import { dict, type Locale } from "@/lib/i18n";
import { networkLabel, serverConfig } from "@/lib/config";

export function Header({ locale, variant = "landing" }: { locale: Locale; variant?: "landing" | "app" }) {
  const t = dict(locale);
  const net = networkLabel(serverConfig().network);
  return (
    <header className={`site-header${variant === "app" ? "" : " on-dark"}`}>
      <div className="wrap">
        <Link href="/" className="brand" aria-label="CapFare home">
          <Logo size={26} inverse={variant !== "app"} />
        </Link>
        <nav className="nav" aria-label="Main">
          {variant === "landing" ? (
            <>
              <a className="anchor" href="#how">{t.nav.how}</a>
              <a className="anchor" href="#protection">{t.nav.protection}</a>
              <a className="anchor" href="#payout">{t.nav.payout}</a>
              <a className="anchor" href="#faq">{t.nav.faq}</a>
              <Link className="lp-nav" href="/lp">LP providers</Link>
            </>
          ) : (
            <>
              <Link href="/quote">Quote</Link>
              <Link href="/policies">Policies</Link>
              <Link href="/credit">Credit</Link>
              <Link href="/lp">LP</Link>
              <Link href="/transparency">Transparency</Link>
              <Link href="/account">Account</Link>
            </>
          )}
          {variant === "app" ? <span className="netbadge">{t.app.network(net)}</span> : null}
          {variant === "landing" ? (
            <a className="btn btn-primary btn-sm" href={serverConfig().extensionUrl ?? `${serverConfig().githubUrl}/tree/main/extension#install`}>
              {t.hero.ctaChrome}
            </a>
          ) : null}
        </nav>
      </div>
    </header>
  );
}

export function Footer({ locale }: { locale: Locale }) {
  const t = dict(locale);
  const c = serverConfig();
  return (
    <footer className="site-footer">
      <div className="wrap"><div className="glass inner">
        <p>
          <strong>{t.footer.testnet}</strong> {t.footer.notInsurance}
        </p>
        <div className="links">
          <a href={c.githubUrl}>{t.footer.links.github}</a>
          <a href={`${c.githubUrl}/tree/main/docs`}>{t.footer.links.docs}</a>
          <Link href="/transparency">{t.footer.links.transparency}</Link>
          <Link href="/lp">{t.footer.links.lp}</Link>
          {c.xUrl ? <a href={c.xUrl}>{t.footer.links.x}</a> : null}
          <Link href="/legal">{t.footer.links.legal}</Link>
        </div>
      </div></div>
    </footer>
  );
}
