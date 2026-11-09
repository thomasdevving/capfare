import { BookerShell } from "@/components/booker/Shell";
import Inbox from "@/components/booker/Inbox";
export const dynamic = "force-dynamic";
export const metadata = { title: "Skyline Travel (demo) — inbox", robots: { index: false } };
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const q = await searchParams;
  return (
    <BookerShell tab="inbox">
      <div className="sk-wrap sk-section"><Inbox initial={q.email ?? ""} /></div>
    </BookerShell>
  );
}
