import type { NextConfig } from "next";

const isHostingerBuild = process.env.HOSTINGER_BUILD === "1";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typescript: {
    tsconfigPath: isHostingerBuild ? "./tsconfig.hostinger.json" : "./tsconfig.json",
  },
};

export default nextConfig;
