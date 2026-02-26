/**
 * Flow2Code Split Storage
 * 
 * 解決 keypoint.md #2「JSON Diff Hell」問題。
 * 
 * 將單一 .flow.json 拆分為目錄結構：
 * 
 *   my-flow/
 *   ├── meta.yaml        ← 工作流元資料
 *   ├── edges.yaml        ← 所有連線
 *   └── nodes/
 *       ├── trigger_1.yaml
 *       ├── fetch_1.yaml
 *       └── response_1.yaml
 * 
 * 每個節點是獨立檔案，大幅降低 Git merge conflict 機率。
 */

import { stringify, parse } from "yaml";
import type { FlowIR, FlowNode, FlowEdge } from "../ir/types";

// ============================================================
// 類型定義
// ============================================================

/** 拆分後的檔案結構 */
export interface SplitFiles {
  /** meta.yaml 內容 */
  meta: string;
  /** edges.yaml 內容 */
  edges: string;
  /** 節點檔案：filename → yaml 內容 */
  nodes: Map<string, string>;
}

/** meta.yaml 的結構 */
interface MetaYaml {
  version: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** 節點 ID 列表（保持順序） */
  nodeOrder: string[];
}

// ============================================================
// 拆分：FlowIR → SplitFiles
// ============================================================

/**
 * 將 FlowIR 拆分為多個 YAML 檔案
 */
export function splitIR(ir: FlowIR): SplitFiles {
  // meta.yaml
  const meta: MetaYaml = {
    version: ir.version,
    name: ir.meta.name,
    description: ir.meta.description,
    createdAt: ir.meta.createdAt,
    updatedAt: ir.meta.updatedAt,
    nodeOrder: ir.nodes.map((n) => n.id),
  };

  const metaYaml = addHeader("Flow2Code Meta", stringify(meta, { lineWidth: 120 }));

  // edges.yaml
  const edgesData = ir.edges.map((e) => ({
    id: e.id,
    source: `${e.sourceNodeId}:${e.sourcePortId}`,
    target: `${e.targetNodeId}:${e.targetPortId}`,
  }));

  const edgesYaml = addHeader(
    "Flow2Code Edges",
    stringify(edgesData, { lineWidth: 120 })
  );

  // nodes/*.yaml
  const nodes = new Map<string, string>();
  for (const node of ir.nodes) {
    const filename = `${sanitizeFilename(node.id)}.yaml`;
    const nodeData = {
      id: node.id,
      nodeType: node.nodeType,
      category: node.category,
      label: node.label,
      params: node.params,
      inputs: node.inputs,
      outputs: node.outputs,
    };
    nodes.set(filename, addHeader(`Node: ${node.label}`, stringify(nodeData, { lineWidth: 120 })));
  }

  return { meta: metaYaml, edges: edgesYaml, nodes };
}

// ============================================================
// 合併：SplitFiles → FlowIR
// ============================================================

/**
 * 將 YAML 檔案合併為 FlowIR
 */
export function mergeIR(files: SplitFiles): FlowIR {
  const meta = parse(files.meta) as MetaYaml;

  // 解析所有節點
  const nodeMap = new Map<string, FlowNode>();
  for (const [_filename, yaml] of files.nodes) {
    const node = parse(yaml) as FlowNode;
    nodeMap.set(node.id, node);
  }

  // 按 meta.nodeOrder 排列（缺少的節點放最後）
  const orderedNodes: FlowNode[] = [];
  const seen = new Set<string>();

  if (meta.nodeOrder) {
    for (const id of meta.nodeOrder) {
      const node = nodeMap.get(id);
      if (node) {
        orderedNodes.push(node);
        seen.add(id);
      }
    }
  }

  // 加入不在 nodeOrder 中的節點
  for (const [id, node] of nodeMap) {
    if (!seen.has(id)) {
      orderedNodes.push(node);
    }
  }

  // 解析邊
  const edgesRaw = parse(files.edges) as Array<{
    id: string;
    source: string;
    target: string;
  }>;

  const edges: FlowEdge[] = (edgesRaw ?? []).map((e) => {
    const [sourceNodeId, sourcePortId] = e.source.split(":");
    const [targetNodeId, targetPortId] = e.target.split(":");
    return {
      id: e.id,
      sourceNodeId,
      sourcePortId,
      targetNodeId,
      targetPortId,
    };
  });

  return {
    version: meta.version as "1.0.0",
    meta: {
      name: meta.name,
      description: meta.description,
      createdAt: meta.createdAt,
      updatedAt: meta.updatedAt,
    },
    nodes: orderedNodes,
    edges,
  };
}

// ============================================================
// 檔案系統操作（供 CLI 使用）
// ============================================================

/**
 * 將 FlowIR 寫入目錄
 */
export function splitToFileSystem(
  ir: FlowIR,
  dirPath: string,
  fs: {
    mkdirSync: (path: string, opts?: { recursive: boolean }) => void;
    writeFileSync: (path: string, content: string) => void;
  },
  path: { join: (...args: string[]) => string }
): string[] {
  const files = splitIR(ir);
  const written: string[] = [];

  // 確保目錄存在
  fs.mkdirSync(dirPath, { recursive: true });
  const nodesDir = path.join(dirPath, "nodes");
  fs.mkdirSync(nodesDir, { recursive: true });

  // 寫入 meta.yaml
  const metaPath = path.join(dirPath, "meta.yaml");
  fs.writeFileSync(metaPath, files.meta);
  written.push(metaPath);

  // 寫入 edges.yaml
  const edgesPath = path.join(dirPath, "edges.yaml");
  fs.writeFileSync(edgesPath, files.edges);
  written.push(edgesPath);

  // 寫入 nodes/*.yaml
  for (const [filename, content] of files.nodes) {
    const nodePath = path.join(nodesDir, filename);
    fs.writeFileSync(nodePath, content);
    written.push(nodePath);
  }

  return written;
}

/**
 * 從目錄讀取為 FlowIR
 */
export function mergeFromFileSystem(
  dirPath: string,
  fs: {
    readFileSync: (path: string, encoding: string) => string;
    readdirSync: (path: string) => string[];
    existsSync: (path: string) => boolean;
  },
  path: { join: (...args: string[]) => string }
): FlowIR {
  const metaPath = path.join(dirPath, "meta.yaml");
  const edgesPath = path.join(dirPath, "edges.yaml");
  const nodesDir = path.join(dirPath, "nodes");

  if (!fs.existsSync(metaPath)) {
    throw new Error(`meta.yaml not found in ${dirPath}`);
  }

  const meta = fs.readFileSync(metaPath, "utf-8");
  const edges = fs.existsSync(edgesPath)
    ? fs.readFileSync(edgesPath, "utf-8")
    : "";

  const nodes = new Map<string, string>();
  if (fs.existsSync(nodesDir)) {
    const nodeFiles = fs.readdirSync(nodesDir).filter((f: string) => f.endsWith(".yaml"));
    for (const file of nodeFiles) {
      const content = fs.readFileSync(path.join(nodesDir, file), "utf-8");
      nodes.set(file, content);
    }
  }

  return mergeIR({ meta, edges, nodes });
}

// ============================================================
// 輔助函式
// ============================================================

function addHeader(title: string, content: string): string {
  return `# ${title}\n# Generated by Flow2Code\n\n${content}`;
}

function sanitizeFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}
