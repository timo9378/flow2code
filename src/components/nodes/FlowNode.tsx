"use client";

/**
 * Flow2Code 統一自定義節點元件
 * 
 * 根據 nodeType 與 category 動態渲染不同外觀，
 * 同時處理連線端口 (Handle) 的生成。
 */

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { FlowNodeData } from "@/store/flow-store";
import { NodeCategory } from "@/lib/ir/types";

// 分類顏色映射
const categoryColors: Record<NodeCategory, { bg: string; border: string; header: string }> = {
  [NodeCategory.TRIGGER]: {
    bg: "bg-emerald-50",
    border: "border-emerald-500",
    header: "bg-emerald-500",
  },
  [NodeCategory.ACTION]: {
    bg: "bg-blue-50",
    border: "border-blue-500",
    header: "bg-blue-500",
  },
  [NodeCategory.LOGIC]: {
    bg: "bg-amber-50",
    border: "border-amber-500",
    header: "bg-amber-500",
  },
  [NodeCategory.VARIABLE]: {
    bg: "bg-purple-50",
    border: "border-purple-500",
    header: "bg-purple-500",
  },
  [NodeCategory.OUTPUT]: {
    bg: "bg-rose-50",
    border: "border-rose-500",
    header: "bg-rose-500",
  },
};

// 分類圖示
const categoryIcons: Record<NodeCategory, string> = {
  [NodeCategory.TRIGGER]: "⚡",
  [NodeCategory.ACTION]: "🔧",
  [NodeCategory.LOGIC]: "🔀",
  [NodeCategory.VARIABLE]: "📦",
  [NodeCategory.OUTPUT]: "📤",
};

type FlowNodeType = Node<FlowNodeData>;

function FlowNodeComponent({ data, selected }: NodeProps<FlowNodeType>) {
  const colors = categoryColors[data.category] ?? categoryColors[NodeCategory.ACTION];
  const icon = categoryIcons[data.category] ?? "📦";

  return (
    <div
      className={`
        rounded-lg shadow-md border-2 min-w-[200px] max-w-[280px]
        ${colors.bg} ${colors.border}
        ${selected ? "ring-2 ring-offset-2 ring-blue-400" : ""}
        transition-shadow duration-200
      `}
    >
      {/* Header */}
      <div
        className={`
          ${colors.header} text-white text-xs font-semibold 
          px-3 py-1.5 rounded-t-md flex items-center gap-1.5
        `}
      >
        <span>{icon}</span>
        <span className="truncate">{data.label}</span>
        <span className="ml-auto text-[10px] opacity-75 uppercase">
          {data.category}
        </span>
      </div>

      {/* Body */}
      <div className="px-3 py-2 text-xs text-gray-600">
        <span className="font-mono text-[10px] opacity-60">{data.nodeType}</span>
      </div>

      {/* 輸入 Handles */}
      {data.inputs.map((input, i) => (
        <Handle
          key={`input-${input.id}`}
          type="target"
          position={Position.Left}
          id={input.id}
          style={{
            top: `${40 + i * 20}px`,
            background: "#6366f1",
            width: 10,
            height: 10,
            border: "2px solid white",
          }}
          title={`${input.label} (${input.dataType})`}
        />
      ))}

      {/* 輸出 Handles */}
      {data.outputs.map((output, i) => (
        <Handle
          key={`output-${output.id}`}
          type="source"
          position={Position.Right}
          id={output.id}
          style={{
            top: `${40 + i * 20}px`,
            background: "#f59e0b",
            width: 10,
            height: 10,
            border: "2px solid white",
          }}
          title={`${output.label} (${output.dataType})`}
        />
      ))}
    </div>
  );
}

export default memo(FlowNodeComponent);
