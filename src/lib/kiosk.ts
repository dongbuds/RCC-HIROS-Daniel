// ═══════════════════════════════════════════════════════════════
// RCC-HIROS — ZK kiosk service address (server side)
//
// The Python bridge binds to loopback only, so the correct address
// depends on where the app runs:
//   - dev / app on the kiosk PC     : http://127.0.0.1:8765
//   - app in Docker on that PC      : http://host.docker.internal:8765
//
// KIOSK_SERVICE_URL is runtime-only and never reaches the browser
// bundle; NEXT_PUBLIC_KIOSK_SERVICE_URL stays the browser-side address
// used by the kiosk UI.
// ═══════════════════════════════════════════════════════════════

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export const KIOSK_SERVICE_URL = stripTrailingSlash(
  process.env.KIOSK_SERVICE_URL ||
    process.env.NEXT_PUBLIC_KIOSK_SERVICE_URL ||
    "http://127.0.0.1:8765"
);
