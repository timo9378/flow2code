/**
 * API Base URL 配置
 *
 * - Next.js dev mode (pnpm dev): "" (same-origin, API routes 在 /api/*)
 * - Standalone server (flow2code dev): "http://localhost:3100"
 * - 可透過 NEXT_PUBLIC_API_URL 環境變數覆寫
 */
export function getApiBase(): string {
  // 環境變數優先
  if (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, "");
  }

  // Browser 端：偵測是否透過 Next.js dev server 或靜態匯出存取
  if (typeof window !== "undefined") {
    // 如果頁面來自 standalone server (port 3100)，用同源
    // 如果頁面來自 Next.js dev (port 3000)，也用同源 (API routes 仍存在)
    return "";
  }

  return "";
}
