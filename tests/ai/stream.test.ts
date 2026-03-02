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
  it("English text estimates ~0.25 token/char", () => {
    const text = "Hello world this is a test sentence for token estimation";
    const tokens = estimateTokenCount(text);
    // ~56 chars → ~14 tokens
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBeLessThan(30);
  });

  it("Chinese text estimates ~0.67 token/char", () => {
    const text = "這是一段中文測試文字用來估算代幣數量";
    const tokens = estimateTokenCount(text);
    // 18 Chinese chars → ~12 tokens
    expect(tokens).toBeGreaterThan(8);
    expect(tokens).toBeLessThan(25);
  });

  it("mixed Chinese and English text", () => {
    const text = "Hello 世界 this is 測試";
    const tokens = estimateTokenCount(text);
    expect(tokens).toBeGreaterThan(3);
    expect(tokens).toBeLessThan(20);
  });

  it("empty string returns 0", () => {
    expect(estimateTokenCount("")).toBe(0);
  });
});

describe("checkTokenBudget", () => {
  it("short prompt stays within budget", () => {
    const result = checkTokenBudget("You are an assistant.", "Generate a simple flow");
    expect(result.withinBudget).toBe(true);
    expect(result.estimated).toBeGreaterThan(0);
    expect(result.limit).toBe(8000);
  });

  it("very long prompt exceeds budget", () => {
    const longText = "x".repeat(100000); // ~25000 tokens
    const result = checkTokenBudget(longText, "generate");
    expect(result.withinBudget).toBe(false);
    expect(result.estimated).toBeGreaterThan(8000);
  });

  it("custom maxTokens", () => {
    const text = "a".repeat(100); // ~25 tokens
    const result = checkTokenBudget("system", text, 20);
    expect(result.withinBudget).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns directly on success", async () => {
    const fn = vi.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { maxRetries: 3 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries after failure and succeeds", async () => {
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

  it("throws when retry count is exceeded", async () => {
    const fn = vi.fn().mockRejectedValue(new Error("always fail"));

    await expect(
      withRetry(fn, { maxRetries: 2, initialDelay: 10 })
    ).rejects.toThrow("always fail");
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it("AbortError does not retry", async () => {
    const abortErr = new DOMException("Aborted", "AbortError");
    const fn = vi.fn().mockRejectedValue(abortErr);

    await expect(
      withRetry(fn, { maxRetries: 3, initialDelay: 10 })
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1); // no retry
  });

  it("4xx errors do not retry", async () => {
    // withRetry checks message.includes("(4") for 4xx detection
    const err = new Error("AI API Error (400): Bad Request");
    const fn = vi.fn().mockRejectedValue(err);

    await expect(
      withRetry(fn, { maxRetries: 3, initialDelay: 10 })
    ).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("onRetry callback is called", async () => {
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
