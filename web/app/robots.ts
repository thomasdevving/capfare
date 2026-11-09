import type { MetadataRoute } from "next";
import { serverConfig } from "@/lib/config";
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/demo-airline"] }], sitemap: `${serverConfig().siteUrl}/sitemap.xml` };
}
