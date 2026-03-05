/**
 * Flow2Code FlowProject — Unified Flow load / save interface
 *
 * Solves the "Git version control workaround" problem:
 * Developers don't need to manually run split / merge;
 * all load / save operations auto-detect format and default to split YAML directory storage.
 *
 * Supports two formats:
 * 1. **Split YAML (default)** — `my-flow/` directory (`meta.yaml` + `edges.yaml` + `nodes/*.yaml`)
 * 2. **Single JSON (backward compatible)** — `my-flow.flow.json`
 *
 * @example
 * ```ts
 * import { loadFlowProject, saveFlowProject } from "flow2code/compiler";
 *
 * // Load (auto-detect format)
 * const ir = loadFlowProject("./flows/my-flow");
 *
 * // Save (defaults to split YAML directory)
 * saveFlowProject(ir, "./flows/my-flow");
 *
 * // Force save as .flow.json
 * saveFlowProject(ir, "./flows/my-flow.flow.json", { format: "json" });
 * ```
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join, extname, basename, dirname } from "node:path";
import { splitIR, mergeIR, type SplitFiles } from "./split-storage";
import type { FlowIR } from "../ir/types";

// ── Types ──

export type FlowProjectFormat = "split" | "json";

export interface SaveOptions {
  /** Storage format, default "split" (YAML directory) */
  format?: FlowProjectFormat;
  /** Whether to clean orphaned node files in directory (default true) */
  cleanOrphanNodes?: boolean;
}

export interface FlowProjectInfo {
  /** Actual loaded path */
  path: string;
  /** Detected format */
  format: FlowProjectFormat;
  /** Loaded IR */
  ir: FlowIR;
}

// ── Format Detection ──

/**
 * Detect flow project format from path
 *
 * Detection order:
 * 1. Path ends with `.flow.json` → json
 * 2. Path is a directory containing `meta.yaml` → split
 * 3. Path + `.flow.json` file exists → json
 * 4. Path is a directory (assumed split) → split
 */
export function detectFormat(inputPath: string): { resolvedPath: string; format: FlowProjectFormat } {
  // Case 1: Explicit .flow.json file
  if (inputPath.endsWith(".flow.json") && existsSync(inputPath)) {
    return { resolvedPath: inputPath, format: "json" };
  }

  // Case 2: Directory containing meta.yaml → split
  if (existsSync(inputPath) && statSync(inputPath).isDirectory()) {
    if (existsSync(join(inputPath, "meta.yaml"))) {
      return { resolvedPath: inputPath, format: "split" };
    }
  }

  // Case 3: Appending .flow.json suffix finds a file
  const jsonPath = inputPath.endsWith(".json") ? inputPath : `${inputPath}.flow.json`;
  if (existsSync(jsonPath)) {
    return { resolvedPath: jsonPath, format: "json" };
  }

  // Case 4: Directory exists (may not have meta.yaml yet, treated as split)
  if (existsSync(inputPath) && statSync(inputPath).isDirectory()) {
    return { resolvedPath: inputPath, format: "split" };
  }

  // Default: Path does not exist yet → default to split
  return { resolvedPath: inputPath, format: "split" };
}

// ── Load ──

/**
 * Load Flow project (auto-detect format)
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
    throw new Error(`meta.yaml not found in ${resolvedPath} — not a valid Flow directory`);
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

/**
 * Async version of loadFlowProject — uses fs/promises for non-blocking I/O.
 * Preferred for watch mode to avoid blocking the event loop.
 */
export async function loadFlowProjectAsync(inputPath: string): Promise<FlowProjectInfo> {
  const { resolvedPath, format } = detectFormat(inputPath);

  if (format === "json") {
    if (!existsSync(resolvedPath)) {
      throw new Error(`Flow file not found: ${resolvedPath}`);
    }
    const raw = await readFile(resolvedPath, "utf-8");
    const ir = JSON.parse(raw) as FlowIR;
    return { path: resolvedPath, format, ir };
  }

  // split
  if (!existsSync(resolvedPath)) {
    throw new Error(`Flow directory not found: ${resolvedPath}`);
  }
  const metaPath = join(resolvedPath, "meta.yaml");
  if (!existsSync(metaPath)) {
    throw new Error(`meta.yaml not found in ${resolvedPath} — not a valid Flow directory`);
  }

  const meta = await readFile(metaPath, "utf-8");
  const edgesPath = join(resolvedPath, "edges.yaml");
  const edges = existsSync(edgesPath) ? await readFile(edgesPath, "utf-8") : "";

  const nodesDir = join(resolvedPath, "nodes");
  const nodes = new Map<string, string>();
  if (existsSync(nodesDir)) {
    const nodeFiles = (await readdir(nodesDir)).filter((f) => f.endsWith(".yaml"));
    for (const file of nodeFiles) {
      nodes.set(file, await readFile(join(nodesDir, file), "utf-8"));
    }
  }

  const ir = mergeIR({ meta, edges, nodes });
  return { path: resolvedPath, format, ir };
}

// ── Save ──

/**
 * Save Flow project
 *
 * @param format - Default "split". Pass "json" to save as single .flow.json.
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

  // Clean up orphaned node files (YAML files left after nodes are deleted)
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
 * Migrate .flow.json to split YAML directory
 * Returns list of written files. The original .flow.json is not deleted.
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
