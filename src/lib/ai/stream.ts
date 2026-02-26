/**
 * AI Streaming Utilities
 *
 * 處理 OpenAI 相容 API 的 SSE (Server-Sent Events) 串流。
 * 支援即時 token-by-token 回傳，讓 UI 可以逐步顯示生成進度。
 */

// ============================================================
// Types
// ============================================================

export interface StreamCallbacks {
  /** 每收到一個 token 時觸發 */
  onToken: (token: string) => void;
  /** 串流完成時觸發（回傳完整內容） */
  onComplete: (fullContent: string) => void;
  /** 發生錯誤時觸發 */
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
 * 發送串流請求並逐 token 回傳結果。
 * 相容 OpenAI / Copilot API / Ollama 的 SSE 格式。
 */
export async function streamChatCompletion(
  options: StreamRequestOptions,
  callbacks: StreamCallbacks
): Promise<void> {
  const { url, headers, body, signal } = options;

  // 強制啟用串流模式
  const streamBody = { ...body, stream: true };

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(streamBody),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    callbacks.onError(new Error(`AI API 錯誤 (${response.status}): ${errText}`));
    return;
  }

  if (!response.body) {
    callbacks.onError(new Error("回應沒有可讀串流 (response.body is null)"));
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

      // 解析 SSE 格式：每行以 "data: " 開頭
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? ""; // 保留最後一行（可能不完整）

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue; // 空行或註解
        if (trimmed === "data: [DONE]") continue; // OpenAI 結束標記

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
            // 不完整的 JSON，跳過
          }
        }
      }
    }

    callbacks.onComplete(fullContent);
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      callbacks.onComplete(fullContent); // 取消時仍回傳已收到的內容
    } else {
      callbacks.onError(err instanceof Error ? err : new Error(String(err)));
    }
  }
}

// ============================================================
// Token Budget Estimation
// ============================================================

/**
 * 粗略估算文字的 token 數量。
 * 使用 GPT-4 的平均比例：約 4 字元 = 1 token（英文），
 * 中文約 1.5 字 = 1 token。
 */
export function estimateTokenCount(text: string): number {
  // 拆分中英文
  let tokens = 0;
  for (const char of text) {
    if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(char)) {
      tokens += 0.67; // 中文字約 1.5 字 = 1 token
    } else {
      tokens += 0.25; // 英文約 4 字 = 1 token
    }
  }
  return Math.ceil(tokens);
}

/**
 * 檢查 prompt 是否超過 token 預算
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
  /** 最大重試次數（預設 3） */
  maxRetries?: number;
  /** 初始等待時間（ms，預設 1000） */
  initialDelay?: number;
  /** 等待時間倍數（預設 2） */
  backoffMultiplier?: number;
  /** 中斷信號 */
  signal?: AbortSignal;
  /** 每次重試時的回呼 */
  onRetry?: (attempt: number, error: Error) => void;
}

/**
 * 帶指數退避的自動重試機制
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
      if (signal?.aborted) throw new Error("已取消");
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt === maxRetries) break;

      // 不重試使用者取消
      if (lastError.name === "AbortError" || signal?.aborted) break;

      // 不重試驗證失敗（4xx）
      if (lastError.message.includes("(4")) break;

      onRetry?.(attempt + 1, lastError);

      // 指數退避等待
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= backoffMultiplier;
    }
  }

  throw lastError ?? new Error("重試次數已用盡");
}
