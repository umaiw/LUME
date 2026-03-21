import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Proxy that generates a per-request CSP nonce and sets
 * Content-Security-Policy + other security headers on every response.
 *
 * Next.js App Router reads the nonce from the `x-nonce` request header
 * and automatically injects it into its own inline scripts.
 */
export function proxy(request: NextRequest): NextResponse {
  // Generate a random nonce (128-bit, base64-encoded)
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64");

  // Clone request headers and attach the nonce so Server Components can read it
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  // Allow API/WS connections to the backend origin (may differ in port during dev)
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:3001/ws";
  const apiOrigin = new URL(apiUrl).origin;
  const wsOrigin = new URL(wsUrl).origin.replace(/^http/, "ws");

  // Build CSP directives
  const cspDirectives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "style-src 'self' 'unsafe-inline'", // Tailwind needs inline styles
    `connect-src 'self' ${apiOrigin} ${wsOrigin} ws: wss:`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ];

  const cspValue = cspDirectives.join("; ");

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  // Set CSP header
  response.headers.set("Content-Security-Policy", cspValue);

  // Additional security headers (supplement what next.config.ts sets)
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("X-DNS-Prefetch-Control", "off");
  response.headers.set("Cross-Origin-Opener-Policy", "same-origin");

  return response;
}

/**
 * Apply proxy to all page routes (skip static assets and Next.js internals).
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|lume-icon\\.png).*)"],
};
