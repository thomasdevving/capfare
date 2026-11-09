import type { Metadata } from "next";
import Landing from "@/components/Landing";
import { paramsOrExample } from "@/lib/params";
import { serverConfig } from "@/lib/config";
import { nl } from "@/lib/i18n/nl";

export const revalidate = 300;

export const metadata: Metadata = {
  title: nl.meta.title,
  description: nl.meta.description,
  alternates: { canonical: "/nl", languages: { en: "/", nl: "/nl" } },
};

export default async function Page() {
  const { params, live } = await paramsOrExample();
  const c = serverConfig();
  return (
    <div lang="nl">
      <Landing locale="nl" params={params} live={live} extensionUrl={c.extensionUrl ?? `${c.githubUrl}/tree/main/extension#install`} />
    </div>
  );
}
