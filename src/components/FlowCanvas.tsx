"use client";

/**
 * Flow2Code 主畫布元件 — Koimsurai 風格
 *
 * 使用 React Flow (@xyflow/react) 建立可互動的視覺化編輯畫布。
 * 深色背景 + 點狀格線 + 發光連線
 */

import { useCallback } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useFlowStore } from "@/store/flow-store";
import FlowNodeComponent from "@/components/nodes/FlowNode";
import NodeLibrary from "@/components/panels/NodeLibrary";
import ConfigPanel from "@/components/panels/ConfigPanel";
import Toolbar from "@/components/panels/Toolbar";

const nodeTypes = {
  flowNode: FlowNodeComponent,
};

export default function FlowCanvas() {
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);
  const onNodesChange = useFlowStore((s) => s.onNodesChange);
  const onEdgesChange = useFlowStore((s) => s.onEdgesChange);
  const onConnect = useFlowStore((s) => s.onConnect);
  const selectNode = useFlowStore((s) => s.selectNode);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      selectNode(node.id);
    },
    [selectNode]
  );

  const handlePaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  return (
    <div className="flex flex-col h-screen w-screen bg-background">
      <Toolbar />

      <div className="flex flex-1 overflow-hidden">
        {/* 左側：節點庫 */}
        <NodeLibrary />

        {/* 中央：畫布 */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={handleNodeClick}
            onPaneClick={handlePaneClick}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            defaultEdgeOptions={{
              animated: true,
              style: { stroke: "oklch(0.65 0.2 260)", strokeWidth: 2 },
            }}
            style={{ background: "transparent" }}
          >
            <Controls
              position="bottom-left"
              className="!bg-card !border-border !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-accent"
              style={{ marginLeft: "1rem", marginBottom: "1rem" }}
            />
            <MiniMap
              position="bottom-right"
              className="!bg-card !border !border-border !rounded-lg !shadow-lg"
              style={{ marginRight: "1rem", marginBottom: "1rem" }}
              maskColor="rgba(0, 0, 0, 0.6)"
              nodeColor={(node) => {
                const data = node.data as { category?: string } | undefined;
                switch (data?.category) {
                  case "trigger": return "#10b981";
                  case "action": return "#3b82f6";
                  case "logic": return "#f59e0b";
                  case "variable": return "#8b5cf6";
                  case "output": return "#f43f5e";
                  default: return "#6b7280";
                }
              }}
            />
            <Background
              variant={BackgroundVariant.Dots}
              gap={20}
              size={1}
              color="oklch(0.3 0 0)"
            />
          </ReactFlow>
        </div>

        {/* 右側：配置面板 */}
        <ConfigPanel />
      </div>
    </div>
  );
}
