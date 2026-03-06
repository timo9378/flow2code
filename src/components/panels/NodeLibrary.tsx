"use client";

/**
 * Node Library Panel (Left Panel) — Koimsurai Style
 *
 * Collapsible categorized node list, drag-and-drop nodes onto the canvas.
 * Node definitions come from NodeRegistry (dynamic), supports community extensions.
 *
 * v0.2.0 enhancements:
 * - Search / filter for quick node lookup
 * - Custom node templates: save groups of nodes as reusable templates
 * - Import / export custom templates as JSON
 */

import { useMemo, useState, useCallback, useRef } from "react";
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

/** Custom node template saved by user */
export interface CustomNodeTemplate {
  id: string;
  name: string;
  icon: string;
  description?: string;
  /** Serialized subset of nodes + edges */
  nodes: Array<{
    nodeType: string;
    category: string;
    label: string;
    params: Record<string, unknown>;
  }>;
  createdAt: string;
}

const CUSTOM_TEMPLATES_KEY = "flow2code:custom-templates";

function loadCustomTemplates(): CustomNodeTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(CUSTOM_TEMPLATES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomTemplates(templates: CustomNodeTemplate[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CUSTOM_TEMPLATES_KEY, JSON.stringify(templates));
}

export default function NodeLibrary() {
  const addFlowNode = useFlowStore((s) => s.addFlowNode);
  const nodes = useFlowStore((s) => s.nodes);
  const getSelectedNodeIds = useFlowStore((s) => s.getSelectedNodeIds);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState("");
  const [customTemplates, setCustomTemplates] = useState<CustomNodeTemplate[]>(loadCustomTemplates);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Dynamically get grouped node definitions from NodeRegistry
  const nodeTemplates = useMemo(() => nodeRegistry.getGroupedDefinitions(), []);

  // Filter templates based on search
  const filteredTemplates = useMemo(() => {
    if (!search.trim()) return nodeTemplates;
    const q = search.toLowerCase();
    const filtered: typeof nodeTemplates = {};
    for (const [category, group] of Object.entries(nodeTemplates)) {
      const matchingTemplates = group.templates.filter(
        (t) =>
          t.label.toLowerCase().includes(q) ||
          t.nodeType.toLowerCase().includes(q) ||
          category.toLowerCase().includes(q)
      );
      if (matchingTemplates.length > 0) {
        filtered[category] = { ...group, templates: matchingTemplates };
      }
    }
    return filtered;
  }, [nodeTemplates, search]);

  // Filter custom templates based on search
  const filteredCustom = useMemo(() => {
    if (!search.trim()) return customTemplates;
    const q = search.toLowerCase();
    return customTemplates.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.description ?? "").toLowerCase().includes(q)
    );
  }, [customTemplates, search]);

  const handleAddNode = (template: NodeTemplate) => {
    const x = 200 + Math.random() * 300;
    const y = 100 + Math.random() * 400;
    addFlowNode(template.nodeType as NodeType, template.category, { x, y });
  };

  // Save selected nodes as custom template
  const handleSaveCustom = useCallback(() => {
    const selectedIds = getSelectedNodeIds();
    const selectedNodes = nodes.filter((n) => selectedIds.includes(n.id));
    if (selectedNodes.length === 0) return;

    const name = prompt("Enter template name:", `Custom Template ${customTemplates.length + 1}`);
    if (!name) return;

    const template: CustomNodeTemplate = {
      id: `custom-${Date.now()}`,
      name,
      icon: "📦",
      description: `${selectedNodes.length} nodes`,
      nodes: selectedNodes.map((n) => ({
        nodeType: String(n.data.nodeType),
        category: String(n.data.category),
        label: String(n.data.label),
        params: (n.data.params ?? {}) as Record<string, unknown>,
      })),
      createdAt: new Date().toISOString(),
    };

    const updated = [...customTemplates, template];
    setCustomTemplates(updated);
    saveCustomTemplates(updated);
  }, [nodes, getSelectedNodeIds, customTemplates]);

  // Instantiate a custom template on canvas
  const handleInstantiateCustom = useCallback(
    (template: CustomNodeTemplate) => {
      const baseX = 200 + Math.random() * 200;
      const baseY = 100 + Math.random() * 200;
      template.nodes.forEach((n, i) => {
        addFlowNode(n.nodeType as NodeType, n.category as NodeCategory, {
          x: baseX + i * 60,
          y: baseY + i * 80,
        });
      });
    },
    [addFlowNode]
  );

  // Delete custom template
  const handleDeleteCustom = useCallback(
    (id: string) => {
      const updated = customTemplates.filter((t) => t.id !== id);
      setCustomTemplates(updated);
      saveCustomTemplates(updated);
    },
    [customTemplates]
  );

  // Export custom templates as JSON
  const handleExportCustom = useCallback(() => {
    const blob = new Blob([JSON.stringify(customTemplates, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "flow2code-custom-templates.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [customTemplates]);

  // Import custom templates from JSON
  const handleImportCustom = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const imported = JSON.parse(reader.result as string) as CustomNodeTemplate[];
          if (!Array.isArray(imported)) return;
          const merged = [...customTemplates, ...imported];
          setCustomTemplates(merged);
          saveCustomTemplates(merged);
        } catch {
          /* ignore parse errors */
        }
      };
      reader.readAsText(file);
      // Reset input so same file can be re-imported
      e.target.value = "";
    },
    [customTemplates]
  );

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

        {/* Search */}
        <div className="px-2 py-1.5">
          <input
            type="text"
            placeholder="Search nodes..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-secondary text-foreground text-[11px] rounded-md px-2 py-1 border border-border placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        {/* Node list */}
        <ScrollArea className="flex-1">
          <div className="p-2 flex flex-col gap-1">
            {Object.entries(filteredTemplates).map(([category, group]) => (
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

            {/* Custom Templates Section */}
            <Separator className="my-1" />
            <Collapsible defaultOpen>
              <CollapsibleTrigger className="flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground w-full rounded-md hover:bg-accent transition-colors cursor-pointer">
                <span>⭐</span>
                <span className="text-orange-400">Custom</span>
                {customTemplates.length > 0 && (
                  <span className="text-[9px] text-muted-foreground ml-auto">{customTemplates.length}</span>
                )}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="flex flex-col gap-0.5 py-0.5 pl-2">
                  {filteredCustom.length > 0 ? (
                    filteredCustom.map((ct) => (
                      <div
                        key={ct.id}
                        className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs
                          text-muted-foreground hover:text-foreground
                          hover:bg-accent transition-colors group"
                      >
                        <button
                          onClick={() => handleInstantiateCustom(ct)}
                          className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer text-left"
                        >
                          <span className="text-sm group-hover:scale-110 transition-transform">{ct.icon}</span>
                          <span className="truncate">{ct.name}</span>
                        </button>
                        <button
                          onClick={() => handleDeleteCustom(ct.id)}
                          className="opacity-0 group-hover:opacity-100 text-destructive text-[10px] cursor-pointer shrink-0"
                          title="Delete template"
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="text-[10px] text-muted-foreground px-2 py-1">
                      No custom templates yet
                    </p>
                  )}

                  {/* Actions */}
                  <div className="flex flex-wrap gap-1 px-1 py-1">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={handleSaveCustom}
                          className="text-[10px] text-primary hover:text-primary/80 cursor-pointer px-1"
                        >
                          + Save
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">Save selected nodes as a custom template</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={handleExportCustom}
                          className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer px-1"
                        >
                          ↓ Export
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">Export custom templates as JSON</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer px-1"
                        >
                          ↑ Import
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">Import custom templates from JSON</TooltipContent>
                    </Tooltip>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={handleImportCustom}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
