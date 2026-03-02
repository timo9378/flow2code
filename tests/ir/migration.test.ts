/**
 * IR Migration Engine Tests
 *
 * Verifies version migration logic, chain migration, and error handling.
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
    it("same version should return 0", () => {
      expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    });

    it("newer version should return a positive number", () => {
      expect(compareVersions("1.1.0", "1.0.0")).toBeGreaterThan(0);
    });

    it("older version should return a negative number", () => {
      expect(compareVersions("1.0.0", "2.0.0")).toBeLessThan(0);
    });

    it("should correctly compare patch versions", () => {
      expect(compareVersions("1.0.1", "1.0.0")).toBeGreaterThan(0);
    });
  });

  describe("needsMigration", () => {
    it("current version does not need migration", () => {
      expect(needsMigration(CURRENT_IR_VERSION)).toBe(false);
    });

    it("old version needs migration", () => {
      expect(needsMigration("0.9.0")).toBe(true);
    });
  });

  describe("registerMigration + migrateIR", () => {
    it("should successfully execute single-step migration", () => {
      registerMigration({
        fromVersion: "0.9.0",
        toVersion: "1.0.0",
        description: "Upgrade to v1.0.0",
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

    it("should successfully execute chain migration", () => {
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

    it("should not migrate when already at target version", () => {
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

    it("should throw MigrationError when no migration path found", () => {
      const raw: RawFlowIR = {
        version: "0.5.0",
        meta: { name: "test", createdAt: "", updatedAt: "" },
        nodes: [],
        edges: [],
      };

      expect(() => migrateIR(raw, "1.0.0")).toThrow(MigrationError);
    });

    it("migration should be able to modify IR structure", () => {
      registerMigration({
        fromVersion: "0.9.0",
        toVersion: "1.0.0",
        description: "Add meta.updatedAt",
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

    it("should not allow duplicate registration", () => {
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
      ).toThrow("Duplicate");
    });
  });

  describe("getMigrationPath", () => {
    it("should return the correct migration path", () => {
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

    it("should return an empty array when no path exists", () => {
      const path = getMigrationPath("0.5.0", "1.0.0");
      expect(path).toHaveLength(0);
    });
  });
});
