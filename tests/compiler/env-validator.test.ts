/**
 * Environment Variable Validator Tests
 *
 * Verifies: environment variable collection, .env parsing, and validation reports.
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
    it("should collect environment variables from Fetch URL", () => {
      const ir = createEnvVarFlow();
      const usageMap = collectEnvVars(ir);

      expect(usageMap.has("API_BASE_URL")).toBe(true);
      expect(usageMap.has("API_KEY")).toBe(true);
    });

    it("should record usage locations", () => {
      const ir = createEnvVarFlow();
      const usageMap = collectEnvVars(ir);

      const apiBaseUsages = usageMap.get("API_BASE_URL")!;
      expect(apiBaseUsages).toHaveLength(1);
      expect(apiBaseUsages[0].nodeId).toBe("fetch_1");
      expect(apiBaseUsages[0].paramKey).toBe("url");
    });

    it("should return an empty Map when there are no environment variables", () => {
      const ir = createSimpleGetFlow();
      const usageMap = collectEnvVars(ir);

      expect(usageMap.size).toBe(0);
    });
  });

  describe("parseEnvFile", () => {
    it("should parse basic KEY=VALUE format", () => {
      const content = "API_KEY=abc123\nDB_URL=postgres://localhost";
      const vars = parseEnvFile(content);

      expect(vars).toContain("API_KEY");
      expect(vars).toContain("DB_URL");
    });

    it("should skip blank lines and comments", () => {
      const content = "# This is a comment\n\nAPI_KEY=abc\n  # Another comment";
      const vars = parseEnvFile(content);

      expect(vars).toEqual(["API_KEY"]);
    });

    it("should handle export prefix", () => {
      const content = "export API_KEY=abc123";
      const vars = parseEnvFile(content);

      expect(vars).toContain("API_KEY");
    });

    it("should handle quoted values", () => {
      const content = 'API_KEY="my secret key"';
      const vars = parseEnvFile(content);

      expect(vars).toContain("API_KEY");
    });
  });

  describe("validateEnvVars", () => {
    it("should pass validation when all variables are declared", () => {
      const ir = createEnvVarFlow();
      const result = validateEnvVars(ir, ["API_BASE_URL", "API_KEY"]);

      expect(result.valid).toBe(true);
      expect(result.missingVars).toHaveLength(0);
    });

    it("should fail validation when variables are missing", () => {
      const ir = createEnvVarFlow();
      const result = validateEnvVars(ir, ["API_BASE_URL"]); // Missing API_KEY

      expect(result.valid).toBe(false);
      expect(result.missingVars).toContain("API_KEY");
    });

    it("should list unused declared variables", () => {
      const ir = createEnvVarFlow();
      const result = validateEnvVars(ir, [
        "API_BASE_URL",
        "API_KEY",
        "UNUSED_VAR",
      ]);

      expect(result.valid).toBe(true);
      expect(result.unusedVars).toContain("UNUSED_VAR");
    });

    it("should pass directly for IR with no environment variables", () => {
      const ir = createSimpleGetFlow();
      const result = validateEnvVars(ir, []);

      expect(result.valid).toBe(true);
      expect(result.usedVars).toHaveLength(0);
    });
  });

  describe("formatEnvValidationReport", () => {
    it("should display success message when validation passes", () => {
      const result = validateEnvVars(createEnvVarFlow(), [
        "API_BASE_URL",
        "API_KEY",
      ]);
      const report = formatEnvValidationReport(result);

      expect(report).toContain("✅");
    });

    it("should list missing variables on failure", () => {
      const result = validateEnvVars(createEnvVarFlow(), []);
      const report = formatEnvValidationReport(result);

      expect(report).toContain("❌");
      expect(report).toContain("API_BASE_URL");
      expect(report).toContain("API_KEY");
    });
  });
});
