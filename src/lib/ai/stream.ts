/**
 * AI Streaming Utilities
 *
 * Handles SSE (Server-Sent Events) streaming for OpenAI-compatible APIs.
 * Supports real-time token-by-token responses for progressive UI rendering.
 */

// ============================================================
// Types
// ============================================================

export interface StreamCallbacks {
  /** Fired for each received token */
  onToken: (token: string) => void;
  /** Fired when streaming completes (returns full content) */
  onComplete: (fullContent: string) => void;
  /** Fired on error */
  onError: (error: Error) => void;
}

export interface StreamRequestOptions {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** AbortController signal for cancellation */
  signal?: AbortSignal;
}

// ============================================================
// SSE Stream Parser
// ============================================================

/**
 * Send a streaming request and return results token by token.
 * Compatible with OpenAI / Copilot API / Ollama SSE formats.
 */
export async function streamChatCompletion(
  options: StreamRequestOptions,
  callbacks: StreamCallbacks
): Promise<void> {
  try {
    const { url, headers, body, signal } = options;

    // Force streaming mode
    const streamBody = { ...body, stream: true };

    // Prevent requests from hanging indefinitely (e.g., CORS plugin issues) with a 60s header timeout
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(new Error("Connection timeout (60s)")), 60000);

    // Combine user signal (cancel button) with timeout signal
    let combinedSignal = timeoutController.signal;
    if (signal) {
      combinedSignal = AbortSignal.any([signal, timeoutController.signal]);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(streamBody),
        signal: combinedSignal,
      });
    } finally {
      clearTimeout(timeoutId); // Clear timeout after receiving header or on error
    }

    if (!response.ok) {
      const errText = await response.text();
      callbacks.onError(new Error(`AI API error (${response.status}): ${errText}`));
      return;
    }

    if (!response.body) {
      callbacks.onError(new Error("Response has no readable stream (response.body is null)"));
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let fullContent = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE format: each line starts with "data: "
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? ""; // Keep last line (may be incomplete)

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(":")) continue; // Empty line or comment
          if (trimmed === "data: [DONE]") continue; // OpenAI end marker

          if (trimmed.startsWith("data: ")) {
            const jsonStr = trimmed.slice(6);
            try {
              const parsed = JSON.parse(jsonStr);
              const delta = parsed.choices?.[0]?.delta?.content;
              if (delta) {
                fullContent += delta;
                callbacks.onToken(delta);
              }
            } catch {
              // Incomplete JSON, skip
            }
          }
        }
      }

      callbacks.onComplete(fullContent);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        callbacks.onComplete(fullContent); // Return received content on cancel
      } else {
        callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      callbacks.onComplete(""); // Return empty string on cancel
    } else {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}


// ============================================================
// Token Budget Estimation
// ============================================================

/**
 * Rough estimation of token count for text.
 * Uses GPT-4 average ratios: ~4 chars = 1 token (English),
 * ~1.5 chars = 1 token (CJK characters).
 */
export function estimateTokenCount(text: string): number {
  let tokens = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(char)) {
      tokens += 0.67; // CJK: ~1.5 chars = 1 token
    } else {
      tokens += 0.25; // English: ~4 chars = 1 token
    }
  }
  return Math.ceil(tokens);
}

/**
 * Check if prompt exceeds the token budget
 */
export function checkTokenBudget(
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number = 8000
): { withinBudget: boolean; estimated: number; limit: number } {
  const estimated = estimateTokenCount(systemPrompt) + estimateTokenCount(userPrompt);
  return {
    withinBudget: estimated <= maxTokens,
    estimated,
    limit: maxTokens,
  };
}

// ============================================================
// Retry with Exponential Backoff
// ============================================================

export interface RetryOptions {
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in ms (default: 1000) */
  initialDelay?: number;
  /** Backoff multiplier (default: 2) */
  backoffMultiplier?: number;
  /** Abort signal */
  signal?: AbortSignal;
  /** Callback on each retry */
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * Automatic retry with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    backoffMultiplier = 2,
    signal,
    onRetry,
  } = options;

  let lastError: Error | undefined;
  let delay = initialDelay;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (signal?.aborted) throw new Error("Cancelled");
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxRetries) break;

      // Don't retry user cancellation
      if (lastError.name === "AbortError" || signal?.aborted) break;

      // Don't retry validation errors (4xx)
      if (lastError.message.includes("(4")) break;

      onRetry?.(attempt + 1, lastError);

      // Exponential backoff wait
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= backoffMultiplier;
    }
  }

  throw lastError ?? new Error("Max retries exhausted");
}
