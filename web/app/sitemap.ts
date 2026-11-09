import type { MetadataRoute } from "next";
import { serverConfig } from "@/lib/config";
export default function sitemap(): MetadataRoute.Sitemap {
  const s = serverConfig().siteUrl;
  return ["", "/nl", "/quote", "/transparency", "/lp", "/legal"].map((p) => ({ url: `${s}${p}` }));
}
