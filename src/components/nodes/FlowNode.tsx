"use client";

/**
 * Flow2Code Node Component
 *
 * Minimal card design with left color bar, clean typography, and
 * properly spaced connection handles.
 */

import { memo } from "react";
import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { FlowNodeData } from "@/store/flow-store";
import { useFlowStore } from "@/store/flow-store";
import { NodeCategory } from "@/lib/ir/types";

// ── Category Theme ──
// Each category gets a single accent color used for the side bar and handles.
const theme: Record<NodeCategory, { bar: string; color: string }> = {
  [NodeCategory.TRIGGER]:  { bar: "#22c55e", color: "#22c55e" },
  [NodeCategory.ACTION]:   { bar: "#3b82f6", color: "#3b82f6" },
  [NodeCategory.LOGIC]:    { bar: "#eab308", color: "#eab308" },
  [NodeCategory.VARIABLE]: { bar: "#a855f7", color: "#a855f7" },
  [NodeCategory.OUTPUT]:   { bar: "#f43f5e", color: "#f43f5e" },
};

const categoryTag: Record<NodeCategory, string> = {
  [NodeCategory.TRIGGER]:  "TRIGGER",
  [NodeCategory.ACTION]:   "ACTION",
  [NodeCategory.LOGIC]:    "LOGIC",
  [NodeCategory.VARIABLE]: "VARIABLE",
  [NodeCategory.OUTPUT]:   "OUTPUT",
};

type FlowNodeType = Node<FlowNodeData>;

const EMPTY_BADGES: import("@/store/flow-store").NodeBadge[] = [];

function FlowNodeComponent({ id, data, selected }: NodeProps<FlowNodeType>) {
  const t = theme[data.category] ?? theme[NodeCategory.ACTION];
  const tag = categoryTag[data.category] ?? "NODE";
  const inputs = data.inputs ?? [];
  const outputs = data.outputs ?? [];
  const portRows = Math.max(inputs.length, outputs.length, 0);

  // Visual Source Map: read badges for this node (stable ref to avoid infinite re-renders)
  const badges = useFlowStore((s) => s.nodeBadges[id] ?? EMPTY_BADGES);
  const hasError = badges.some((b) => b.type === "error");
  const hasWarning = badges.some((b) => b.type === "warning");

  return (
    <div
      className="flex group"
      style={{
        minWidth: 220,
        maxWidth: 300,
        ...(hasError
          ? { filter: "drop-shadow(0 0 6px rgba(239,68,68,0.7))" }
          : hasWarning
            ? { filter: "drop-shadow(0 0 6px rgba(234,179,8,0.5))" }
            : {}),
      }}
    >
      {/* Left color bar */}
      <div
        className="w-[3px] rounded-l-md shrink-0"
        style={{ background: t.bar }}
      />

      {/* Card body */}
      <div
        className={[
          "flex-1 rounded-r-md border border-l-0",
          "bg-[oklch(0.17_0_0)] border-[oklch(0.25_0_0)]",
          selected
            ? "ring-1 ring-white/20 border-[oklch(0.35_0_0)]"
            : "",
          "transition-[border-color,box-shadow] duration-150",
        ].join(" ")}
      >
        {/* Header row */}
        <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1">
          <span className="text-[13px] font-medium text-[oklch(0.93_0_0)] leading-tight truncate">
            {data.label}
          </span>
          <span
            className="text-[9px] tracking-wider font-semibold shrink-0 px-1.5 py-0.5 rounded"
            style={{
              color: t.color,
              background: `color-mix(in oklch, ${t.color} 12%, transparent)`,
            }}
          >
            {tag}
          </span>
        </div>

        {/* Type label */}
        <div className="px-3 pb-1.5">
          <span className="font-mono text-[11px] text-[oklch(0.5_0_0)]">
            {data.nodeType}
          </span>
        </div>

        {/* Port labels (when ports exist) */}
        {portRows > 0 && (
          <div className="border-t border-[oklch(0.22_0_0)] px-3 py-1.5 flex flex-col gap-0.5">
            {Array.from({ length: portRows }, (_, i) => (
              <div key={i} className="flex items-center justify-between text-[10px] text-[oklch(0.55_0_0)]">
                <span>{inputs[i]?.label ?? ""}</span>
                <span>{outputs[i]?.label ?? ""}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Handles ── */}
      {inputs.map((input, i) => {
        // Position handles in the port area if it exists, otherwise in the header
        const top = portRows > 0
          ? `calc(56px + ${i * 16}px + 8px)` // aligned to port label rows
          : `${28 + i * 18}px`;
        return (
          <Handle
            key={`in-${input.id}`}
            type="target"
            position={Position.Left}
            id={input.id}
            style={{
              top,
              left: -1,
              width: 8,
              height: 8,
              borderRadius: 2,
              background: t.color,
              border: "none",
            }}
            title={`${input.label} (${input.dataType})`}
          />
        );
      })}

      {outputs.map((output, i) => {
        const top = portRows > 0
          ? `calc(56px + ${i * 16}px + 8px)`
          : `${28 + i * 18}px`;
        return (
          <Handle
            key={`out-${output.id}`}
            type="source"
            position={Position.Right}
            id={output.id}
            style={{
              top,
              right: -1,
              width: 8,
              height: 8,
              borderRadius: 2,
              background: t.color,
              border: "none",
            }}
            title={`${output.label} (${output.dataType})`}
          />
        );
      })}

      {/* Visual Source Map: error/warning badges */}
      {badges.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: -8,
            right: -8,
            display: "flex",
            gap: 2,
          }}
        >
          {hasError && (
            <span
              title={badges.filter((b) => b.type === "error").map((b) => b.message).join("\n")}
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#ef4444",
                color: "#fff",
                fontSize: 10,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "default",
              }}
            >
              !
            </span>
          )}
          {hasWarning && !hasError && (
            <span
              title={badges.filter((b) => b.type === "warning").map((b) => b.message).join("\n")}
              style={{
                width: 16,
                height: 16,
                borderRadius: "50%",
                background: "#eab308",
                color: "#000",
                fontSize: 10,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: "default",
              }}
            >
              ⚠
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(FlowNodeComponent);
