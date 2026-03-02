/**
 * IR Migration Engine
 *
 * Automatically upgrades older FlowIR versions to the latest.
 * Migrations execute in a chain: 1.0.0 → 1.1.0 → 1.2.0 → ...
 *
 * Design Principles:
 *   1. Immutable: each migrate call returns a new object
 *   2. Idempotent: IR already at the latest version is not modified
 *   3. Verifiable: migrated IR can be validated for structural correctness
 *   4. Extensible: adding a new migration only requires registerMigration()
 */

import type { IRMigration, MigrationResult, RawFlowIR } from "./types";
import { CURRENT_IR_VERSION } from "../types";

// ============================================================
// Migration Registry
// ============================================================

const migrations: IRMigration[] = [];

/**
 * Register a version migration
 * Internally sorted by fromVersion
 */
export function registerMigration(migration: IRMigration): void {
  // Check for duplicates
  const exists = migrations.find(
    (m) =>
      m.fromVersion === migration.fromVersion &&
      m.toVersion === migration.toVersion
  );
  if (exists) {
    throw new Error(
      `Duplicate migration definition: ${migration.fromVersion} → ${migration.toVersion}`
    );
  }

  migrations.push(migration);
  // Sort by semantic version
  migrations.sort((a, b) => compareVersions(a.fromVersion, b.fromVersion));
}

/**
 * Clear all registered migrations (for testing)
 */
export function clearMigrations(): void {
  migrations.length = 0;
}

/**
 * Get all registered migrations
 */
export function getRegisteredMigrations(): readonly IRMigration[] {
  return migrations;
}

// ============================================================
// Migration Execution
// ============================================================

/**
 * Migrate IR to a specified version (defaults to latest)
 *
 * @param raw - Raw IR (may be any version)
 * @param targetVersion - Target version (defaults to CURRENT_IR_VERSION)
 * @returns MigrationResult containing the migrated IR and applied records
 */
export function migrateIR(
  raw: RawFlowIR,
  targetVersion: string = CURRENT_IR_VERSION
): MigrationResult {
  const applied: string[] = [];
  let current: RawFlowIR = { ...raw };

  // If already at target version, return directly
  if (current.version === targetVersion) {
    return { ir: current, applied, migrated: false };
  }

  // Prevent infinite loop
  const maxIterations = migrations.length + 1;
  let iterations = 0;

  while (current.version !== targetVersion) {
    if (iterations++ > maxIterations) {
      throw new MigrationError(
        `Migration exceeded max iterations (${maxIterations}), possible circular migration`,
        current.version,
        targetVersion
      );
    }

    const migration = migrations.find(
      (m) => m.fromVersion === current.version
    );

    if (!migration) {
      throw new MigrationError(
        `No migration path found from ${current.version} to ${targetVersion}`,
        current.version,
        targetVersion
      );
    }

    current = migration.migrate(current);
    applied.push(
      `${migration.fromVersion} → ${migration.toVersion}: ${migration.description}`
    );
  }

  return { ir: current, applied, migrated: true };
}

/**
 * Check if IR version needs migration
 */
export function needsMigration(
  version: string,
  targetVersion: string = CURRENT_IR_VERSION
): boolean {
  return version !== targetVersion;
}

/**
 * Get the migration path from a version to the target version
 */
export function getMigrationPath(
  fromVersion: string,
  targetVersion: string = CURRENT_IR_VERSION
): IRMigration[] {
  const path: IRMigration[] = [];
  let current = fromVersion;

  while (current !== targetVersion) {
    const migration = migrations.find((m) => m.fromVersion === current);
    if (!migration) return []; // No path found
    path.push(migration);
    current = migration.toVersion;
  }

  return path;
}

// ============================================================
// Version Comparison
// ============================================================

/**
 * Compare two semantic version strings
 * @returns negative (a < b), 0 (a == b), positive (a > b)
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return 0;
}

// ============================================================
// Error Class
// ============================================================

export class MigrationError extends Error {
  constructor(
    message: string,
    public readonly fromVersion: string,
    public readonly targetVersion: string
  ) {
    super(message);
    this.name = "MigrationError";
  }
}
