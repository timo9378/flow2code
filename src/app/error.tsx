"use client";

/**
 * Next.js App Router Page-level Error Boundary
 *
 * Catches page rendering errors while keeping the layout and navbar displayed normally.
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
        <h2 className="text-xl font-bold text-red-400">⚠️ Canvas failed to load</h2>
        <p className="text-sm text-muted-foreground">
          {error.message || "An unknown error occurred during rendering"}
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
          Retry
        </button>
      </div>
    </div>
  );
}
