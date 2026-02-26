/**
 * Environment Variable Validator 測試
 *
 * 驗證：環境變數收集、.env 解析、驗證報告。
 */

import { describe, it, expect } from "vitest";
import {
  collectEnvVars,
  validateEnvVars,
  parseEnvFile,
  formatEnvValidationReport,
} from "@/lib/compiler/env-validator";
import { createEnvVarFlow, createSimpleGetFlow } from "../fixtures";

describe("Environment Variable Validator", () => {
  describe("collectEnvVars", () => {
    it("應從 Fetch URL 收集環境變數", () => {
      const ir = createEnvVarFlow();
      const usageMap = collectEnvVars(ir);

      expect(usageMap.has("API_BASE_URL")).toBe(true);
      expect(usageMap.has("API_KEY")).toBe(true);
    });

    it("應記錄使用位置", () => {
      const ir = createEnvVarFlow();
      const usageMap = collectEnvVars(ir);

      const apiBaseUsages = usageMap.get("API_BASE_URL")!;
      expect(apiBaseUsages).toHaveLength(1);
      expect(apiBaseUsages[0].nodeId).toBe("fetch_1");
      expect(apiBaseUsages[0].paramKey).toBe("url");
    });

    it("無環境變數時應回傳空 Map", () => {
      const ir = createSimpleGetFlow();
      const usageMap = collectEnvVars(ir);

      expect(usageMap.size).toBe(0);
    });
  });

  describe("parseEnvFile", () => {
    it("應解析基本 KEY=VALUE 格式", () => {
      const content = "API_KEY=abc123\nDB_URL=postgres://localhost";
      const vars = parseEnvFile(content);

      expect(vars).toContain("API_KEY");
      expect(vars).toContain("DB_URL");
    });

    it("應跳過空行和註釋", () => {
      const content = "# This is a comment\n\nAPI_KEY=abc\n  # Another comment";
      const vars = parseEnvFile(content);

      expect(vars).toEqual(["API_KEY"]);
    });

    it("應處理 export 前綴", () => {
      const content = "export API_KEY=abc123";
      const vars = parseEnvFile(content);

      expect(vars).toContain("API_KEY");
    });

    it("應處理引號包裹的值", () => {
      const content = 'API_KEY="my secret key"';
      const vars = parseEnvFile(content);

      expect(vars).toContain("API_KEY");
    });
  });

  describe("validateEnvVars", () => {
    it("所有變數都已宣告時應通過驗證", () => {
      const ir = createEnvVarFlow();
      const result = validateEnvVars(ir, ["API_BASE_URL", "API_KEY"]);

      expect(result.valid).toBe(true);
      expect(result.missingVars).toHaveLength(0);
    });

    it("缺少變數時應驗證失敗", () => {
      const ir = createEnvVarFlow();
      const result = validateEnvVars(ir, ["API_BASE_URL"]); // 缺少 API_KEY

      expect(result.valid).toBe(false);
      expect(result.missingVars).toContain("API_KEY");
    });

    it("應列出未使用的已宣告變數", () => {
      const ir = createEnvVarFlow();
      const result = validateEnvVars(ir, [
        "API_BASE_URL",
        "API_KEY",
        "UNUSED_VAR",
      ]);

      expect(result.valid).toBe(true);
      expect(result.unusedVars).toContain("UNUSED_VAR");
    });

    it("無環境變數的 IR 應直接通過", () => {
      const ir = createSimpleGetFlow();
      const result = validateEnvVars(ir, []);

      expect(result.valid).toBe(true);
      expect(result.usedVars).toHaveLength(0);
    });
  });

  describe("formatEnvValidationReport", () => {
    it("通過驗證時應顯示成功訊息", () => {
      const result = validateEnvVars(createEnvVarFlow(), [
        "API_BASE_URL",
        "API_KEY",
      ]);
      const report = formatEnvValidationReport(result);

      expect(report).toContain("✅");
    });

    it("失敗時應列出缺失的變數", () => {
      const result = validateEnvVars(createEnvVarFlow(), []);
      const report = formatEnvValidationReport(result);

      expect(report).toContain("❌");
      expect(report).toContain("API_BASE_URL");
      expect(report).toContain("API_KEY");
    });
  });
});
