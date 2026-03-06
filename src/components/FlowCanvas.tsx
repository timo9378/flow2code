"use client";

/**
 * Flow2Code Main Canvas Component
 *
 * Uses React Flow (@xyflow/react) to build an interactive visual editing canvas.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Controls,
  MiniMap,
  Background,
  BackgroundVariant,
  SelectionMode,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { useFlowStore } from "@/store/flow-store";
import FlowNodeComponent from "@/components/nodes/FlowNode";
import NodeLibrary from "@/components/panels/NodeLibrary";
import ConfigPanel from "@/components/panels/ConfigPanel";
import Toolbar from "@/components/panels/Toolbar";
import WelcomeOverlay from "@/components/panels/WelcomeOverlay";
import { FlowErrorBoundary } from "@/components/FlowErrorBoundary";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useHighlightFromURL } from "@/hooks/use-highlight-from-url";
import { useFlowLint } from "@/hooks/use-flow-lint";

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
  const removeNode = useFlowStore((s) => s.removeNode);
  const removeSelectedNodes = useFlowStore((s) => s.removeSelectedNodes);
  const removeSelectedEdges = useFlowStore((s) => s.removeSelectedEdges);
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const undoFlow = useFlowStore((s) => s.undoFlow);
  const redoFlow = useFlowStore((s) => s.redoFlow);

  const [showWelcome, setShowWelcome] = useState(true);
  const isEmpty = nodes.length === 0;

  // ── Deep link highlight (works with Runtime Tracer) ──
  useHighlightFromURL();

  // ── Live linting (debounced validation for type-mismatch warnings) ──
  useFlowLint();

  // ── Keyboard Shortcuts (capture phase to run before React Flow) ──
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept keyboard when focus is in input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      // Also skip contentEditable
      if ((e.target as HTMLElement)?.isContentEditable) return;

      // Delete / Backspace: delete selected nodes and/or edges
      if (e.key === "Delete" || e.key === "Backspace") {
        const state = useFlowStore.getState();
        const selectedNodeIds = state.getSelectedNodeIds();
        const selectedEdgeIds = state.edges.filter((ed) => ed.selected).map((ed) => ed.id);

        if (selectedNodeIds.length > 0 || selectedEdgeIds.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          removeSelectedNodes(); // Also removes selected edges now
        } else if (selectedNodeId) {
          e.preventDefault();
          e.stopPropagation();
          removeNode(selectedNodeId);
        }
      }

      // Ctrl+Z / Cmd+Z: Undo
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        undoFlow();
      }

      // Ctrl+Shift+Z / Cmd+Shift+Z / Ctrl+Y: Redo
      if (
        ((e.ctrlKey || e.metaKey) && e.key === "z" && e.shiftKey) ||
        ((e.ctrlKey || e.metaKey) && e.key === "y")
      ) {
        e.preventDefault();
        e.stopPropagation();
        redoFlow();
      }
    };

    // Use capture phase so we handle before React Flow
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [selectedNodeId, removeNode, removeSelectedNodes, removeSelectedEdges, undoFlow, redoFlow]);

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
      <ErrorBoundary name="Toolbar">
        <Toolbar />
      </ErrorBoundary>

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Node Library */}
        <ErrorBoundary name="NodeLibrary">
          <NodeLibrary />
        </ErrorBoundary>

        {/* Center: Canvas + Config Panel overlay */}
        <FlowErrorBoundary>
          <div className="flex-1 min-w-0 relative">
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
            panOnDrag={[1]}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            edgesFocusable
            edgesReconnectable
            defaultEdgeOptions={{
              type: "smoothstep",
              animated: false,
              interactionWidth: 20,
              focusable: true,
              style: { stroke: "oklch(0.45 0 0)", strokeWidth: 1.5 },
            }}
            style={{ background: "transparent" }}
          >
            <Controls
              position="bottom-left"
              className="bg-card! border-border! shadow-lg! [&>button]:bg-card! [&>button]:border-border! [&>button]:text-foreground! [&>button:hover]:bg-accent!"
              style={{ marginLeft: "1rem", marginBottom: "1rem" }}
            />
            <MiniMap
              position="bottom-right"
              className="bg-card! border! border-border! rounded-lg! shadow-lg!"
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

          {/* n8n-style overlay config panel */}
          <ErrorBoundary name="ConfigPanel">
            <ConfigPanel />
          </ErrorBoundary>

          {/* Welcome / onboarding overlay (shown when canvas is empty) */}
          {isEmpty && showWelcome && (
            <WelcomeOverlay onDismiss={() => setShowWelcome(false)} />
          )}
        </div>
        </FlowErrorBoundary>
      </div>
    </div>
  );
}
