import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@capfare/shared"],
  output: "standalone",
  poweredByHeader: false,
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default config;
