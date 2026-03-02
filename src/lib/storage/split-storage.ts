/**
 * Flow2Code Split Storage
 * 
 * Solves keypoint.md #2 "JSON Diff Hell" problem.
 * 
 * Splits a single .flow.json into a directory structure:
 * 
 *   my-flow/
 *   ├── meta.yaml        ← Workflow metadata
 *   ├── edges.yaml        ← All edges
 *   └── nodes/
 *       ├── trigger_1.yaml
 *       ├── fetch_1.yaml
 *       └── response_1.yaml
 * 
 * Each node is an independent file, greatly reducing Git merge conflict probability.
 */

import { stringify, parse } from "yaml";
import type { FlowIR, FlowNode, FlowEdge } from "../ir/types";

// ============================================================
// Type Definitions
// ============================================================

/** Split file structure */
export interface SplitFiles {
  /** meta.yaml content */
  meta: string;
  /** edges.yaml content */
  edges: string;
  /** Node files: filename → yaml content */
  nodes: Map<string, string>;
}

/** meta.yaml structure */
interface MetaYaml {
  version: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Node ID list (preserving order) */
  nodeOrder: string[];
}

// ============================================================
// Split: FlowIR → SplitFiles
// ============================================================

/**
 * Split FlowIR into multiple YAML files
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
// Merge: SplitFiles → FlowIR
// ============================================================

/**
 * Merge YAML files into FlowIR
 */
export function mergeIR(files: SplitFiles): FlowIR {
  const meta = parse(files.meta) as MetaYaml;

  // Parse all nodes
  const nodeMap = new Map<string, FlowNode>();
  for (const [_filename, yaml] of files.nodes) {
    const node = parse(yaml) as FlowNode;
    nodeMap.set(node.id, node);
  }

  // Arrange by meta.nodeOrder (missing nodes placed at the end)
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

  // Add nodes not in nodeOrder
  for (const [id, node] of nodeMap) {
    if (!seen.has(id)) {
      orderedNodes.push(node);
    }
  }

  // Parse edges
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
// File System Operations (for CLI use)
// ============================================================

/**
 * Write FlowIR to directory
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

  // Ensure directory exists
  fs.mkdirSync(dirPath, { recursive: true });
  const nodesDir = path.join(dirPath, "nodes");
  fs.mkdirSync(nodesDir, { recursive: true });

  // Write meta.yaml
  const metaPath = path.join(dirPath, "meta.yaml");
  fs.writeFileSync(metaPath, files.meta);
  written.push(metaPath);

  // Write edges.yaml
  const edgesPath = path.join(dirPath, "edges.yaml");
  fs.writeFileSync(edgesPath, files.edges);
  written.push(edgesPath);

  // Write nodes/*.yaml
  for (const [filename, content] of files.nodes) {
    const nodePath = path.join(nodesDir, filename);
    fs.writeFileSync(nodePath, content);
    written.push(nodePath);
  }

  return written;
}

/**
 * Read FlowIR from directory
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
// Helper Functions
// ============================================================

function addHeader(title: string, content: string): string {
  return `# ${title}\n# Generated by Flow2Code\n\n${content}`;
}

function sanitizeFilename(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}
