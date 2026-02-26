export type { IRMigration, RawFlowIR, MigrationResult } from "./types";

export {
  registerMigration,
  clearMigrations,
  getRegisteredMigrations,
  migrateIR,
  needsMigration,
  getMigrationPath,
  compareVersions,
  MigrationError,
} from "./engine";
