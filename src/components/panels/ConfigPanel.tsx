"use client";

/**
 * Node Configuration Panel — n8n-style Overlay Panel
 *
 * Slides in from the right as an overlay when a node is selected.
 * Wider than the previous fixed sidebar for comfortable editing.
 */

import { useFlowStore } from "@/store/flow-store";
import type { FlowNodeData } from "@/store/flow-store";
import { useUpstreamTypes } from "@/hooks/use-upstream-types";
import {
  TriggerType,
  ActionType,
  LogicType,
  VariableType,
  OutputType,
  NodeCategory,
} from "@/lib/ir/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ExpressionInput from "@/components/ui/expression-input";

// Category icons (matching FlowNode.tsx)
const categoryIcons: Record<string, string> = {
  [NodeCategory.TRIGGER]: "⚡",
  [NodeCategory.ACTION]: "🔧",
  [NodeCategory.LOGIC]: "🔀",
  [NodeCategory.VARIABLE]: "📦",
  [NodeCategory.OUTPUT]: "📤",
};

// ── Field Components ──

function ParamField({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  error,
}: {
  label: string;
  value: string | number | boolean;
  onChange: (value: string) => void;
  type?: "text" | "number" | "select" | "textarea" | "checkbox";
  placeholder?: string;
  error?: string;
}) {
  const id = `param-${label}`;

  if (type === "textarea") {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id} className="text-[10px] uppercase tracking-wider">{label}</Label>
        <Textarea
          id={id}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`font-mono text-xs resize-y min-h-[60px] ${error ? "border-red-500" : ""}`}
        />
        {error && <p className="text-[10px] text-red-400">{error}</p>}
      </div>
    );
  }

  if (type === "checkbox") {
    return (
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(String(e.target.checked))}
          className="rounded border-border accent-primary"
        />
        <Label htmlFor={id} className="text-[10px] uppercase tracking-wider cursor-pointer">{label}</Label>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-[10px] uppercase tracking-wider">{label}</Label>
      <Input
        id={id}
        type={type}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`font-mono text-xs h-8 ${error ? "border-red-500" : ""}`}
      />
      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}

function renderParams(data: FlowNodeData, onUpdate: (key: string, value: string) => void, nodeId: string | null) {
  const params = data.params as Record<string, unknown>;
  const nodeType = data.nodeType;

  switch (nodeType) {
    case TriggerType.HTTP_WEBHOOK: {
      const routePath = String(params.routePath ?? "");
      const routeError = routePath && !routePath.startsWith("/") ? "Path must start with /" : undefined;
      return (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider">HTTP Method</Label>
            <Select value={String(params.method ?? "GET")} onValueChange={(v) => onUpdate("method", v)}>
              <SelectTrigger className="font-mono text-xs h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ParamField label="Route Path" value={routePath} onChange={(v) => onUpdate("routePath", v)} placeholder="/api/endpoint" error={routeError} />
          <ParamField label="Parse Body" value={Boolean(params.parseBody)} onChange={(v) => onUpdate("parseBody", v)} type="checkbox" />
        </>
      );
    }
    case ActionType.FETCH_API: {
      return (
        <>
          <ParamField label="URL" value={String(params.url ?? "")} onChange={(v) => onUpdate("url", v)} placeholder="https://api.example.com" />
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider">Method</Label>
            <Select value={String(params.method ?? "GET")} onValueChange={(v) => onUpdate("method", v)}>
              <SelectTrigger className="font-mono text-xs h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                  <SelectItem key={m} value={m} className="font-mono text-xs">{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ParamField label="Body" value={String(params.body ?? "")} onChange={(v) => onUpdate("body", v)} type="textarea" />
          <ParamField label="Parse JSON" value={Boolean(params.parseJson)} onChange={(v) => onUpdate("parseJson", v)} type="checkbox" />
        </>
      );
    }
    case ActionType.SQL_QUERY: {
      return (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider">ORM</Label>
            <Select value={String(params.orm ?? "drizzle")} onValueChange={(v) => onUpdate("orm", v)}>
              <SelectTrigger className="font-mono text-xs h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["drizzle", "prisma", "raw"].map((o) => (
                  <SelectItem key={o} value={o} className="font-mono text-xs">{o}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ParamField label="Query" value={String(params.query ?? "")} onChange={(v) => onUpdate("query", v)} type="textarea" />
        </>
      );
    }
    case ActionType.CUSTOM_CODE:
      return (
        <>
          <ExpressionInput nodeId={nodeId} label="Code" value={String(params.code ?? "")} onChange={(v) => onUpdate("code", v)} />
          <ParamField label="Return Variable" value={String(params.returnVariable ?? "")} onChange={(v) => onUpdate("returnVariable", v)} />
        </>
      );
    case ActionType.REDIS_CACHE:
      return (
        <>
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider">Operation</Label>
            <Select value={String(params.operation ?? "get")} onValueChange={(v) => onUpdate("operation", v)}>
              <SelectTrigger className="font-mono text-xs h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["get", "set", "del"].map((op) => (
                  <SelectItem key={op} value={op} className="font-mono text-xs">{op}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ParamField label="Key" value={String(params.key ?? "")} onChange={(v) => onUpdate("key", v)} />
          {String(params.operation) === "set" && (
            <>
              <ParamField label="Value" value={String(params.value ?? "")} onChange={(v) => onUpdate("value", v)} type="textarea" />
              <ParamField label="TTL (seconds)" value={String(params.ttl ?? "")} onChange={(v) => onUpdate("ttl", v)} type="number" />
            </>
          )}
        </>
      );
    case ActionType.CALL_SUBFLOW:
      return (
        <>
          <ParamField label="Flow Path" value={String(params.flowPath ?? "")} onChange={(v) => onUpdate("flowPath", v)} />
          <ParamField label="Function Name" value={String(params.functionName ?? "")} onChange={(v) => onUpdate("functionName", v)} />
          <ParamField label="Input Mapping (JSON)" value={typeof params.inputMapping === "object" ? JSON.stringify(params.inputMapping) : String(params.inputMapping ?? "{}")} onChange={(v) => onUpdate("inputMapping", v)} type="textarea" />
        </>
      );
    case LogicType.IF_ELSE:
      return <ExpressionInput nodeId={nodeId} label="Condition" value={String(params.condition ?? "")} onChange={(v) => onUpdate("condition", v)} placeholder="flowState['nodeId'] > 0" />;
    case LogicType.FOR_LOOP:
      return (
        <>
          <ParamField label="Iterable Expression" value={String(params.iterableExpression ?? "")} onChange={(v) => onUpdate("iterableExpression", v)} />
          <ParamField label="Item Variable" value={String(params.itemVariable ?? "")} onChange={(v) => onUpdate("itemVariable", v)} />
          <ParamField label="Index Variable" value={String(params.indexVariable ?? "")} onChange={(v) => onUpdate("indexVariable", v)} />
        </>
      );
    case LogicType.TRY_CATCH:
      return <ParamField label="Error Variable" value={String(params.errorVariable ?? "")} onChange={(v) => onUpdate("errorVariable", v)} />;
    case TriggerType.CRON_JOB:
      return (
        <>
          <ParamField label="Cron Schedule" value={String(params.schedule ?? "")} onChange={(v) => onUpdate("schedule", v)} placeholder="0 * * * *" />
          <ParamField label="Function Name" value={String(params.functionName ?? "")} onChange={(v) => onUpdate("functionName", v)} />
        </>
      );
    case TriggerType.MANUAL:
      return (
        <>
          <ParamField label="Function Name" value={String(params.functionName ?? "")} onChange={(v) => onUpdate("functionName", v)} />
        </>
      );
    case VariableType.DECLARE:
      return (
        <>
          <ParamField label="Variable Name" value={String(params.name ?? "")} onChange={(v) => onUpdate("name", v)} />
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider">Data Type</Label>
            <Select value={String(params.dataType ?? "string")} onValueChange={(v) => onUpdate("dataType", v)}>
              <SelectTrigger className="font-mono text-xs h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["string", "number", "boolean", "object", "array", "any"].map((t) => (
                  <SelectItem key={t} value={t} className="font-mono text-xs">{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ParamField label="Initial Value" value={String(params.initialValue ?? "")} onChange={(v) => onUpdate("initialValue", v)} />
          <ParamField label="Is Const" value={Boolean(params.isConst)} onChange={(v) => onUpdate("isConst", v)} type="checkbox" />
        </>
      );
    case VariableType.TRANSFORM:
      return <ExpressionInput nodeId={nodeId} label="Expression" value={String(params.expression ?? "")} onChange={(v) => onUpdate("expression", v)} placeholder="flowState['fetch_1'].data" />;
    case OutputType.RETURN_RESPONSE: {
      const statusCode = Number(params.statusCode ?? 200);
      const statusError = statusCode < 100 || statusCode > 599 ? "Status code range: 100-599" : undefined;
      return (
        <>
          <ParamField label="Status Code" value={String(params.statusCode ?? 200)} onChange={(v) => onUpdate("statusCode", v)} type="number" error={statusError} />
          <ExpressionInput nodeId={nodeId} label="Body Expression" value={String(params.bodyExpression ?? "")} onChange={(v) => onUpdate("bodyExpression", v)} placeholder="{ result: flowState['nodeId'] }" />
        </>
      );
    }
    default:
      return (
        <pre className="text-[10px] text-muted-foreground font-mono overflow-x-auto bg-secondary rounded-md p-2">
          {JSON.stringify(params, null, 2)}
        </pre>
      );
  }
}

export default function ConfigPanel() {
  const selectedNodeId = useFlowStore((s) => s.selectedNodeId);
  const selectNode = useFlowStore((s) => s.selectNode);
  const nodes = useFlowStore((s) => s.nodes);
  const updateNodeParams = useFlowStore((s) => s.updateNodeParams);
  const updateNodeLabel = useFlowStore((s) => s.updateNodeLabel);
  const removeNode = useFlowStore((s) => s.removeNode);
  const removeSelectedNodes = useFlowStore((s) => s.removeSelectedNodes);
  const getSelectedNodeIds = useFlowStore((s) => s.getSelectedNodeIds);

  const selectedIds = getSelectedNodeIds();
  const multiSelected = selectedIds.length > 1;
  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const upstreamTypes = useUpstreamTypes(selectedNodeId);

  // ── n8n-style: Panel hidden when no selection ──
  if (!multiSelected && !selectedNode) return null;

  // Outer container — overlay panel, slides in from right
  const panelWrapper = (children: React.ReactNode) => (
    <div className="absolute right-0 top-0 h-full w-[480px] max-w-[55vw] bg-card/95 backdrop-blur-sm border-l border-border flex flex-col shadow-2xl z-10 animate-in slide-in-from-right duration-200">
      {children}
    </div>
  );

  // ── Multi-select view ──
  if (multiSelected) {
    const selectedNodes = nodes.filter((n) => selectedIds.includes(n.id));
    const categories = [...new Set(selectedNodes.map((n) => (n.data as FlowNodeData).category))];

    return panelWrapper(
      <>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base">📋</span>
            <div>
              <h3 className="text-sm font-semibold">Multi-Select</h3>
              <p className="text-[10px] text-muted-foreground">{selectedIds.length} nodes selected</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeSelectedNodes()}
              className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs"
            >
              Delete All
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => selectNode(null)}
            >
              ✕
            </Button>
          </div>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-4 flex flex-col gap-3">
            <div className="flex flex-wrap gap-1">
              {categories.map((cat) => (
                <Badge key={cat} variant="secondary" className="text-[10px]">
                  {categoryIcons[cat] ?? "📦"} {cat}
                </Badge>
              ))}
            </div>

            <Separator />

            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Selected Nodes</span>
              {selectedNodes.map((node) => {
                const d = node.data as FlowNodeData;
                return (
                  <div key={node.id} className="flex items-center justify-between gap-1 py-1.5 px-3 rounded-md bg-accent/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm">{categoryIcons[d.category] ?? "📦"}</span>
                      <div className="min-w-0">
                        <span className="text-xs text-foreground truncate block">{d.label}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{d.nodeType}</span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="w-6 h-6 text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
                      onClick={() => removeNode(node.id)}
                    >
                      ✕
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        </ScrollArea>
      </>
    );
  }

  // ── Single node selected ──
  const data = selectedNode!.data;
  const icon = categoryIcons[data.category] ?? "📦";

  const handleParamUpdate = (key: string, value: string) => {
    let parsedValue: unknown = value;

    // JSON fields (e.g. inputMapping)
    if (key === "inputMapping") {
      try { parsedValue = JSON.parse(value); } catch { parsedValue = value; }
    } else if (value === "true") {
      parsedValue = true;
    } else if (value === "false") {
      parsedValue = false;
    } else if (key === "statusCode") {
      // statusCode forced to number
      const num = Number(value);
      parsedValue = isNaN(num) ? value : num;
    } else if (!isNaN(Number(value)) && value !== "" && key !== "routePath" && key !== "name" && key !== "functionName" && key !== "flowPath") {
      parsedValue = Number(value);
    }

    updateNodeParams(selectedNode!.id, { [key]: parsedValue } as never);
  };

  return panelWrapper(
    <>
      {/* n8n-style Header — node icon, name, type, close/delete */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg">{icon}</span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate">{data.label}</h3>
            <p className="text-[10px] text-muted-foreground font-mono">{data.nodeType}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => removeNode(selectedNode!.id)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs"
          >
            Delete
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => selectNode(null)}
          >
            ✕
          </Button>
        </div>
      </div>

      {/* Scrollable content */}
      <ScrollArea className="flex-1">
        <div className="p-4 flex flex-col gap-4">
          {/* Node Name */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Node Name</Label>
            <Input
              value={data.label}
              onChange={(e) => updateNodeLabel(selectedNode!.id, e.target.value)}
              className="font-mono text-xs h-8"
            />
            <p className="text-[10px] text-muted-foreground font-mono truncate">{selectedNode!.id}</p>
          </div>

          <Separator />

          {/* Parameters */}
          <div className="flex flex-col gap-3">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Parameters</span>
            {renderParams(data, handleParamUpdate, selectedNodeId)}
          </div>

          <Separator />

          {/* Ports */}
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Ports</span>
            {data.inputs.length > 0 && (
              <div className="flex flex-wrap gap-1 items-center">
                <span className="text-[10px] text-muted-foreground mr-1">In:</span>
                {data.inputs.map((p) => (
                  <Badge key={p.id} variant="secondary" className="text-[10px]">
                    {p.label}
                  </Badge>
                ))}
              </div>
            )}
            {data.outputs.length > 0 && (
              <div className="flex flex-wrap gap-1 items-center">
                <span className="text-[10px] text-muted-foreground mr-1">Out:</span>
                {data.outputs.map((p) => (
                  <Badge key={p.id} variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">
                    {p.label}
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Upstream Types — Real-time Type Hints */}
          {upstreamTypes.hasTypes && (
            <>
              <Separator />
              <div className="flex flex-col gap-2">
                <span className="text-xs text-cyan-400 font-semibold uppercase tracking-wider">
                  flowState Available Fields
                </span>
                <div className="space-y-1">
                  {upstreamTypes.entries.map((entry) => (
                    <div key={entry.nodeId} className="flex items-center justify-between gap-1">
                      <code className="text-[10px] text-foreground font-mono truncate">
                        flowState[&apos;{entry.nodeId}&apos;]
                      </code>
                      <Badge variant="outline" className="text-[9px] text-cyan-400 border-cyan-500/30 shrink-0">
                        {entry.tsType}
                      </Badge>
                    </div>
                  ))}
                  <p className="text-[9px] text-muted-foreground pt-1">
                    Output types from {upstreamTypes.entries.length} upstream node(s)
                  </p>
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </>
  );
}
