/**
 * Reachability Analysis & Promise Safety 測試
 *
 * 驗證三個關鍵修復：
 *   Boss 1: DAG 模式不再重複生成子區塊節點（Pre-computed childBlockNodeIds）
 *   Boss 2: Control Flow 子節點的下游不再外洩到頂層（Block Continuation）
 *   Boss 3: DAG Promise 有 .catch 防護 & Promise.allSettled barrier
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import { registerPlugins } from "@/lib/compiler/plugins/types";
import { builtinPlugins } from "@/lib/compiler/plugins/builtin";
import type { FlowIR } from "@/lib/ir/types";
import {
  NodeCategory,
  TriggerType,
  ActionType,
  LogicType,
  OutputType,
} from "@/lib/ir/types";

registerPlugins(builtinPlugins);

// ============================================================
// Fixtures
// ============================================================

/**
 * Boss 1 場景：DAG 模式下的 If/Else 含子節點
 *
 * trigger ──→ fetch_a ──→ if_1 ──true──→ fetch_child
 *          └─→ fetch_b ──→ response_1
 *
 * fetch_a 與 fetch_b 並行（觸發 DAG 模式）。
 * fetch_child 是 if_1 的 true 分支子節點，不應出現在頂層 DAG。
 */
function createDAGWithIfElse(): FlowIR {
  return {
    version: "1.0.0",
    meta: { name: "DAG + If/Else", createdAt: "", updatedAt: "" },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "POST /api/test",
        params: { method: "POST", routePath: "/api/test", parseBody: true },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "fetch_a",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch A",
        params: { url: "https://api-a.example.com", method: "GET", parseJson: true },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "fetch_b",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch B",
        params: { url: "https://api-b.example.com", method: "GET", parseJson: true },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "if_1",
        nodeType: LogicType.IF_ELSE,
        category: NodeCategory.LOGIC,
        label: "Check A",
        params: { condition: "{{fetch_a.data.ok}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "true", label: "True", dataType: "any" },
          { id: "false", label: "False", dataType: "any" },
        ],
      },
      {
        id: "fetch_child",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch Child",
        params: { url: "https://api-child.example.com", method: "POST", parseJson: true },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "response_1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Return",
        params: { statusCode: 200, bodyExpression: "{{fetch_b}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [],
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_a", targetPortId: "input" },
      { id: "e2", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_b", targetPortId: "input" },
      { id: "e3", sourceNodeId: "fetch_a", sourcePortId: "response", targetNodeId: "if_1", targetPortId: "input" },
      { id: "e4", sourceNodeId: "if_1", sourcePortId: "true", targetNodeId: "fetch_child", targetPortId: "input" },
      { id: "e5", sourceNodeId: "fetch_b", sourcePortId: "response", targetNodeId: "response_1", targetPortId: "input" },
      { id: "e6", sourceNodeId: "if_1", sourcePortId: "response", targetNodeId: "response_1", targetPortId: "input" },
    ],
  };
}

/**
 * Boss 2 場景：If/Else true 分支的下游鏈
 *
 * trigger ──→ if_1 ──true──→ fetch_a ──→ write_db
 *                   └false──→ response_err (400)
 *            └──→ response_ok (200, uses write_db result)
 *
 * fetch_a 和 write_db 都必須在 if (true) { ... } 區塊內。
 * write_db 不能外洩到頂層。
 */
function createIfElseWithDownstreamChain(): FlowIR {
  return {
    version: "1.0.0",
    meta: { name: "If/Else Chain", createdAt: "", updatedAt: "" },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "POST /api/process",
        params: { method: "POST", routePath: "/api/process", parseBody: true },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "if_1",
        nodeType: LogicType.IF_ELSE,
        category: NodeCategory.LOGIC,
        label: "Check Valid",
        params: { condition: "{{trigger_1.body.valid}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "true", label: "True", dataType: "any" },
          { id: "false", label: "False", dataType: "any" },
        ],
      },
      {
        id: "fetch_a",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch API",
        params: { url: "https://api.example.com/data", method: "GET", parseJson: true },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "response", label: "Response", dataType: "object" }],
      },
      {
        id: "write_db",
        nodeType: ActionType.SQL_QUERY,
        category: NodeCategory.ACTION,
        label: "Write DB",
        params: {
          orm: "drizzle",
          operation: "custom",
          customQuery: "INSERT INTO logs (data) VALUES ({{fetch_a.data}})",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "object" }],
      },
      {
        id: "response_err",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Error Response",
        params: { statusCode: 400, bodyExpression: '"invalid"' },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [],
      },
      {
        id: "response_ok",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "OK Response",
        params: { statusCode: 200, bodyExpression: "{{if_1}}" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [],
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "if_1", targetPortId: "input" },
      { id: "e2", sourceNodeId: "if_1", sourcePortId: "true", targetNodeId: "fetch_a", targetPortId: "input" },
      { id: "e3", sourceNodeId: "fetch_a", sourcePortId: "response", targetNodeId: "write_db", targetPortId: "input" },
      { id: "e4", sourceNodeId: "if_1", sourcePortId: "false", targetNodeId: "response_err", targetPortId: "input" },
      { id: "e5", sourceNodeId: "if_1", sourcePortId: "output", targetNodeId: "response_ok", targetPortId: "input" },
    ],
  };
}

// ============================================================
// Boss 1: DAG 重複生成修復
// ============================================================

describe("Boss 1: DAG 不重複生成子區塊節點", () => {
  it("If/Else 子節點不應出現在頂層 DAG promise", () => {
    const ir = createDAGWithIfElse();
    const result = compile(ir);

    expect(result.success).toBe(true);
    const code = result.code!;

    // fetch_child 不應有自己的頂層 promise IIFE
    expect(code).not.toMatch(/const p_fetch_child\s*=/);

    // fetch_child 應該在 if 區塊內被生成
    expect(code).toContain("if (");
    expect(code).toContain("Fetch Child");
  });

  it("fetch_child 的代碼只應出現一次（不重複宣告）", () => {
    const ir = createDAGWithIfElse();
    const result = compile(ir);

    expect(result.success).toBe(true);
    const code = result.code!;

    // Fetch Child 的註解標記只應出現一次
    const mentions = code.match(/--- Fetch Child/g);
    expect(mentions).toHaveLength(1);
  });
});

// ============================================================
// Boss 2: Control Flow 子節點下游不外洩
// ============================================================

describe("Boss 2: Control Flow 後代節點不外洩到頂層", () => {
  it("write_db 應在 if 區塊內（不在頂層）", () => {
    const ir = createIfElseWithDownstreamChain();
    const result = compile(ir);

    expect(result.success).toBe(true);
    const code = result.code!;

    // write_db 應被生成（存在於代碼中）
    expect(code).toContain("Write DB");

    // 定位 if 區塊和 write_db 的位置
    const ifPos = code.indexOf("if (");
    const writeDbPos = code.indexOf("Write DB");

    // write_db 應出現在 if 之後（表示它在 if 區塊內）
    expect(ifPos).toBeGreaterThan(-1);
    expect(writeDbPos).toBeGreaterThan(ifPos);

    // write_db 不應以頂層獨立語句出現在 if 區塊外面
    // 檢查 write_db 註解出現在 if 區塊的大括號 {} 之間
    const ifBlock = code.substring(ifPos);
    const firstCloseBrace = findMatchingBrace(ifBlock);
    const writeDbRelPos = ifBlock.indexOf("Write DB");
    expect(writeDbRelPos).toBeLessThan(firstCloseBrace);
  });

  it("fetch_a 也必須在 if 區塊內", () => {
    const ir = createIfElseWithDownstreamChain();
    const result = compile(ir);

    expect(result.success).toBe(true);
    const code = result.code!;

    const ifPos = code.indexOf("if (");
    const fetchAPos = code.indexOf("Fetch API");

    expect(ifPos).toBeGreaterThan(-1);
    expect(fetchAPos).toBeGreaterThan(ifPos);
  });
});

// ============================================================
// Boss 3: Promise 安全性
// ============================================================

describe("Boss 3: DAG Promise 安全性", () => {
  it("每個 DAG promise 應有 .catch 防護", () => {
    const ir = createDAGWithIfElse();
    const result = compile(ir);

    expect(result.success).toBe(true);
    const code = result.code!;

    // 找到所有 DAG promise 變數
    const promiseDecls = code.match(/const (p_\w+)\s*=\s*\(async/g);
    expect(promiseDecls).toBeTruthy();
    expect(promiseDecls!.length).toBeGreaterThan(0);

    // 每個 promise 都應該有對應的 .catch
    for (const decl of promiseDecls!) {
      const varName = decl.match(/const (p_\w+)/)?.[1];
      expect(code).toContain(`${varName}.catch(() => {`);
    }
  });

  it("Output 前應有 Promise.allSettled barrier", () => {
    const ir = createDAGWithIfElse();
    const result = compile(ir);

    expect(result.success).toBe(true);
    const code = result.code!;

    // 應包含 Promise.allSettled
    expect(code).toContain("Promise.allSettled");

    // Promise.allSettled 應在 Output 節點標記之前
    const barrierPos = code.indexOf("Promise.allSettled");
    const outputCommentMatch = code.match(/\/\/ --- Return \(return_response\)/);
    const outputCommentPos = outputCommentMatch ? code.indexOf(outputCommentMatch[0]) : -1;
    expect(barrierPos).toBeGreaterThan(-1);
    expect(outputCommentPos).toBeGreaterThan(-1);
    expect(barrierPos).toBeLessThan(outputCommentPos);
  });
});

// ============================================================
// Helper
// ============================================================

/** 簡易大括號匹配：找到第一個 { 對應的 } 位置 */
function findMatchingBrace(code: string): number {
  let depth = 0;
  let started = false;
  for (let i = 0; i < code.length; i++) {
    if (code[i] === "{") {
      depth++;
      started = true;
    } else if (code[i] === "}") {
      depth--;
      if (started && depth === 0) return i;
    }
  }
  return code.length;
}
