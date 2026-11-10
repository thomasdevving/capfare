import Landing from "@/components/Landing";
import { paramsOrExample } from "@/lib/params";
import { serverConfig } from "@/lib/config";

export const revalidate = 300;

export default async function Page() {
  const { params, live } = await paramsOrExample();
  const c = serverConfig();
  return <Landing locale="en" params={params} live={live} extensionUrl={c.extensionUrl ?? "/extension"} />;
}
