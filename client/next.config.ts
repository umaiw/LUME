import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
    resolveAlias: {
      '@noble/hashes/hmac': '@noble/hashes/hmac.js',
      '@noble/hashes/sha256': '@noble/hashes/sha2.js',
      '@noble/hashes/hkdf': '@noble/hashes/hkdf.js',
    },
  },

  // Suppress React DevTools warning in production
  reactStrictMode: true,

  // Disable x-powered-by header
  poweredByHeader: false,

  // Security headers
  headers: async () => [
    {
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      ],
    },
  ],
};

export default nextConfig;
