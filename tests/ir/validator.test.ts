/**
 * IR 驗證器測試
 */

import { describe, it, expect } from "vitest";
import { validateFlowIR } from "@/lib/ir/validator";
import {
  createSimpleGetFlow,
  createCyclicFlow,
} from "../fixtures";

describe("IR Validator", () => {
  it("應通過有效的簡單 GET 流程驗證", () => {
    const ir = createSimpleGetFlow();
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("應檢測缺少觸發器的情況", () => {
    const ir = createSimpleGetFlow();
    ir.nodes = ir.nodes.filter((n) => n.category !== "trigger");
    
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "NO_TRIGGER")).toBe(true);
  });

  it("應檢測多個觸發器", () => {
    const ir = createSimpleGetFlow();
    ir.nodes.push({
      ...ir.nodes[0],
      id: "trigger_2",
    });
    
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MULTIPLE_TRIGGERS")).toBe(true);
  });

  it("應檢測重複的節點 ID", () => {
    const ir = createSimpleGetFlow();
    ir.nodes.push({
      ...ir.nodes[1],
    }); // 重複 response_1
    
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "DUPLICATE_NODE_ID")).toBe(true);
  });

  it("應檢測無效的 Edge 來源節點", () => {
    const ir = createSimpleGetFlow();
    ir.edges[0].sourceNodeId = "nonexistent";
    
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_EDGE_SOURCE")).toBe(true);
  });

  it("應檢測環路", () => {
    const ir = createCyclicFlow();
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "CYCLE_DETECTED")).toBe(true);
  });

  it("應檢測不支援的版本號", () => {
    const ir = createSimpleGetFlow();
    (ir as any).version = "99.0.0";
    
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_VERSION")).toBe(true);
  });
});
