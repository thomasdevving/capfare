import type { MetadataRoute } from "next";

/**
 * Installable web app. On Android (and other platforms with Web Share Target), "Share" on a
 * flight in any booking app or browser offers CapFare, which opens Check a flight with the
 * link already read (QuoteClient reads ?link= / ?text=).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "CapFare",
    short_name: "CapFare",
    description: "Lock a maximum price on the flight you want, or get paid if it gets cheaper after you book.",
    start_url: "/quote",
    display: "standalone",
    background_color: "#0b2447",
    theme_color: "#0b2447",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
    share_target: { action: "/quote", method: "GET", params: { title: "title", text: "text", url: "link" } },
  };
}
