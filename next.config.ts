import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";

export default function nextConfig(phase: string): NextConfig {
  return {
    // Turbopack dev and Webpack production builds use incompatible RSC
    // bindings. Separate their output so running `npm run build` cannot
    // corrupt a live development server.
    distDir: phase === PHASE_DEVELOPMENT_SERVER ? ".next-dev" : ".next",
    // Why: 前端用相对路径请求 /api/* 和 /ws/*，但 Next.js dev server 在 3000、
    // 后端在 8000，没有 proxy 时所有请求都会 404（关闭终端、创建终端、审批横幅都受影响）。
    // 加 proxy 后相对路径自动转发到后端，不需要逐个改组件拼完整 URL。
    async rewrites() {
      if (phase !== PHASE_DEVELOPMENT_SERVER) return [];
      return [
        {
          source: "/api/:path*",
          destination: "http://localhost:8000/api/:path*",
        },
        {
          source: "/ws/:path*",
          destination: "http://localhost:8000/ws/:path*",
        },
      ];
    },
  };
}
