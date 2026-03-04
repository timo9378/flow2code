"use client";

/**
 * History Panel — Flow state timeline
 *
 * Shows labeled snapshots of the flow state over time.
 * Users can restore any previous state (AI generations, file loads, manual saves).
 */

import { useFlowStore } from "@/store/flow-store";
import type { HistoryEntry } from "@/store/flow-store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function HistoryEntryItem({
  entry,
  onRestore,
}: {
  entry: HistoryEntry;
  onRestore: (id: string) => void;
}) {
  // Detect entry type from label
  const isAI = entry.label.toLowerCase().includes("ai") || entry.label.includes("loading");
  const isReset = entry.label.toLowerCase().includes("reset");
  const isRestore = entry.label.toLowerCase().includes("restore");

  const icon = isAI ? "✨" : isReset ? "🗑️" : isRestore ? "⏪" : "💾";

  return (
    <div className="group flex items-start gap-3 py-2.5 px-3 rounded-md hover:bg-accent/30 transition-colors">
      {/* Timeline dot */}
      <div className="flex flex-col items-center pt-1">
        <span className="text-sm">{icon}</span>
        <div className="w-px flex-1 bg-border mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="text-xs text-foreground leading-tight truncate">{entry.label}</p>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] text-muted-foreground">{formatTime(entry.timestamp)}</span>
          <span className="text-[10px] text-muted-foreground">·</span>
          <span className="text-[10px] text-muted-foreground">{formatRelative(entry.timestamp)}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-1">
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
            {entry.nodeCount} nodes
          </Badge>
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
            {entry.edgeCount} edges
          </Badge>
        </div>
      </div>

      {/* Restore button */}
      <Button
        variant="outline"
        size="sm"
        className="opacity-0 group-hover:opacity-100 transition-opacity h-7 text-[10px] shrink-0"
        onClick={() => onRestore(entry.id)}
      >
        ⏪ Restore
      </Button>
    </div>
  );
}

export default function HistoryPanel() {
  const flowHistory = useFlowStore((s) => s.flowHistory);
  const restoreFromHistory = useFlowStore((s) => s.restoreFromHistory);
  const clearFlowHistory = useFlowStore((s) => s.clearFlowHistory);
  const nodes = useFlowStore((s) => s.nodes);
  const edges = useFlowStore((s) => s.edges);

  // Reverse to show newest first
  const reversedHistory = [...flowHistory].reverse();

  return (
    <div className="flex flex-col h-full max-h-[60vh]">
      {/* Current state indicator */}
      <div className="px-4 py-3 bg-accent/20 rounded-md mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">📍</span>
          <div>
            <p className="text-xs font-semibold text-foreground">Current State</p>
            <p className="text-[10px] text-muted-foreground">
              {nodes.length} nodes · {edges.length} edges
            </p>
          </div>
        </div>
      </div>

      {flowHistory.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm text-muted-foreground">No history yet</p>
            <p className="text-[10px] text-muted-foreground mt-1">
              History is automatically saved when you generate with AI, load files, or reset.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">
              Timeline ({flowHistory.length})
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="text-[10px] text-destructive hover:text-destructive h-6"
              onClick={clearFlowHistory}
            >
              Clear All
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-0.5">
              {reversedHistory.map((entry) => (
                <HistoryEntryItem
                  key={entry.id}
                  entry={entry}
                  onRestore={restoreFromHistory}
                />
              ))}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
}
