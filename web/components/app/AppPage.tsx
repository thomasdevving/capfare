import { Footer, Header, TestnetStrip } from "../SiteChrome";
import TxNotice from "./TxNotice";

export default function AppPage({ title, intro, children }: { title: string; intro?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <TestnetStrip locale="en" />
      <Header locale="en" variant="app" />
      <main id="main" className="wrap page">
        <h1 style={{ fontSize: "var(--s6)" }}>{title}</h1>
        {intro ? <div className="muted" style={{ marginBottom: 24 }}>{intro}</div> : null}
        {children}
      </main>
      <TxNotice />
      <Footer locale="en" />
    </>
  );
}
