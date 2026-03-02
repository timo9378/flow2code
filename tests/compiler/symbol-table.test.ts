/**
 * Symbol Table Tests
 *
 * Verifies label → camelCase variable name conversion, conflict resolution, reserved word protection.
 */

import { describe, it, expect } from "vitest";
import { buildSymbolTable, labelToVarName } from "@/lib/compiler/symbol-table";
import { compile } from "@/lib/compiler/compiler";
import {
  createSimpleGetFlow,
  createPostWithFetchFlow,
  createConcurrentFlow,
} from "../fixtures";

describe("Symbol Table", () => {
  describe("labelToVarName conversion", () => {
    it("should convert space-separated label to camelCase", () => {
      expect(labelToVarName("Fetch Available Models")).toBe("fetchAvailableModels");
    });

    it("should convert label with slashes (routes) to camelCase", () => {
      expect(labelToVarName("GET /api/hello")).toBe("getApiHello");
    });

    it("should convert label with special characters to camelCase", () => {
      expect(labelToVarName("Merge & Return")).toBe("mergeReturn");
    });

    it("should handle hyphen-separated labels", () => {
      expect(labelToVarName("my-custom-node")).toBe("myCustomNode");
    });

    it("should handle underscore-separated labels", () => {
      expect(labelToVarName("fetch_user_data")).toBe("fetchUserData");
    });

    it("should return empty string when label contains only special characters", () => {
      expect(labelToVarName("!!!")).toBe("");
    });

    it("should maintain camelCase for pure English labels", () => {
      expect(labelToVarName("Check Valid")).toBe("checkValid");
    });
  });

  describe("buildSymbolTable", () => {
    it("should generate unique variable names for each node", () => {
      const ir = createSimpleGetFlow();
      const table = buildSymbolTable(ir);

      const varName1 = table.getVarName("trigger_1");
      const varName2 = table.getVarName("response_1");

      expect(varName1).toBeTruthy();
      expect(varName2).toBeTruthy();
      expect(varName1).not.toBe(varName2);
    });

    it("should correctly map node labels", () => {
      const ir = createSimpleGetFlow();
      const table = buildSymbolTable(ir);

      // "GET /api/hello" → "getApiHello"
      expect(table.getVarName("trigger_1")).toBe("getApiHello");
      // "Return Hello" → "returnHello"
      expect(table.getVarName("response_1")).toBe("returnHello");
    });

    it("should resolve naming conflicts", () => {
      const ir = createConcurrentFlow();
      const table = buildSymbolTable(ir);
      const mappings = table.getAllMappings();

      // All names should be unique
      const names = [...mappings.values()];
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });

    it("should protect JS reserved words", () => {
      // Manually construct a node with a reserved word label
      const ir = createSimpleGetFlow();
      ir.nodes[1].label = "return"; // "return" is a reserved word
      const table = buildSymbolTable(ir);

      const varName = table.getVarName("response_1");
      expect(varName).toBe("returnResult"); // Should add Result suffix
    });

    it("hasVar should return correctly", () => {
      const ir = createSimpleGetFlow();
      const table = buildSymbolTable(ir);

      expect(table.hasVar("trigger_1")).toBe(true);
      expect(table.hasVar("nonexistent_id")).toBe(false);
    });

    it("non-existent ID should fallback to node_xxx", () => {
      const ir = createSimpleGetFlow();
      const table = buildSymbolTable(ir);

      expect(table.getVarName("unknown_node")).toMatch(/^node_/);
    });
  });

  describe("Compiler Integration: Named Variables", () => {
    it("generated code should contain trigger's named variable", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      // Should have const getApiHello = { ... }
      expect(result.code).toContain("const getApiHello");
      // Also preserve flowState assignment
      expect(result.code).toContain("flowState['trigger_1'] = getApiHello");
    });

    it("generated code should contain Action node's named variable alias", () => {
      const ir = createPostWithFetchFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      // Should have named variable for fetch node
      expect(result.code).toContain("const callExternalApi");
    });

    it("concurrent nodes should use DAG mode (per-node promise)", () => {
      const ir = createConcurrentFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      // In DAG mode, concurrent nodes use promise variables instead of named aliases
      expect(result.code).toContain("const p_fetch_1");
      expect(result.code).toContain("const p_fetch_2");
    });

    it("${} expressions should use named variables instead of flowState", () => {
      const ir = createPostWithFetchFlow();
      // Modify body expression to use template syntax
      const responseNode = ir.nodes.find(n => n.id === "response_1")!;
      (responseNode.params as any).bodyExpression = "{ data: {{fetch_1}} }";

      const result = compile(ir);
      expect(result.success).toBe(true);
      // Expression should be resolved to named variable
      expect(result.code).toContain("callExternalApi");
    });
  });
});
