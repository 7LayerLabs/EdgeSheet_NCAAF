import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
  outputFileTracingIncludes: { "/**": ["./data/generated/**"] },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "cdn.collegefootballdata.com" }],
  },
};

export default nextConfig;
