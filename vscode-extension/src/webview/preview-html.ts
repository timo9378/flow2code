/**
 * Flow Preview Webview HTML
 *
 * Generates a self-contained HTML page that renders a FlowIR document
 * as an interactive DAG diagram using SVG + CSS.
 */

import type * as vscode from "vscode";
import type { FlowIR, FlowNode, FlowEdge, NodeId } from "@/lib/ir/types";

// ── Layout Types ──

interface LayoutNode {
  id: string;
  label: string;
  nodeType: string;
  category: string;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayoutEdge {
  sourceId: string;
  targetId: string;
}

// ── Layout Algorithm ──

function computeLayout(ir: FlowIR): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  const NODE_WIDTH = 200;
  const NODE_HEIGHT = 60;
  const LAYER_GAP = 100;
  const NODE_GAP = 40;

  // Build adjacency for topological layering
  const adj = new Map<NodeId, NodeId[]>();
  const inDegree = new Map<NodeId, number>();
  for (const node of ir.nodes) {
    adj.set(node.id, []);
    inDegree.set(node.id, 0);
  }
  for (const edge of ir.edges) {
    adj.get(edge.sourceNodeId)?.push(edge.targetNodeId);
    inDegree.set(
      edge.targetNodeId,
      (inDegree.get(edge.targetNodeId) ?? 0) + 1
    );
  }

  // Assign layers via BFS (Coffman-Graham-like)
  const layer = new Map<NodeId, number>();
  const queue: NodeId[] = [];
  for (const node of ir.nodes) {
    if ((inDegree.get(node.id) ?? 0) === 0) {
      queue.push(node.id);
      layer.set(node.id, 0);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layer.get(current) ?? 0;
    for (const neighbor of adj.get(current) ?? []) {
      const newLayer = currentLayer + 1;
      if ((layer.get(neighbor) ?? -1) < newLayer) {
        layer.set(neighbor, newLayer);
      }
      const deg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, deg);
      if (deg === 0) queue.push(neighbor);
    }
  }

  // Assign remaining unvisited nodes (disconnected) to layer 0
  for (const node of ir.nodes) {
    if (!layer.has(node.id)) layer.set(node.id, 0);
  }

  // Group nodes by layer
  const layers = new Map<number, FlowNode[]>();
  for (const node of ir.nodes) {
    const l = layer.get(node.id) ?? 0;
    if (!layers.has(l)) layers.set(l, []);
    layers.get(l)!.push(node);
  }

  // Compute positions
  const layoutNodes: LayoutNode[] = [];
  const maxLayer = Math.max(...layers.keys(), 0);

  for (let l = 0; l <= maxLayer; l++) {
    const nodesInLayer = layers.get(l) ?? [];
    const totalWidth =
      nodesInLayer.length * NODE_WIDTH +
      (nodesInLayer.length - 1) * NODE_GAP;
    const startX = -totalWidth / 2;

    nodesInLayer.forEach((node, i) => {
      layoutNodes.push({
        id: node.id,
        label: node.label ?? node.id,
        nodeType: node.nodeType,
        category: node.category,
        layer: l,
        x: startX + i * (NODE_WIDTH + NODE_GAP),
        y: l * (NODE_HEIGHT + LAYER_GAP),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  }

  const layoutEdges: LayoutEdge[] = ir.edges.map((e) => ({
    sourceId: e.sourceNodeId,
    targetId: e.targetNodeId,
  }));

  return { nodes: layoutNodes, edges: layoutEdges };
}

// ── Category Colors ──

const CATEGORY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  trigger: { bg: "#1a3a4a", border: "#4fc3f7", text: "#b3e5fc" },
  action: { bg: "#1a3a2a", border: "#81c784", text: "#c8e6c9" },
  logic: { bg: "#3a2a4a", border: "#ba68c8", text: "#e1bee7" },
  variable: { bg: "#3a3a1a", border: "#ffd54f", text: "#fff9c4" },
  output: { bg: "#3a2a1a", border: "#ffb74d", text: "#ffe0b2" },
};

const DEFAULT_COLOR = { bg: "#2d2d2d", border: "#888888", text: "#d4d4d4" };

// ── HTML Generator ──

export function getPreviewHtml(
  ir: FlowIR,
  _webview: vscode.Webview,
  _context: vscode.ExtensionContext
): string {
  const layout = computeLayout(ir);

  // Compute canvas bounds
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of layout.nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  const padding = 80;
  minX -= padding;
  minY -= padding;
  maxX += padding;
  maxY += padding;
  const svgWidth = maxX - minX;
  const svgHeight = maxY - minY;

  // Build node lookup for edge rendering
  const nodeMap = new Map(layout.nodes.map((n) => [n.id, n]));

  // Generate node SVG elements
  const nodeSvg = layout.nodes
    .map((n) => {
      const colors = CATEGORY_COLORS[n.category] ?? DEFAULT_COLOR;
      const rx = n.category === "trigger" ? 20 : 8;
      const escapedLabel = escapeHtml(truncate(n.label, 24));
      const escapedType = escapeHtml(n.nodeType);
      return `
      <g class="node" data-id="${escapeHtml(n.id)}" transform="translate(${n.x - minX},${n.y - minY})">
        <rect width="${n.width}" height="${n.height}" rx="${rx}" ry="${rx}"
              fill="${colors.bg}" stroke="${colors.border}" stroke-width="2"/>
        <text x="${n.width / 2}" y="24" text-anchor="middle"
              fill="${colors.text}" font-size="13" font-weight="600">${escapedLabel}</text>
        <text x="${n.width / 2}" y="44" text-anchor="middle"
              fill="${colors.text}" font-size="10" opacity="0.6">${escapedType}</text>
      </g>`;
    })
    .join("\n");

  // Generate edge SVG elements (curved arrows)
  const edgeSvg = layout.edges
    .map((e) => {
      const src = nodeMap.get(e.sourceId);
      const tgt = nodeMap.get(e.targetId);
      if (!src || !tgt) return "";

      const x1 = src.x - minX + src.width / 2;
      const y1 = src.y - minY + src.height;
      const x2 = tgt.x - minX + tgt.width / 2;
      const y2 = tgt.y - minY;

      // Bezier control points for smooth curves
      const cy1 = y1 + (y2 - y1) * 0.4;
      const cy2 = y1 + (y2 - y1) * 0.6;

      return `
      <path d="M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}"
            fill="none" stroke="#666" stroke-width="1.5"
            marker-end="url(#arrowhead)"/>`;
    })
    .join("\n");

  const flowName = escapeHtml(ir.meta?.name ?? "Untitled Flow");
  const nodeCount = ir.nodes.length;
  const edgeCount = ir.edges.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Flow Preview: ${flowName}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #1e1e1e;
      color: #cccccc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      overflow: hidden;
      height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: #252526;
      border-bottom: 1px solid #3c3c3c;
      font-size: 12px;
      flex-shrink: 0;
    }
    .toolbar .title {
      font-weight: 600;
      font-size: 13px;
      color: #e0e0e0;
    }
    .toolbar .stats {
      opacity: 0.7;
    }
    .zoom-controls {
      display: flex;
      gap: 4px;
    }
    .zoom-controls button {
      background: #3c3c3c;
      border: 1px solid #555;
      color: #ccc;
      padding: 2px 8px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
    }
    .zoom-controls button:hover {
      background: #505050;
    }
    .canvas-container {
      flex: 1;
      overflow: hidden;
      cursor: grab;
      position: relative;
    }
    .canvas-container:active { cursor: grabbing; }
    svg.flow-graph {
      position: absolute;
      top: 0;
      left: 0;
      transform-origin: 0 0;
    }
    .node { cursor: pointer; }
    .node:hover rect {
      stroke-width: 3;
      filter: brightness(1.2);
    }
    .node:hover text { fill: #ffffff; }
    .tooltip {
      position: fixed;
      background: #333;
      color: #eee;
      padding: 6px 10px;
      border-radius: 4px;
      font-size: 11px;
      pointer-events: none;
      z-index: 100;
      display: none;
      max-width: 300px;
      white-space: pre-wrap;
      border: 1px solid #555;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <span class="title">📊 ${flowName}</span>
    <span class="stats">${nodeCount} nodes · ${edgeCount} edges</span>
    <div class="zoom-controls">
      <button onclick="zoom(-0.1)">−</button>
      <button onclick="resetView()">Fit</button>
      <button onclick="zoom(0.1)">+</button>
    </div>
  </div>
  <div class="canvas-container" id="canvas">
    <svg class="flow-graph" id="graph"
         width="${svgWidth}" height="${svgHeight}"
         viewBox="0 0 ${svgWidth} ${svgHeight}">
      <defs>
        <marker id="arrowhead" markerWidth="8" markerHeight="6"
                refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <polygon points="0 0, 8 3, 0 6" fill="#666"/>
        </marker>
      </defs>
      <g class="edges">${edgeSvg}</g>
      <g class="nodes">${nodeSvg}</g>
    </svg>
  </div>
  <div class="tooltip" id="tooltip"></div>
  <script>
    const container = document.getElementById('canvas');
    const svg = document.getElementById('graph');
    const tooltip = document.getElementById('tooltip');

    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let isDragging = false;
    let lastX = 0, lastY = 0;

    function updateTransform() {
      svg.style.transform = 'translate(' + translateX + 'px,' + translateY + 'px) scale(' + scale + ')';
    }

    function zoom(delta) {
      scale = Math.max(0.2, Math.min(3, scale + delta));
      updateTransform();
    }

    function resetView() {
      const rect = container.getBoundingClientRect();
      const sx = rect.width / ${svgWidth};
      const sy = rect.height / ${svgHeight};
      scale = Math.min(sx, sy, 1) * 0.9;
      translateX = (rect.width - ${svgWidth} * scale) / 2;
      translateY = (rect.height - ${svgHeight} * scale) / 2;
      updateTransform();
    }

    // Pan
    container.addEventListener('mousedown', (e) => {
      isDragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    });
    window.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      translateX += e.clientX - lastX;
      translateY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      updateTransform();
    });
    window.addEventListener('mouseup', () => { isDragging = false; });

    // Zoom with wheel
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      scale = Math.max(0.2, Math.min(3, scale + delta));
      updateTransform();
    }, { passive: false });

    // Tooltips
    document.querySelectorAll('.node').forEach((el) => {
      el.addEventListener('mouseenter', (e) => {
        const id = el.getAttribute('data-id');
        tooltip.textContent = 'ID: ' + id;
        tooltip.style.display = 'block';
      });
      el.addEventListener('mousemove', (e) => {
        tooltip.style.left = (e.clientX + 12) + 'px';
        tooltip.style.top = (e.clientY + 12) + 'px';
      });
      el.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
      });
    });

    // Fit on load
    requestAnimationFrame(resetView);
  </script>
</body>
</html>`;
}

// ── Helpers ──

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function truncate(str: string, max: number): string {
  return str.length <= max ? str : str.slice(0, max - 1) + "…";
}
