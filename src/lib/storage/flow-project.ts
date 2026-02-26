/**
 * Flow2Code FlowProject — 統一的 Flow 載入 / 儲存介面
 *
 * 解決「Git 版控偽解法」問題：
 * 開發者不需手動執行 split / merge，
 * 所有 load / save 操作自動判斷格式、預設以 split YAML 目錄格式存儲。
 *
 * 支援兩種格式：
 * 1. **Split YAML（預設）** — `my-flow/` 目錄（`meta.yaml` + `edges.yaml` + `nodes/*.yaml`）
 * 2. **Single JSON（向下相容）** — `my-flow.flow.json`
 *
 * @example
 * ```ts
 * import { loadFlowProject, saveFlowProject } from "flow2code/compiler";
 *
 * // 載入（自動偵測格式）
 * const ir = loadFlowProject("./flows/my-flow");
 *
 * // 儲存（預設寫成 split YAML 目錄）
 * saveFlowProject(ir, "./flows/my-flow");
 *
 * // 強制存成 .flow.json
 * saveFlowProject(ir, "./flows/my-flow.flow.json", { format: "json" });
 * ```
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, extname, basename, dirname } from "node:path";
import { splitIR, mergeIR, type SplitFiles } from "./split-storage";
import type { FlowIR } from "../ir/types";

// ── Types ──

export type FlowProjectFormat = "split" | "json";

export interface SaveOptions {
  /** 存儲格式，預設 "split"（YAML 目錄） */
  format?: FlowProjectFormat;
  /** 是否清除目錄中多餘的舊節點檔（預設 true） */
  cleanOrphanNodes?: boolean;
}

export interface FlowProjectInfo {
  /** 實際載入路徑 */
  path: string;
  /** 偵測到的格式 */
  format: FlowProjectFormat;
  /** 載入的 IR */
  ir: FlowIR;
}

// ── Format Detection ──

/**
 * 偵測路徑的流程格式
 *
 * 偵測順序：
 * 1. 路徑以 `.flow.json` 結尾 → json
 * 2. 路徑是目錄且含 `meta.yaml` → split
 * 3. 路徑 + `.flow.json` 檔案存在 → json
 * 4. 路徑是目錄（推測為 split） → split
 */
export function detectFormat(inputPath: string): { resolvedPath: string; format: FlowProjectFormat } {
  // Case 1: 明確的 .flow.json 檔案
  if (inputPath.endsWith(".flow.json") && existsSync(inputPath)) {
    return { resolvedPath: inputPath, format: "json" };
  }

  // Case 2: 目錄中含 meta.yaml → split
  if (existsSync(inputPath) && statSync(inputPath).isDirectory()) {
    if (existsSync(join(inputPath, "meta.yaml"))) {
      return { resolvedPath: inputPath, format: "split" };
    }
  }

  // Case 3: 加上 .flow.json 後綴存在
  const jsonPath = inputPath.endsWith(".json") ? inputPath : `${inputPath}.flow.json`;
  if (existsSync(jsonPath)) {
    return { resolvedPath: jsonPath, format: "json" };
  }

  // Case 4: 目錄存在（可能還沒建立 meta.yaml，視為 split）
  if (existsSync(inputPath) && statSync(inputPath).isDirectory()) {
    return { resolvedPath: inputPath, format: "split" };
  }

  // Default: 尚未存在的路徑 → 預設 split
  return { resolvedPath: inputPath, format: "split" };
}

// ── Load ──

/**
 * 載入 Flow 專案（自動偵測格式）
 */
export function loadFlowProject(inputPath: string): FlowProjectInfo {
  const { resolvedPath, format } = detectFormat(inputPath);

  if (format === "json") {
    if (!existsSync(resolvedPath)) {
      throw new Error(`Flow file not found: ${resolvedPath}`);
    }
    const raw = readFileSync(resolvedPath, "utf-8");
    const ir = JSON.parse(raw) as FlowIR;
    return { path: resolvedPath, format, ir };
  }

  // split
  if (!existsSync(resolvedPath)) {
    throw new Error(`Flow directory not found: ${resolvedPath}`);
  }
  const metaPath = join(resolvedPath, "meta.yaml");
  if (!existsSync(metaPath)) {
    throw new Error(`meta.yaml not found in ${resolvedPath} — 不是有效的 Flow 目錄`);
  }

  const meta = readFileSync(metaPath, "utf-8");
  const edgesPath = join(resolvedPath, "edges.yaml");
  const edges = existsSync(edgesPath) ? readFileSync(edgesPath, "utf-8") : "";

  const nodesDir = join(resolvedPath, "nodes");
  const nodes = new Map<string, string>();
  if (existsSync(nodesDir)) {
    const nodeFiles = readdirSync(nodesDir).filter((f) => f.endsWith(".yaml"));
    for (const file of nodeFiles) {
      nodes.set(file, readFileSync(join(nodesDir, file), "utf-8"));
    }
  }

  const ir = mergeIR({ meta, edges, nodes });
  return { path: resolvedPath, format, ir };
}

// ── Save ──

/**
 * 儲存 Flow 專案
 *
 * @param format - 預設 "split"。Pass "json" to save as single .flow.json.
 */
export function saveFlowProject(
  ir: FlowIR,
  outputPath: string,
  options: SaveOptions = {}
): string[] {
  const { format = "split", cleanOrphanNodes = true } = options;

  if (format === "json") {
    const jsonPath = outputPath.endsWith(".flow.json") ? outputPath : `${outputPath}.flow.json`;
    const dir = dirname(jsonPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(jsonPath, JSON.stringify(ir, null, 2), "utf-8");
    return [jsonPath];
  }

  // split format
  const dirPath = outputPath.endsWith(".flow.json")
    ? outputPath.replace(/\.flow\.json$/, "")
    : outputPath;

  mkdirSync(dirPath, { recursive: true });
  const nodesDir = join(dirPath, "nodes");
  mkdirSync(nodesDir, { recursive: true });

  const files = splitIR(ir);
  const written: string[] = [];

  // meta.yaml
  const metaPath = join(dirPath, "meta.yaml");
  writeFileSync(metaPath, files.meta, "utf-8");
  written.push(metaPath);

  // edges.yaml
  const edgesPath = join(dirPath, "edges.yaml");
  writeFileSync(edgesPath, files.edges, "utf-8");
  written.push(edgesPath);

  // nodes/*.yaml
  const newNodeFiles = new Set<string>();
  for (const [filename, content] of files.nodes) {
    const nodePath = join(nodesDir, filename);
    writeFileSync(nodePath, content, "utf-8");
    written.push(nodePath);
    newNodeFiles.add(filename);
  }

  // 清理多餘的舊節點檔案（節點被刪除後殘留的 YAML）
  if (cleanOrphanNodes && existsSync(nodesDir)) {
    const existing = readdirSync(nodesDir).filter((f) => f.endsWith(".yaml"));
    for (const file of existing) {
      if (!newNodeFiles.has(file)) {
        rmSync(join(nodesDir, file));
      }
    }
  }

  return written;
}

// ── Utilities ──

/**
 * 將 .flow.json 遷移為 split YAML 目錄
 * 回傳寫入的檔案列表。原始 .flow.json 不會被刪除。
 */
export function migrateToSplit(jsonPath: string): string[] {
  if (!existsSync(jsonPath)) {
    throw new Error(`File not found: ${jsonPath}`);
  }
  const raw = readFileSync(jsonPath, "utf-8");
  const ir = JSON.parse(raw) as FlowIR;
  const dirPath = jsonPath.replace(/\.flow\.json$/, "");
  return saveFlowProject(ir, dirPath, { format: "split" });
}
