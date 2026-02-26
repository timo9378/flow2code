"use client";

/**
 * Next.js App Router 頁面級錯誤邊界
 *
 * 捕獲頁面渲染錯誤，保留 layout 和 navbar 正常顯示。
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-background">
      <div className="max-w-md text-center space-y-4 p-8">
        <h2 className="text-xl font-bold text-red-400">⚠️ 畫布載入失敗</h2>
        <p className="text-sm text-muted-foreground">
          {error.message || "渲染過程中發生了未知錯誤"}
        </p>
        {error.digest && (
          <p className="text-xs text-neutral-500 font-mono">
            Error digest: {error.digest}
          </p>
        )}
        <button
          onClick={reset}
          className="px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-md text-sm font-medium transition-colors"
        >
          重新嘗試
        </button>
      </div>
    </div>
  );
}
