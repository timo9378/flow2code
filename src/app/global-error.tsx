"use client";

/**
 * Next.js App Router Global Error Boundary
 *
 * Catches fatal errors at the layout.tsx level, preventing a blank screen.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="antialiased bg-neutral-950 text-white flex items-center justify-center min-h-screen">
        <div className="max-w-md text-center space-y-4 p-8">
          <h1 className="text-2xl font-bold text-red-400">⚠️ An unexpected error occurred</h1>
          <p className="text-sm text-neutral-400">
            {error.message || "The application encountered an unknown error"}
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
            Retry
          </button>
        </div>
      </body>
    </html>
  );
}
