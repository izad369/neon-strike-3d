import type { NextConfig } from "next";

// STATIC_EXPORT=1 next build  ->  exports a fully static site to ./out
// (for Cloudflare Pages / any static host). Normal dev/build stays unchanged.
const nextConfig: NextConfig = {
  ...(process.env.STATIC_EXPORT
    ? { output: "export" as const, images: { unoptimized: true } }
    : { output: "standalone" as const }),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
