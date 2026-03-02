/**
 * AST Compiler Core Tests
 * 
 * Uses TDD approach: define expected output first to ensure compiler correctness.
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import {
  createSimpleGetFlow,
  createPostWithFetchFlow,
  createIfElseFlow,
  createConcurrentFlow,
  createEnvVarFlow,
} from "../fixtures";

describe("AST Compiler", () => {
  describe("Basic Compilation", () => {
    it("should successfully compile a simple GET flow", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      expect(result.code).toBeDefined();
      expect(result.filePath).toBe("src/app/api/hello/route.ts");
    });

    it("generated code should contain NextResponse import", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      // GET requests will also import NextRequest (for searchParams)
      expect(result.code).toContain('import { NextRequest, NextResponse } from "next/server"');
    });

    it("generated code should contain export async function GET", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      expect(result.code).toContain("export async function GET");
      // GET uses NextRequest to access req.nextUrl.searchParams
      expect(result.code).toContain("req: NextRequest");
    });

    it("generated code should contain typed flowState initialization", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      // v2: uses FlowState interface instead of Record<string, any>
      expect(result.code).toContain("interface FlowState");
      expect(result.code).toContain("const flowState: Partial<FlowState> = {}");
      // Should contain type definitions for node IDs (optional fields)
      expect(result.code).toContain("'trigger_1'?:");
      expect(result.code).toContain("'response_1'?:");
    });

    it("generated code should contain NextResponse.json return", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      expect(result.code).toContain("NextResponse.json");
      expect(result.code).toContain("status: 200");
    });
  });

  describe("POST + Fetch API", () => {
    it("should successfully compile POST with Fetch flow", () => {
      const ir = createPostWithFetchFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      expect(result.code).toContain("export async function POST");
    });

    it("generated code should parse request body", () => {
      const ir = createPostWithFetchFlow();
      const result = compile(ir);

      expect(result.code).toContain("await req.json()");
    });

    it("generated code should contain fetch call", () => {
      const ir = createPostWithFetchFlow();
      const result = compile(ir);

      expect(result.code).toContain("await fetch");
      expect(result.code).toContain("jsonplaceholder");
    });

    it("generated code should store fetch result in flowState", () => {
      const ir = createPostWithFetchFlow();
      const result = compile(ir);

      expect(result.code).toContain("flowState['fetch_1']");
    });
  });

  describe("If/Else Branching", () => {
    it("should successfully compile If/Else flow", () => {
      const ir = createIfElseFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
    });

    it("generated code should contain if condition", () => {
      const ir = createIfElseFlow();
      const result = compile(ir);

      expect(result.code).toContain("if (");
      expect(result.code).toContain("flowState['trigger_1']");
    });

    it("generated code should contain else branch", () => {
      const ir = createIfElseFlow();
      const result = compile(ir);

      expect(result.code).toContain("else");
    });

    it("should return 200 in true branch and 400 in false branch", () => {
      const ir = createIfElseFlow();
      const result = compile(ir);

      expect(result.code).toContain("status: 200");
      expect(result.code).toContain("status: 400");
    });
  });

  describe("Concurrent Execution (DAG Scheduling)", () => {
    it("should successfully compile concurrent flow", () => {
      const ir = createConcurrentFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
    });

    it("generated code should use per-node promise (DAG mode)", () => {
      const ir = createConcurrentFlow();
      const result = compile(ir);

      // DAG mode: each node is an independent promise IIFE
      expect(result.code).toContain("const p_");
      expect(result.code).toContain("(async () =>");
    });

    it("generated code should have two concurrent promises", () => {
      const ir = createConcurrentFlow();
      const result = compile(ir);

      // Should have two promise variables
      expect(result.code).toContain("const p_fetch_1");
      expect(result.code).toContain("const p_fetch_2");
    });
  });

  describe("Environment Variable Handling", () => {
    it("should convert ${VAR} to process.env.VAR", () => {
      const ir = createEnvVarFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      expect(result.code).toContain("process.env.API_BASE_URL");
      expect(result.code).toContain("process.env.API_KEY");
    });
  });

  describe("Error Handling", () => {
    it("should reject IR without a trigger", () => {
      const ir = createSimpleGetFlow();
      ir.nodes = ir.nodes.filter((n) => n.category !== "trigger");

      const result = compile(ir);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("should reject IR with cycles", () => {
      // Directly construct a cyclic IR
      const result = compile({
        version: "1.0.0",
        meta: { name: "test", createdAt: "", updatedAt: "" },
        nodes: [
          {
            id: "t1",
            nodeType: "http_webhook" as any,
            category: "trigger" as any,
            label: "T",
            params: { method: "GET", routePath: "/test", parseBody: false },
            inputs: [],
            outputs: [{ id: "out", label: "Out", dataType: "any" }],
          },
          {
            id: "a",
            nodeType: "custom_code" as any,
            category: "action" as any,
            label: "A",
            params: { code: "", returnVariable: "x" },
            inputs: [{ id: "in", label: "In", dataType: "any", required: false }],
            outputs: [{ id: "out", label: "Out", dataType: "any" }],
          },
          {
            id: "b",
            nodeType: "custom_code" as any,
            category: "action" as any,
            label: "B",
            params: { code: "", returnVariable: "y" },
            inputs: [{ id: "in", label: "In", dataType: "any", required: false }],
            outputs: [{ id: "out", label: "Out", dataType: "any" }],
          },
        ],
        edges: [
          { id: "e1", sourceNodeId: "t1", sourcePortId: "out", targetNodeId: "a", targetPortId: "in" },
          { id: "e2", sourceNodeId: "a", sourcePortId: "out", targetNodeId: "b", targetPortId: "in" },
          { id: "e3", sourceNodeId: "b", sourcePortId: "out", targetNodeId: "a", targetPortId: "in" },
        ],
      });

      expect(result.success).toBe(false);
    });
  });
});
