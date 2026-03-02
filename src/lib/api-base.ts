/**
 * API Base URL Configuration
 *
 * - Next.js dev mode (pnpm dev): "" (same-origin, API routes at /api/*)
 * - Standalone server (flow2code dev): "http://localhost:3100"
 * - Can be overridden via NEXT_PUBLIC_API_URL environment variable
 */
export function getApiBase(): string {
  // Environment variable takes priority
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }

  // Browser: detect whether accessed via Next.js dev server or static export
  if (typeof window !== "undefined") {
    // If page is from standalone server (port 3100), use same-origin
    // If page is from Next.js dev (port 3000), also use same-origin (API routes still exist)
    return "";
  }

  return "";
}
