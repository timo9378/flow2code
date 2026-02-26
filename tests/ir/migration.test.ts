/**
 * IR Migration Engine 測試
 *
 * 驗證版本遷移邏輯、鏈式遷移、錯誤處理。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  registerMigration,
  clearMigrations,
  migrateIR,
  needsMigration,
  getMigrationPath,
  compareVersions,
  MigrationError,
} from "@/lib/ir/migrations/engine";
import type { RawFlowIR } from "@/lib/ir/migrations/types";
import { CURRENT_IR_VERSION } from "@/lib/ir/types";

describe("IR Migration Engine", () => {
  beforeEach(() => {
    clearMigrations();
  });

  describe("compareVersions", () => {
    it("相同版本應回傳 0", () => {
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    });

    it("較新版本應回傳正數", () => {
      expect(compareVersions("1.1.0", "1.0.0")).toBeGreaterThan(0);
    });

    it("較舊版本應回傳負數", () => {
      expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    });

    it("應正確比較 patch 版本", () => {
      expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
    });
  });

  describe("needsMigration", () => {
    it("目前版本不需要遷移", () => {
      expect(needsMigration(CURRENT_IR_VERSION)).toBe(false);
    });

    it("舊版本需要遷移", () => {
      expect(needsMigration("0.9.0")).toBe(true);
    });
  });

  describe("registerMigration + migrateIR", () => {
    it("應成功執行單步遷移", () => {
      registerMigration({
        fromVersion: "0.9.0",
        toVersion: "1.0.0",
        description: "升級到 v1.0.0",
        migrate(ir) {
          return { ...ir, version: "1.0.0" };
        },
      });

      const raw: RawFlowIR = {
        version: "0.9.0",
        meta: { name: "test", createdAt: "", updatedAt: "" },
        nodes: [],
        edges: [],
      };

      const result = migrateIR(raw, "1.0.0");
      expect(result.migrated).toBe(true);
      expect(result.ir.version).toBe("1.0.0");
      expect(result.applied).toHaveLength(1);
    });

    it("應成功執行鏈式遷移", () => {
      registerMigration({
        fromVersion: "0.8.0",
        toVersion: "0.9.0",
        description: "0.8 → 0.9",
        migrate(ir) {
          return { ...ir, version: "0.9.0" };
        },
      });
      registerMigration({
        fromVersion: "0.9.0",
        toVersion: "1.0.0",
        description: "0.9 → 1.0",
        migrate(ir) {
          return { ...ir, version: "1.0.0" };
        },
      });

      const raw: RawFlowIR = {
        version: "0.8.0",
        meta: { name: "test", createdAt: "", updatedAt: "" },
        nodes: [],
        edges: [],
      };

      const result = migrateIR(raw, "1.0.0");
      expect(result.migrated).toBe(true);
      expect(result.ir.version).toBe("1.0.0");
      expect(result.applied).toHaveLength(2);
    });

    it("已是目標版本時不應遷移", () => {
      const raw: RawFlowIR = {
        version: "1.0.0",
        meta: { name: "test", createdAt: "", updatedAt: "" },
        nodes: [],
        edges: [],
      };

      const result = migrateIR(raw, "1.0.0");
      expect(result.migrated).toBe(false);
      expect(result.applied).toHaveLength(0);
    });

    it("找不到遷移路徑時應拋出 MigrationError", () => {
      const raw: RawFlowIR = {
        version: "0.5.0",
        meta: { name: "test", createdAt: "", updatedAt: "" },
        nodes: [],
        edges: [],
      };

      expect(() => migrateIR(raw, "1.0.0")).toThrow(MigrationError);
    });

    it("遷移應能修改 IR 結構", () => {
      registerMigration({
        fromVersion: "0.9.0",
        toVersion: "1.0.0",
        description: "加入 meta.updatedAt",
        migrate(ir) {
          return {
            ...ir,
            version: "1.0.0",
            meta: {
              ...ir.meta,
              updatedAt: ir.meta.updatedAt || new Date().toISOString(),
            },
          };
        },
      });

      const raw: RawFlowIR = {
        version: "0.9.0",
        meta: { name: "test", createdAt: "2025-01-01" } as any,
        nodes: [],
        edges: [],
      };

      const result = migrateIR(raw, "1.0.0");
      expect(result.ir.meta.updatedAt).toBeTruthy();
    });

    it("不允許重複註冊", () => {
      registerMigration({
        fromVersion: "0.9.0",
        toVersion: "1.0.0",
        description: "first",
        migrate: (ir) => ({ ...ir, version: "1.0.0" }),
      });

      expect(() =>
        registerMigration({
          fromVersion: "0.9.0",
          toVersion: "1.0.0",
          description: "duplicate",
          migrate: (ir) => ({ ...ir, version: "1.0.0" }),
        })
      ).toThrow("重複");
    });
  });

  describe("getMigrationPath", () => {
    it("應回傳正確的遷移路徑", () => {
      registerMigration({
        fromVersion: "0.8.0",
        toVersion: "0.9.0",
        description: "0.8 → 0.9",
        migrate: (ir) => ({ ...ir, version: "0.9.0" }),
      });
      registerMigration({
        fromVersion: "0.9.0",
        toVersion: "1.0.0",
        description: "0.9 → 1.0",
        migrate: (ir) => ({ ...ir, version: "1.0.0" }),
      });

      const path = getMigrationPath("0.8.0", "1.0.0");
      expect(path).toHaveLength(2);
      expect(path[0].fromVersion).toBe("0.8.0");
      expect(path[1].toVersion).toBe("1.0.0");
    });

    it("無路徑時應回傳空陣列", () => {
      const path = getMigrationPath("0.5.0", "1.0.0");
      expect(path).toHaveLength(0);
    });
  });
});
