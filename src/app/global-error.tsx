"use client";

/**
 * Next.js App Router 全域錯誤邊界
 *
 * 捕獲 layout.tsx 層級的致命錯誤，防止白屏。
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="zh-TW">
      <body className="antialiased bg-neutral-950 text-white flex items-center justify-center min-h-screen">
        <div className="max-w-md text-center space-y-4 p-8">
          <h1 className="text-2xl font-bold text-red-400">⚠️ 發生未預期的錯誤</h1>
          <p className="text-sm text-neutral-400">
            {error.message || "應用程式發生了未知錯誤"}
          </p>
          {error.digest && (
            <p className="text-xs text-neutral-500 font-mono">
              Error digest: {error.digest}
            </p>
          )}
          <button
            onClick={reset}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-500 rounded-md text-sm font-medium transition-colors"
          >
            重新嘗試
          </button>
        </div>
      </body>
    </html>
  );
}
