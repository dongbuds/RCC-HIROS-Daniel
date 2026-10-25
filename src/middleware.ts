// ═══════════════════════════════════════════════════════════════
// RCC-HIROS — Next.js Middleware
// Responsibilities:
//   1. HTTPS redirect in production
//   2. Security headers on all responses
//   3. Public path passthrough (auth enforced at API level)
// ═══════════════════════════════════════════════════════════════

import { NextRequest, NextResponse } from "next/server";

export const PUBLIC_PATHS = ["/login", "/api/auth/login"];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const host = request.headers.get("host") ?? "";
  const isLoopback = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);

  // ── 1. HTTPS redirect (production only) ──
  // Skipped for loopback so container health checks and local smoke tests
  // against http://127.0.0.1:3000 keep working. Public traffic arrives through
  // Cloudflare with x-forwarded-proto: https.
  if (process.env.NODE_ENV === "production" && !isLoopback) {
    const proto = request.headers.get("x-forwarded-proto");
    if (proto && proto !== "https") {
      return NextResponse.redirect(
        `https://${request.headers.get("host")}${pathname}${search}`,
        301
      );
    }
  }

  // ── 2. Build response with security headers ──
  const response = NextResponse.next();

  // HSTS — enforce HTTPS for 1 year, include subdomains, preload
  response.headers.set(
    "strict-transport-security",
    "max-age=31536000; includeSubDomains; preload"
  );
  // Prevent MIME-type sniffing
  response.headers.set("x-content-type-options", "nosniff");
  // Prevent clickjacking
  response.headers.set("x-frame-options", "DENY");
  // Disable the referrer header for cross-origin requests
  response.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  // XSS protection (legacy browsers)
  response.headers.set("x-xss-protection", "1; mode=block");

  // ── 3. Public paths pass through ──
  // Auth is enforced by API routes (requireAuth/requirePermission)
  // and by AuthProvider on the client side.

  return response;
}

export const config = {
  // Run on every route except Next.js internals & static assets.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
