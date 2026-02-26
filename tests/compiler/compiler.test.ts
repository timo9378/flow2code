/**
 * AST 編譯器核心測試
 * 
 * 使用 TDD 模式：先定義預期輸出，確保編譯器的正確性。
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
  describe("基礎編譯", () => {
    it("應成功編譯簡單的 GET 流程", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      expect(result.code).toBeDefined();
      expect(result.filePath).toBe("src/app/api/hello/route.ts");
    });

    it("生成的代碼應包含 NextResponse import", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      // GET 請求會同時 import NextRequest（用於 searchParams）
      expect(result.code).toContain('import { NextRequest, NextResponse } from "next/server"');
    });

    it("生成的代碼應包含 export async function GET", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      expect(result.code).toContain("export async function GET");
      // GET 使用 NextRequest 才能存取 req.nextUrl.searchParams
      expect(result.code).toContain("req: NextRequest");
    });

    it("生成的代碼應包含具型別的 flowState 初始化", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      // v2: 使用 FlowState interface 取代 Record<string, any>
      expect(result.code).toContain("interface FlowState");
      expect(result.code).toContain("const flowState: Partial<FlowState> = {}");
      // 應包含節點 ID 的型別定義（optional fields）
      expect(result.code).toContain("'trigger_1'?:");
      expect(result.code).toContain("'response_1'?:");
    });

    it("生成的代碼應包含 NextResponse.json 回傳", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      expect(result.code).toContain("NextResponse.json");
      expect(result.code).toContain("status: 200");
    });
  });

  describe("POST + Fetch API", () => {
    it("應成功編譯 POST 帶 Fetch 的流程", () => {
      const ir = createPostWithFetchFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      expect(result.code).toContain("export async function POST");
    });

    it("生成的代碼應解析 request body", () => {
      const ir = createPostWithFetchFlow();
      const result = compile(ir);

      expect(result.code).toContain("await req.json()");
    });

    it("生成的代碼應包含 fetch 呼叫", () => {
      const ir = createPostWithFetchFlow();
      const result = compile(ir);

      expect(result.code).toContain("await fetch");
      expect(result.code).toContain("jsonplaceholder");
    });

    it("生成的代碼應將 fetch 結果存入 flowState", () => {
      const ir = createPostWithFetchFlow();
      const result = compile(ir);

      expect(result.code).toContain("flowState['fetch_1']");
    });
  });

  describe("If/Else 分支", () => {
    it("應成功編譯 If/Else 流程", () => {
      const ir = createIfElseFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
    });

    it("生成的代碼應包含 if 條件", () => {
      const ir = createIfElseFlow();
      const result = compile(ir);

      expect(result.code).toContain("if (");
      expect(result.code).toContain("flowState['trigger_1']");
    });

    it("生成的代碼應包含 else 分支", () => {
      const ir = createIfElseFlow();
      const result = compile(ir);

      expect(result.code).toContain("else");
    });

    it("應在 true 分支返回 200，false 分支返回 400", () => {
      const ir = createIfElseFlow();
      const result = compile(ir);

      expect(result.code).toContain("status: 200");
      expect(result.code).toContain("status: 400");
    });
  });

  describe("並發執行 (DAG Scheduling)", () => {
    it("應成功編譯並發流程", () => {
      const ir = createConcurrentFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
    });

    it("生成的代碼應使用 per-node promise (DAG 模式)", () => {
      const ir = createConcurrentFlow();
      const result = compile(ir);

      // DAG 模式：每個節點是獨立的 promise IIFE
      expect(result.code).toContain("const p_");
      expect(result.code).toContain("(async () =>");
    });

    it("生成的代碼應有兩個並發 promise", () => {
      const ir = createConcurrentFlow();
      const result = compile(ir);

      // 應有兩個 promise 變數
      expect(result.code).toContain("const p_fetch_1");
      expect(result.code).toContain("const p_fetch_2");
    });
  });

  describe("環境變數處理", () => {
    it("應將 ${VAR} 轉為 process.env.VAR", () => {
      const ir = createEnvVarFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      expect(result.code).toContain("process.env.API_BASE_URL");
      expect(result.code).toContain("process.env.API_KEY");
    });
  });

  describe("錯誤處理", () => {
    it("應拒絕沒有觸發器的 IR", () => {
      const ir = createSimpleGetFlow();
      ir.nodes = ir.nodes.filter((n) => n.category !== "trigger");

      const result = compile(ir);

      expect(result.success).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it("應拒絕帶環路的 IR", () => {
      // 直接建構一個環路 IR
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
