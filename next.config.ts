import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  return {
    // Turbopack dev and Webpack production builds use incompatible RSC
    // bindings. Separate their output so running `npm run build` cannot
    // corrupt a live development server.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
  };
}
