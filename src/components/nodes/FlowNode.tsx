"use client";

/**
 * Flow2Code 統一自定義節點元件 — 暗色主題版
 *
 * 節點的卡片使用半透明暗色搭配分類色彩的頂部飾條。
 */

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { FlowNodeData } from "@/store/flow-store";
import { NodeCategory } from "@/lib/ir/types";

// 分類色彩 — 暗色變體（與 Koimsurai 深色背景搭配）
const categoryStyles: Record<NodeCategory, { accent: string; bg: string; text: string; handleIn: string; handleOut: string }> = {
  [NodeCategory.TRIGGER]: {
    accent: "bg-emerald-500",
    bg: "bg-emerald-500/5 border-emerald-500/20",
    text: "text-emerald-400",
    handleIn: "#10b981",
    handleOut: "#10b981",
  },
  [NodeCategory.ACTION]: {
    accent: "bg-blue-500",
    bg: "bg-blue-500/5 border-blue-500/20",
    text: "text-blue-400",
    handleIn: "#3b82f6",
    handleOut: "#3b82f6",
  },
  [NodeCategory.LOGIC]: {
    accent: "bg-amber-500",
    bg: "bg-amber-500/5 border-amber-500/20",
    text: "text-amber-400",
    handleIn: "#f59e0b",
    handleOut: "#f59e0b",
  },
  [NodeCategory.VARIABLE]: {
    accent: "bg-purple-500",
    bg: "bg-purple-500/5 border-purple-500/20",
    text: "text-purple-400",
    handleIn: "#8b5cf6",
    handleOut: "#8b5cf6",
  },
  [NodeCategory.OUTPUT]: {
    accent: "bg-rose-500",
    bg: "bg-rose-500/5 border-rose-500/20",
    text: "text-rose-400",
    handleIn: "#f43f5e",
    handleOut: "#f43f5e",
  },
};

const categoryIcons: Record<NodeCategory, string> = {
  [NodeCategory.TRIGGER]: "⚡",
  [NodeCategory.ACTION]: "🔧",
  [NodeCategory.LOGIC]: "🔀",
  [NodeCategory.VARIABLE]: "📦",
  [NodeCategory.OUTPUT]: "📤",
};

type FlowNodeType = Node<FlowNodeData>;

function FlowNodeComponent({ data, selected }: NodeProps<FlowNodeType>) {
  const style = categoryStyles[data.category] ?? categoryStyles[NodeCategory.ACTION];
  const icon = categoryIcons[data.category] ?? "📦";

  return (
    <div
      className={`
        rounded-lg border min-w-[200px] max-w-[280px] backdrop-blur-sm
        ${style.bg}
        ${selected ? "ring-2 ring-primary/50 shadow-lg shadow-primary/10" : "shadow-md shadow-black/30"}
        transition-all duration-200
      `}
    >
      {/* 頂部色條 */}
      <div className={`h-1 ${style.accent} rounded-t-lg`} />

      {/* Header */}
      <div className="px-3 py-2 flex items-center gap-1.5">
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold text-foreground truncate flex-1">
          {data.label}
        </span>
        <span className={`text-[9px] uppercase font-medium ${style.text}`}>
          {data.category}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 pb-2">
        <span className="font-mono text-[10px] text-muted-foreground">{data.nodeType}</span>
      </div>

      {/* 輸入 Handles */}
      {(data.inputs ?? []).map((input, i) => (
        <Handle
          key={`input-${input.id}`}
          type="target"
          position={Position.Left}
          id={input.id}
          style={{
            top: `${36 + i * 20}px`,
            background: style.handleIn,
            width: 9,
            height: 9,
            border: "2px solid rgba(0,0,0,0.4)",
            boxShadow: `0 0 4px ${style.handleIn}40`,
          }}
          title={`${input.label} (${input.dataType})`}
        />
      ))}

      {/* 輸出 Handles */}
      {(data.outputs ?? []).map((output, i) => (
        <Handle
          key={`output-${output.id}`}
          type="source"
          position={Position.Right}
          id={output.id}
          style={{
            top: `${36 + i * 20}px`,
            background: style.handleOut,
            width: 9,
            height: 9,
            border: "2px solid rgba(0,0,0,0.4)",
            boxShadow: `0 0 4px ${style.handleOut}40`,
          }}
          title={`${output.label} (${output.dataType})`}
        />
      ))}
    </div>
  );
}

export default memo(FlowNodeComponent);
