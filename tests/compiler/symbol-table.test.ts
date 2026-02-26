/**
 * Symbol Table 測試
 *
 * 驗證 label → camelCase 變數名稱轉換、衝突解決、保留字保護。
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
  describe("labelToVarName 轉換", () => {
    it("應將空格分隔的 label 轉為 camelCase", () => {
      expect(labelToVarName("Fetch Available Models")).toBe("fetchAvailableModels");
    });

    it("應將含斜線的路由轉為 camelCase", () => {
      expect(labelToVarName("GET /api/hello")).toBe("getApiHello");
    });

    it("應將含特殊字元的 label 轉為 camelCase", () => {
      expect(labelToVarName("Merge & Return")).toBe("mergeReturn");
    });

    it("應處理連字號分隔", () => {
      expect(labelToVarName("my-custom-node")).toBe("myCustomNode");
    });

    it("應處理底線分隔", () => {
      expect(labelToVarName("fetch_user_data")).toBe("fetchUserData");
    });

    it("應回傳空字串當 label 只有特殊字元", () => {
      expect(labelToVarName("!!!")).toBe("");
    });

    it("應保持純英文 label 的 camelCase", () => {
      expect(labelToVarName("Check Valid")).toBe("checkValid");
    });
  });

  describe("buildSymbolTable", () => {
    it("應為每個節點生成唯一的變數名稱", () => {
      const ir = createSimpleGetFlow();
      const table = buildSymbolTable(ir);

      const varName1 = table.getVarName("trigger_1");
      const varName2 = table.getVarName("response_1");

      expect(varName1).toBeTruthy();
      expect(varName2).toBeTruthy();
      expect(varName1).not.toBe(varName2);
    });

    it("應正確映射節點 label", () => {
      const ir = createSimpleGetFlow();
      const table = buildSymbolTable(ir);

      // "GET /api/hello" → "getApiHello"
      expect(table.getVarName("trigger_1")).toBe("getApiHello");
      // "Return Hello" → "returnHello"
      expect(table.getVarName("response_1")).toBe("returnHello");
    });

    it("應解決命名衝突", () => {
      const ir = createConcurrentFlow();
      const table = buildSymbolTable(ir);
      const mappings = table.getAllMappings();

      // 所有名稱應唯一
      const names = [...mappings.values()];
      const uniqueNames = new Set(names);
      expect(names.length).toBe(uniqueNames.size);
    });

    it("應保護 JS 保留字", () => {
      // 手動構造一個 label 是保留字的節點
      const ir = createSimpleGetFlow();
      ir.nodes[1].label = "return"; // "return" 是保留字
      const table = buildSymbolTable(ir);

      const varName = table.getVarName("response_1");
      expect(varName).toBe("returnResult"); // 應加 Result 後綴
    });

    it("hasVar 應正確回傳", () => {
      const ir = createSimpleGetFlow();
      const table = buildSymbolTable(ir);

      expect(table.hasVar("trigger_1")).toBe(true);
      expect(table.hasVar("nonexistent_id")).toBe(false);
    });

    it("不存在的 ID 應 fallback 到 node_xxx", () => {
      const ir = createSimpleGetFlow();
      const table = buildSymbolTable(ir);

      expect(table.getVarName("unknown_node")).toMatch(/^node_/);
    });
  });

  describe("編譯器整合：命名變數", () => {
    it("生成的代碼應包含觸發器的命名變數", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      // 應有 const getApiHello = { ... }
      expect(result.code).toContain("const getApiHello");
      // 同時保留 flowState 賦值
      expect(result.code).toContain("flowState['trigger_1'] = getApiHello");
    });

    it("生成的代碼應包含 Action 節點的命名變數別名", () => {
      const ir = createPostWithFetchFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      // 應有 fetch 節點的命名變數
      expect(result.code).toContain("const callExternalApi");
    });

    it("並發節點應有命名變數別名", () => {
      const ir = createConcurrentFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      // 應有兩個並發節點的命名變數
      expect(result.code).toContain("const fetchUsers");
      expect(result.code).toContain("const fetchPosts");
    });

    it("${} 表達式應使用命名變數而非 flowState", () => {
      const ir = createPostWithFetchFlow();
      // 修改 body expression 使用模板語法
      const responseNode = ir.nodes.find(n => n.id === "response_1")!;
      (responseNode.params as any).bodyExpression = "{ data: {{fetch_1}} }";

      const result = compile(ir);
      expect(result.success).toBe(true);
      // 表達式應被解析為命名變數
      expect(result.code).toContain("callExternalApi");
    });
  });
});
