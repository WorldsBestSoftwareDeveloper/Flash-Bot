import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["flash-v2"],
  outputFileTracingRoot: process.cwd(),
};

export default nextConfig;
