import Link from "next/link";
import Image from "next/image";
import type { Params } from "@capfare/shared";
import { dict, type Locale } from "@/lib/i18n";
import { duration, eur } from "@/lib/format";
import HeroChart from "./HeroChart";
import LiveFigures from "./LiveFigures";
import { Footer, Header } from "./SiteChrome";
import ScrollFocus from "./ScrollFocus";
import AnchorScroll from "./AnchorScroll";

const HOW_SHOTS = ["/how/1-lock.png", "/how/2-book.png", "/how/4-verify.png"];

export default function Landing({ locale, params, live, extensionUrl }: { locale: Locale; params: Params; live: boolean; extensionUrl: string }) {
  const t = dict(locale);
  const hours = Math.max(1, Math.round(params.cap.activation_delay_secs / 3600));
  const delayText = params.cap.activation_delay_secs >= 3600 ? hours : 0;
  return (
    <div className="landing">
      <ScrollFocus />
      <AnchorScroll />
      <main id="main">
      <div className="landing-masthead">
        <Image className="landing-flight" src="/images/hero-flight-capfare.webp" alt="" fill priority sizes="100vw" />
      <div className="top-overlay">
        <Header locale={locale} />
      </div>
        <div className="hero-band">
          <section className="wrap hero" aria-labelledby="hero-title">
            <div className="hero-text">
              <h1 id="hero-title">
                <span>{t.hero.h1a}</span>
                <span>{t.hero.h1b}</span>
              </h1>
              <p className="sub">{t.hero.sub}</p>
              <div className="btn-row">
                <a className="btn btn-primary" href={extensionUrl}>
                  {t.hero.ctaChrome}
                </a>
                <Link className="btn btn-ghost" href="/quote">
                  {t.hero.ctaCheck}
                </Link>
              </div>
            </div>
            <div className="hero-figure">
              <HeroChart locale={locale} />
            </div>
        </section>
        </div>
      </div>
      <div className="landing-content">
        <div id="how" className="wrap how-title">
          <h2 id="how-title">{t.how.title}</h2>
        </div>
        {t.how.steps.map((st, i) => (
          <section key={st.n} className="wrap section feature" aria-labelledby={`how-${st.n}`}>
            <div className="glass feature-panel">
              <div className="feature-text">
                <span className="feature-n" aria-hidden="true">{st.n}</span>
                <h3 id={`how-${st.n}`}>
                  <span className="visually-hidden">{st.n}. </span>
                  {st.title}
                </h3>
                <p>{t.how.features[i].body}</p>
                <ul>
                  {t.how.features[i].points(params.cap.deductible).map((x) => (
                    <li key={x}>{x}</li>
                  ))}
                </ul>
              </div>
              <div className="feature-shot">
                <img src={HOW_SHOTS[i]} alt={t.how.shotAlt[i]} width={1260} height={944} loading="lazy" decoding="async" />
              </div>
            </div>
          </section>
        ))}
        <section id="protection" className="wrap section" aria-labelledby="prot-title">
          <div className="glass panel">
          <h2 id="prot-title">{t.products.title}</h2>
          <div className="protection-comparison">
            <article className="product">
              <p className="when">{t.products.cap.when}</p>
              <h3>{t.products.cap.name}</h3>
              <p>{t.products.cap.body}</p>
              <dl className="product-terms">
                <div><dt>{t.chart.deductible}</dt><dd>{eur(params.cap.deductible)}</dd></div>
                <div><dt>{t.chart.maxPayout}</dt><dd>{eur(params.cap.max_payout)}</dd></div>
              </dl>
              <p className="example num">{t.products.cap.example(params.cap.deductible, params.cap.max_payout)}</p>
            </article>
            <article className="product">
              <p className="when">{t.products.drop.when}</p>
              <h3>{t.products.drop.name}</h3>
              <p>{t.products.drop.body}</p>
              <dl className="product-terms">
                <div><dt>{t.chart.deductible}</dt><dd>{eur(params.drop.deductible)}</dd></div>
                <div><dt>{t.chart.maxPayout}</dt><dd>{eur(params.drop.max_payout)}</dd></div>
              </dl>
              <p className="example num">{t.products.drop.example(params.drop.deductible, params.drop.max_payout)}</p>
            </article>
          </div>
          <p className="small muted">{t.products.paramsNote(live)}</p>
          </div>
        </section>
        <section id="payout" className="wrap section" aria-labelledby="payout-title">
          <div className="glass panel">
          <h2 id="payout-title">{t.payout.title}</h2>
          <p>{t.payout.body}</p>
          <LiveFigures locale={locale} compact />
          </div>
        </section>
        <div className="wrap pair">
        <section className="section" aria-labelledby="anywhere-title">
          <div className="glass panel">
          <h2 id="anywhere-title">{t.anywhere.title}</h2>
          {t.anywhere.body.map((p) => (
            <p key={p}>{p}</p>
          ))}
          </div>
        </section>
        <section className="section" aria-labelledby="privacy-title">
          <div className="glass panel">
          <h2 id="privacy-title">{t.privacy.title}</h2>
          {t.privacy.body.filter(Boolean).map((p) => (
            <p key={p}>{p}</p>
          ))}
          <p className="small muted">{t.privacy.note}</p>
          </div>
        </section>
        </div>
        <div className="wrap pair">
        <section className="section" aria-labelledby="fine-title">
          <div className="glass panel">
          <details className="policy-details">
          <summary id="fine-title">{t.fine.title}</summary>
          <ul className="fine">
            {t.fine.items.map((it, i) => {
              const text =
                typeof it === "string"
                  ? it
                  : i === 1
                    ? (it as (h: number) => string)(delayText || hours)
                    : (it as (r: boolean) => string)(params.global.sold_out_premium_refund);
              return <li key={i}>{i === 1 && !delayText ? text.replace(/\d+ hours?/, duration(params.cap.activation_delay_secs)) : text}</li>;
            })}
          </ul>
          </details>
          </div>
        </section>
        <section className="section" aria-labelledby="lp-title">
          <div className="glass panel">
          <h2 id="lp-title">{t.lp.title}</h2>
          <p>{t.lp.body}</p>
          <p>
            <strong>{t.lp.risk}</strong>
          </p>
          <p>
            <Link href="/lp">{t.lp.link}</Link>
          </p>
          </div>
        </section>
        </div>
        <section id="faq" className="wrap section" aria-labelledby="faq-title">
          <div className="glass panel">
          <h2 id="faq-title">{t.faq.title}</h2>
          <div className="faq">
            {t.faq.items.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
          </div>
        </section>
      </div>
      </main>
      <Footer locale={locale} />
    </div>
  );
}
