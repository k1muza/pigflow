import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // glpk.js resolves glpk.wasm relative to its CommonJS module at runtime.
  // Keep the package external so Next does not move the JavaScript away from
  // the adjacent WASM file, and make the runtime asset part of this route's
  // deployment trace.
  serverExternalPackages: ["glpk.js"],
  outputFileTracingIncludes: {
    "/api/feed-formulation/optimize": [
      "./node_modules/glpk.js/dist/glpk.wasm",
    ],
  },
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
