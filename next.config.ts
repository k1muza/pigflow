import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  /**
   * Browser-side simulation caches are only valid for the model build that
   * produced them. Vercel gives every deployment its git SHA; local development
   * deliberately shares one "dev" namespace until the dev server is restarted.
   */
  env: {
    NEXT_PUBLIC_PIGFLOW_BUILD_ID:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GITHUB_SHA ??
      "dev",
  },
};

export default nextConfig;
