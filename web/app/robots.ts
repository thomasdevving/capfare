import type { MetadataRoute } from "next";
import { serverConfig } from "@/lib/config";
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/booker", "/verify"] }], sitemap: `${serverConfig().siteUrl}/sitemap.xml` };
}
