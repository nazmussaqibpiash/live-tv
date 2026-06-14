import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Strip the `X-Powered-By: Next.js` header (minor info-leak + bytes).
  poweredByHeader: false,
  // Gzip/brotli compression for SSR + API responses.
  compress: true,
  // Smaller client bundles: drop console.* (except error/warn) in production.
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },
  // Tree-shake heavy icon/util packages to per-export imports.
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
  // Long-cache the immutable channel data + static assets at the edge/CDN.
  async headers() {
    return [
      {
        source: "/data/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=300, stale-while-revalidate=600",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
