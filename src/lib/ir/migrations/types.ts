/**
 * IR Migration Engine — Types
 *
 * Defines core interfaces for version migrations.
 * Each migration is responsible for upgrading IR from one version to the next.
 */

// ============================================================
// Migration Interfaces
// ============================================================

/**
 * Raw IR without type validation (from older JSON)
 * Input type for migration functions
 */
export interface RawFlowIR {
  version: string;
  meta: {
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    [key: string]: unknown;
  };
  nodes: unknown[];
  edges: unknown[];
  [key: string]: unknown;
}

/**
 * Single version migration definition
 */
export interface IRMigration {
  /** Source version */
  readonly fromVersion: string;
  /** Target version */
  readonly toVersion: string;
  /** Migration description */
  readonly description: string;
  /**
   * Execute migration
   * @param ir - Older IR (structure may differ from current FlowIR)
   * @returns Upgraded IR
   */
  migrate(ir: RawFlowIR): RawFlowIR;
}

/**
 * Migration result
 */
export interface MigrationResult {
  /** Migrated IR (conforms to the latest version) */
  ir: RawFlowIR;
  /** Applied migration path */
  applied: string[];
  /** Whether any migrations were applied */
  migrated: boolean;
}
