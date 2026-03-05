/**
 * IR Validator Tests
 */

import { describe, it, expect } from "vitest";
import { validateFlowIR } from "@/lib/ir/validator";
import {
  createSimpleGetFlow,
  createCyclicFlow,
} from "../fixtures";

describe("IR Validator", () => {
  it("should pass validation for a valid simple GET flow", () => {
    const ir = createSimpleGetFlow();
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should detect missing trigger", () => {
    const ir = createSimpleGetFlow();
    ir.nodes = ir.nodes.filter((n) => n.category !== "trigger");
    
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "NO_TRIGGER")).toBe(true);
  });

  it("should detect multiple triggers", () => {
    const ir = createSimpleGetFlow();
    ir.nodes.push({
      ...ir.nodes[0],
      id: "trigger_2",
    });
    
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "MULTIPLE_TRIGGERS")).toBe(true);
  });

  it("should detect duplicate node IDs", () => {
    const ir = createSimpleGetFlow();
    ir.nodes.push({
      ...ir.nodes[1],
    }); // duplicate response_1
    
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "DUPLICATE_NODE_ID")).toBe(true);
  });

  it("should detect invalid edge source node", () => {
    const ir = createSimpleGetFlow();
    ir.edges[0].sourceNodeId = "nonexistent";
    
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_EDGE_SOURCE")).toBe(true);
  });

  it("should detect cycles", () => {
    const ir = createCyclicFlow();
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "CYCLE_DETECTED")).toBe(true);
  });

  it("should detect unsupported version number", () => {
    const ir = createSimpleGetFlow();
    (ir as any).version = "99.0.0";
    
    const result = validateFlowIR(ir);
    
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.code === "INVALID_VERSION")).toBe(true);
  });

  it("should handle deep linear graphs without stack overflow (iterative DFS)", () => {
    // Create a long chain of 5000+ nodes — would overflow with recursive DFS
    const depth = 5000;
    const ir = createSimpleGetFlow();
    const trigger = ir.nodes[0];
    ir.nodes = [trigger];
    ir.edges = [];

    let prevId = trigger.id;
    for (let i = 1; i <= depth; i++) {
      const nodeId = `deep_${i}`;
      ir.nodes.push({
        id: nodeId,
        nodeType: "code",
        category: "action",
        label: `Node ${i}`,
        params: {},
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "output", label: "Output" }],
      });
      ir.edges.push({
        id: `e_${i}`,
        sourceNodeId: prevId,
        sourcePortId: "output",
        targetNodeId: nodeId,
        targetPortId: "input",
      });
      prevId = nodeId;
    }

    // Should complete without throwing RangeError (stack overflow)
    const result = validateFlowIR(ir);
    expect(result.errors.filter((e) => e.code === "CYCLE_DETECTED")).toHaveLength(0);
  });
});
