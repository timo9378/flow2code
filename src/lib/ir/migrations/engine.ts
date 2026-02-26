/**
 * IR Migration Engine
 *
 * 自動將舊版 FlowIR 升級到最新版本。
 * 遷移以鏈式執行：1.0.0 → 1.1.0 → 1.2.0 → ...
 *
 * 設計原則：
 *   1. 不可變：每次 migrate 都回傳新物件
 *   2. 冪等：已經是最新版本的 IR 不做任何修改
 *   3. 可驗證：遷移後可以跑 validator 確認結構正確
 *   4. 可擴展：新增遷移只需 registerMigration()
 */

import type { IRMigration, MigrationResult, RawFlowIR } from "./types";
import { CURRENT_IR_VERSION } from "../types";

// ============================================================
// Migration Registry
// ============================================================

const migrations: IRMigration[] = [];

/**
 * 註冊一個版本遷移
 * 內部會按 fromVersion 排序
 */
export function registerMigration(migration: IRMigration): void {
  // 檢查重複
  const exists = migrations.find(
    (m) =>
      m.fromVersion === migration.fromVersion &&
      m.toVersion === migration.toVersion
  );
  if (exists) {
    throw new Error(
      `重複的遷移定義: ${migration.fromVersion} → ${migration.toVersion}`
    );
  }

  migrations.push(migration);
  // 按語意版本排序
  migrations.sort((a, b) => compareVersions(a.fromVersion, b.fromVersion));
}

/**
 * 清除所有已註冊的遷移（用於測試）
 */
export function clearMigrations(): void {
  migrations.length = 0;
}

/**
 * 取得所有已註冊的遷移
 */
export function getRegisteredMigrations(): readonly IRMigration[] {
  return migrations;
}

// ============================================================
// Migration Execution
// ============================================================

/**
 * 將 IR 遷移到指定版本（預設為最新版本）
 *
 * @param raw - 原始 IR（可能是任何版本）
 * @param targetVersion - 目標版本（預設為 CURRENT_IR_VERSION）
 * @returns MigrationResult 包含遷移後的 IR 和套用紀錄
 */
export function migrateIR(
  raw: RawFlowIR,
  targetVersion: string = CURRENT_IR_VERSION
): MigrationResult {
  const applied: string[] = [];
  let current: RawFlowIR = { ...raw };

  // 如果已經是目標版本，直接回傳
  if (current.version === targetVersion) {
    return { ir: current, applied, migrated: false };
  }

  // 防止無限迴圈
  const maxIterations = migrations.length + 1;
  let iterations = 0;

  while (current.version !== targetVersion) {
    if (iterations++ > maxIterations) {
      throw new MigrationError(
        `遷移超過最大迭代次數 (${maxIterations})，可能存在循環遷移`,
        current.version,
        targetVersion
      );
    }

    const migration = migrations.find(
      (m) => m.fromVersion === current.version
    );

    if (!migration) {
      throw new MigrationError(
        `找不到從 ${current.version} 到 ${targetVersion} 的遷移路徑`,
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
 * 檢查 IR 版本是否需要遷移
 */
export function needsMigration(
  version: string,
  targetVersion: string = CURRENT_IR_VERSION
): boolean {
  return version !== targetVersion;
}

/**
 * 取得從某版本到目標版本的遷移路徑
 */
export function getMigrationPath(
  fromVersion: string,
  targetVersion: string = CURRENT_IR_VERSION
): IRMigration[] {
  const path: IRMigration[] = [];
  let current = fromVersion;

  while (current !== targetVersion) {
    const migration = migrations.find((m) => m.fromVersion === current);
    if (!migration) return []; // 路徑不通
    path.push(migration);
    current = migration.toVersion;
  }

  return path;
}

// ============================================================
// Version Comparison
// ============================================================

/**
 * 比較兩個語意版本字串
 * @returns 負數 (a < b), 0 (a == b), 正數 (a > b)
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
