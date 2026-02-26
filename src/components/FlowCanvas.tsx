"use client";

/**
 * Flow2Code 主畫布元件
 * 
 * 使用 React Flow (@xyflow/react) 建立可互動的視覺化編輯畫布。
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

// 自定義節點類型映射（在元件外部定義以避免重新渲染）
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
    <div className="flex flex-col h-screen w-screen">
      <Toolbar />

      <div className="flex flex-1 overflow-hidden">
        {/* 左側：節點庫 */}
        <NodeLibrary />

        {/* 中央：畫布 */}
        <div className="flex-1 bg-gray-950">
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
              style: { stroke: "#6366f1", strokeWidth: 2 },
            }}
          >
            <Controls
              position="bottom-left"
              style={{ marginLeft: "1rem", marginBottom: "1rem" }}
            />
            <MiniMap
              position="bottom-right"
              style={{ marginRight: "1rem", marginBottom: "1rem" }}
              nodeColor={(node) => {
                const data = node.data as { category?: string } | undefined;
                switch (data?.category) {
                  case "trigger":
                    return "#10b981";
                  case "action":
                    return "#3b82f6";
                  case "logic":
                    return "#f59e0b";
                  case "variable":
                    return "#8b5cf6";
                  case "output":
                    return "#f43f5e";
                  default:
                    return "#6b7280";
                }
              }}
            />
            <Background
              variant={BackgroundVariant.Dots}
              gap={16}
              size={1}
              color="#374151"
            />
          </ReactFlow>
        </div>

        {/* 右側：配置面板 */}
        <ConfigPanel />
      </div>
    </div>
  );
}
