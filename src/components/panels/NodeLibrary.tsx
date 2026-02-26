"use client";

/**
 * 節點庫面板（左側面板）— Koimsurai 風格
 *
 * 可收合的分類節點列表，拖放節點到畫布上。
 */

import { useState } from "react";
import { useFlowStore } from "@/store/flow-store";
import {
  NodeCategory,
  TriggerType,
  ActionType,
  LogicType,
  VariableType,
  OutputType,
  type NodeType,
} from "@/lib/ir/types";
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
  nodeType: NodeType;
  label: string;
  icon: string;
  category: NodeCategory;
}

const nodeTemplates: Record<string, { icon: string; color: string; templates: NodeTemplate[] }> = {
  "觸發器": {
    icon: "⚡",
    color: "text-emerald-400",
    templates: [
      { nodeType: TriggerType.HTTP_WEBHOOK, label: "HTTP Webhook", icon: "🌐", category: NodeCategory.TRIGGER },
      { nodeType: TriggerType.CRON_JOB, label: "Cron Job", icon: "⏰", category: NodeCategory.TRIGGER },
      { nodeType: TriggerType.MANUAL, label: "Manual", icon: "👤", category: NodeCategory.TRIGGER },
    ],
  },
  "執行器": {
    icon: "🔧",
    color: "text-blue-400",
    templates: [
      { nodeType: ActionType.FETCH_API, label: "Fetch API", icon: "📡", category: NodeCategory.ACTION },
      { nodeType: ActionType.SQL_QUERY, label: "SQL Query", icon: "🗄️", category: NodeCategory.ACTION },
      { nodeType: ActionType.REDIS_CACHE, label: "Redis Cache", icon: "💾", category: NodeCategory.ACTION },
      { nodeType: ActionType.CUSTOM_CODE, label: "Custom Code", icon: "💻", category: NodeCategory.ACTION },
    ],
  },
  "邏輯控制": {
    icon: "🔀",
    color: "text-amber-400",
    templates: [
      { nodeType: LogicType.IF_ELSE, label: "If / Else", icon: "🔀", category: NodeCategory.LOGIC },
      { nodeType: LogicType.FOR_LOOP, label: "For Loop", icon: "🔁", category: NodeCategory.LOGIC },
      { nodeType: LogicType.TRY_CATCH, label: "Try / Catch", icon: "🛡️", category: NodeCategory.LOGIC },
      { nodeType: LogicType.PROMISE_ALL, label: "Promise.all", icon: "⚡", category: NodeCategory.LOGIC },
    ],
  },
  "變數": {
    icon: "📦",
    color: "text-purple-400",
    templates: [
      { nodeType: VariableType.DECLARE, label: "Declare Variable", icon: "📦", category: NodeCategory.VARIABLE },
      { nodeType: VariableType.TRANSFORM, label: "Transform", icon: "🔄", category: NodeCategory.VARIABLE },
    ],
  },
  "輸出": {
    icon: "📤",
    color: "text-rose-400",
    templates: [
      { nodeType: OutputType.RETURN_RESPONSE, label: "Return Response", icon: "📤", category: NodeCategory.OUTPUT },
    ],
  },
};

export default function NodeLibrary() {
  const addFlowNode = useFlowStore((s) => s.addFlowNode);
  const [collapsed, setCollapsed] = useState(false);

  const handleAddNode = (template: NodeTemplate) => {
    const x = 200 + Math.random() * 300;
    const y = 100 + Math.random() * 400;
    addFlowNode(template.nodeType, template.category, { x, y });
  };

  if (collapsed) {
    return (
      <div className="w-12 bg-card border-r border-border flex flex-col items-center py-3 gap-2 shrink-0">
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
          <TooltipContent side="right">展開節點庫</TooltipContent>
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
    );
  }

  return (
    <div className="w-56 bg-card border-r border-border flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <span className="text-xs font-semibold text-foreground uppercase tracking-wider">節點庫</span>
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
  );
}
