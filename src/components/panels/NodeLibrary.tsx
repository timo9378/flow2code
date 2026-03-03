"use client";

/**
 * Node Library Panel (Left Panel) — Koimsurai Style
 *
 * Collapsible categorized node list, drag-and-drop nodes onto the canvas.
 * Node definitions come from NodeRegistry (dynamic), supports community extensions.
 */

import { useMemo, useState } from "react";
import { useFlowStore } from "@/store/flow-store";
import { type NodeCategory, type NodeType } from "@/lib/ir/types";
import { nodeRegistry } from "@/lib/node-registry";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

interface NodeTemplate {
  nodeType: string;
  label: string;
  icon: string;
  category: NodeCategory;
}

export default function NodeLibrary() {
  const addFlowNode = useFlowStore((s) => s.addFlowNode);
  const [collapsed, setCollapsed] = useState(false);

  // Dynamically get grouped node definitions from NodeRegistry
  const nodeTemplates = useMemo(() => nodeRegistry.getGroupedDefinitions(), []);

  const handleAddNode = (template: NodeTemplate) => {
    const x = 200 + Math.random() * 300;
    const y = 100 + Math.random() * 400;
    addFlowNode(template.nodeType as NodeType, template.category, { x, y });
  };

  return (
    <div
      className={`bg-card border-r border-border flex flex-col shrink-0 transition-all duration-300 ease-in-out overflow-hidden ${
        collapsed ? "w-12" : "w-56"
      }`}
    >
      {/* Collapsed: icon strip */}
      <div
        className={`flex flex-col items-center py-3 gap-2 transition-opacity duration-200 ${
          collapsed ? "opacity-100" : "opacity-0 hidden"
        }`}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="w-8 h-8 text-lg"
              onClick={() => setCollapsed(false)}
            >
              »
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand Node Library</TooltipContent>
        </Tooltip>
        <Separator className="w-6" />
        {Object.entries(nodeTemplates).map(([name, group]) => (
          <Tooltip key={name}>
            <TooltipTrigger asChild>
              <span className="text-sm cursor-default">{group.icon}</span>
            </TooltipTrigger>
            <TooltipContent side="right">{name}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      {/* Expanded: full node list */}
      <div
        className={`flex flex-col flex-1 min-w-0 transition-opacity duration-200 ${
          collapsed ? "opacity-0 hidden" : "opacity-100"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
          <span className="text-xs font-semibold text-foreground uppercase tracking-wider whitespace-nowrap">Node Library</span>
          <Button
            variant="ghost"
            size="icon"
            className="w-6 h-6 text-muted-foreground hover:text-foreground"
            onClick={() => setCollapsed(true)}
          >
            «
          </Button>
        </div>

        {/* Node list */}
        <ScrollArea className="flex-1">
          <div className="p-2 flex flex-col gap-1">
            {Object.entries(nodeTemplates).map(([category, group]) => (
              <Collapsible key={category} defaultOpen>
                <CollapsibleTrigger className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground w-full rounded-md hover:bg-accent transition-colors cursor-pointer">
                  <span>{group.icon}</span>
                  <span className={group.color}>{category}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="flex flex-col gap-0.5 py-0.5 pl-2">
                    {group.templates.map((template) => (
                      <button
                        key={template.nodeType}
                        onClick={() => handleAddNode(template)}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs
                          text-muted-foreground hover:text-foreground
                          hover:bg-accent transition-colors cursor-pointer text-left group"
                      >
                        <span className="text-sm group-hover:scale-110 transition-transform">{template.icon}</span>
                        <span>{template.label}</span>
                      </button>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ))}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
