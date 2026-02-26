/**
 * AI Prompt 系統提示詞測試
 * 
 * 驗證 prompt 模組的正確性
 */

import { describe, it, expect } from "vitest";
import { FLOW_IR_SYSTEM_PROMPT, EXAMPLE_PROMPTS } from "@/lib/ai/prompt";

describe("AI Prompt", () => {
  it("should contain all 14 node types in system prompt", () => {
    const nodeTypes = [
      "http_webhook", "cron_job", "manual",
      "fetch_api", "sql_query", "redis_cache", "custom_code",
      "if_else", "for_loop", "try_catch", "promise_all",
      "declare", "transform", "return_response",
    ];

    for (const type of nodeTypes) {
      expect(FLOW_IR_SYSTEM_PROMPT).toContain(type);
    }
  });

  it("should contain FlowIR schema structure", () => {
    expect(FLOW_IR_SYSTEM_PROMPT).toContain("version");
    expect(FLOW_IR_SYSTEM_PROMPT).toContain("meta");
    expect(FLOW_IR_SYSTEM_PROMPT).toContain("nodes");
    expect(FLOW_IR_SYSTEM_PROMPT).toContain("edges");
  });

  it("should contain rules for generation", () => {
    expect(FLOW_IR_SYSTEM_PROMPT).toContain("EXACTLY ONE trigger");
    expect(FLOW_IR_SYSTEM_PROMPT).toContain("No cycles");
  });

  it("should have example prompts in Chinese", () => {
    expect(EXAMPLE_PROMPTS.length).toBeGreaterThan(0);
    expect(EXAMPLE_PROMPTS[0]).toContain("建立");
  });
});
