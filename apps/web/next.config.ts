import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@sovereign/db", "@sovereign/shared"],
  turbopack: {
    root: path.join(__dirname, "../..")
  }
};

export default nextConfig;