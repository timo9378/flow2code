/**
 * AI Stream Utilities Tests — SSE parsing, token estimation, retry
 */

import { describe, it, expect, vi } from "vitest";
import {
  estimateTokenCount,
  checkTokenBudget,
  withRetry,
} from "../../src/lib/ai/stream";

describe("estimateTokenCount", () => {
  it("英文文字估算 ~0.25 token/char", () => {
    const text = "Hello world this is a test sentence for token estimation";
    const tokens = estimateTokenCount(text);
    // ~56 chars → ~14 tokens
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(30);
  });

  it("中文文字估算 ~0.67 token/char", () => {
    const text = "這是一段中文測試文字用來估算代幣數量";
    const tokens = estimateTokenCount(text);
    // 18 中文字 → ~12 tokens
    expect(tokens).toBeGreaterThan(8);
    expect(tokens).toBeLessThan(25);
  });

  it("混合中英文", () => {
    const text = "Hello 世界 this is 測試";
    const tokens = estimateTokenCount(text);
    expect(tokens).toBeGreaterThan(3);
    expect(tokens).toBeLessThan(20);
  });

  it("空字串返回 0", () => {
    expect(estimateTokenCount("")).toBe(0);
  });
});

describe("checkTokenBudget", () => {
  it("短 prompt 不超過預算", () => {
    const result = checkTokenBudget("You are an assistant.", "Generate a simple flow");
    expect(result.withinBudget).toBe(true);
    expect(result.estimated).toBeGreaterThan(0);
    expect(result.limit).toBe(8000);
  });

  it("超長 prompt 超出預算", () => {
    const longText = "x".repeat(100000); // ~25000 tokens
    const result = checkTokenBudget(longText, "generate");
    expect(result.withinBudget).toBe(false);
    expect(result.estimated).toBeGreaterThan(8000);
  });

  it("自訂 maxTokens", () => {
    const text = "a".repeat(100); // ~25 tokens
    const result = checkTokenBudget("system", text, 20);
    expect(result.withinBudget).toBe(false);
  });
});

describe("withRetry", () => {
  it("成功時直接返回", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("失敗後重試並成功", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, {
      maxRetries: 3,
      initialDelay: 10,
    });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("超出重試次數則拋出", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fail"));

    await expect(
      withRetry(fn, { maxRetries: 2, initialDelay: 10 })
    ).rejects.toThrow("always fail");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("AbortError 不重試", async () => {
    const abortErr = new DOMException("Aborted", "AbortError");
    const fn = vi.fn().mockRejectedValue(abortErr);

    await expect(
      withRetry(fn, { maxRetries: 3, initialDelay: 10 })
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1); // no retry
  });

  it("4xx 類錯誤不重試", async () => {
    // withRetry checks message.includes("(4") for 4xx detection
    const err = new Error("AI API 錯誤 (400): Bad Request");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(
      withRetry(fn, { maxRetries: 3, initialDelay: 10 })
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("onRetry callback 被呼叫", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("fail"))
      .mockResolvedValueOnce("ok");

    await withRetry(fn, {
      maxRetries: 3,
      initialDelay: 10,
      onRetry,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });
});
