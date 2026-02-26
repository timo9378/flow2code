/**
 * IR Migration Engine — Types
 *
 * 定義版本遷移的核心介面。
 * 每個 migration 負責將 IR 從一個版本升級到下一個版本。
 */

// ============================================================
// 遷移介面
// ============================================================

/**
 * 未經型別驗證的原始 IR（來自舊版 JSON）
 * migration 函式的輸入類型
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
 * 單次版本遷移定義
 */
export interface IRMigration {
  /** 來源版本 */
  readonly fromVersion: string;
  /** 目標版本 */
  readonly toVersion: string;
  /** 遷移描述 */
  readonly description: string;
  /**
   * 執行遷移
   * @param ir - 舊版 IR（結構可能與目前 FlowIR 不同）
   * @returns 升級後的 IR
   */
  migrate(ir: RawFlowIR): RawFlowIR;
}

/**
 * 遷移結果
 */
export interface MigrationResult {
  /** 遷移後的 IR（已符合最新版本） */
  ir: RawFlowIR;
  /** 已套用的遷移路徑 */
  applied: string[];
  /** 是否有任何遷移被套用 */
  migrated: boolean;
}
