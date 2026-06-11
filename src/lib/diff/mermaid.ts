/**
 * FlowIR → Mermaid flowchart renderer
 *
 * Produces GitHub-renderable `flowchart TD` markup so flow graphs can be
 * embedded directly in PR comments and Markdown docs. Nodes can be
 * highlighted (added / modified) for diff visualization.
 */

import type { FlowIR, FlowNode } from "../ir/types";
import { NodeCategory } from "../ir/types";

export interface MermaidOptions {
  /** Node IDs to highlight as added (green) */
  addedNodeIds?: Set<string>;
  /** Node IDs to highlight as modified (amber) */
  modifiedNodeIds?: Set<string>;
  /** Maximum nodes before falling back to a truncation note (default 40) */
  maxNodes?: number;
}

/** Mermaid chokes on quotes/brackets inside labels — keep them readable but safe. */
function escapeLabel(label: string): string {
  return label
    .replace(/"/g, "'")
    .replace(/[[\]{}()]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function nodeShape(node: FlowNode, label: string): string {
  switch (node.category) {
    case NodeCategory.TRIGGER:
      return `(["${label}"])`;
    case NodeCategory.LOGIC:
      return `{"${label}"}`;
    case NodeCategory.OUTPUT:
      return `[/"${label}"/]`;
    default:
      return `["${label}"]`;
  }
}

/**
 * Renders a FlowIR as a Mermaid flowchart.
 * Returns null when the graph exceeds maxNodes (caller should fall back to text).
 */
export function toMermaid(ir: FlowIR, options: MermaidOptions = {}): string | null {
  const { addedNodeIds, modifiedNodeIds, maxNodes = 40 } = options;
  if (ir.nodes.length === 0 || ir.nodes.length > maxNodes) return null;

  const lines: string[] = ["flowchart TD"];

  for (const node of ir.nodes) {
    const label = escapeLabel(node.label || node.nodeType);
    lines.push(`  ${node.id}${nodeShape(node, label)}`);
  }

  const seen = new Set<string>();
  for (const edge of ir.edges) {
    const key = `${edge.sourceNodeId}->${edge.targetNodeId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`  ${edge.sourceNodeId} --> ${edge.targetNodeId}`);
  }

  const added = [...(addedNodeIds ?? [])].filter((id) => ir.nodes.some((n) => n.id === id));
  const modified = [...(modifiedNodeIds ?? [])].filter((id) => ir.nodes.some((n) => n.id === id));
  if (added.length > 0 || modified.length > 0) {
    lines.push("  classDef added fill:#16a34a,stroke:#166534,color:#ffffff");
    lines.push("  classDef modified fill:#d97706,stroke:#92400e,color:#ffffff");
    if (added.length > 0) lines.push(`  class ${added.join(",")} added`);
    if (modified.length > 0) lines.push(`  class ${modified.join(",")} modified`);
  }

  return lines.join("\n");
}
