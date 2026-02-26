"use client";

/**
 * 節點配置面板（右側面板）— shadcn/ui 版
 *
 * 浮動卡片風格，當選擇節點時從右側出現。
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

function renderParams(data: FlowNodeData, onUpdate: (key: string, value: string) => void) {
  const params = data.params as Record<string, unknown>;
  const nodeType = data.nodeType;

  switch (nodeType) {
    case TriggerType.HTTP_WEBHOOK: {
      const routePath = String(params.routePath ?? "");
      const routeError = routePath && !routePath.startsWith("/") ? "路徑必須以 / 開頭" : undefined;
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
          <ParamField label="Code" value={String(params.code ?? "")} onChange={(v) => onUpdate("code", v)} type="textarea" />
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
      return <ParamField label="Condition" value={String(params.condition ?? "")} onChange={(v) => onUpdate("condition", v)} type="textarea" />;
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
      return <ParamField label="Expression" value={String(params.expression ?? "")} onChange={(v) => onUpdate("expression", v)} type="textarea" />;
    case OutputType.RETURN_RESPONSE: {
      const statusCode = Number(params.statusCode ?? 200);
      const statusError = statusCode < 100 || statusCode > 599 ? "狀態碼範圍 100-599" : undefined;
      return (
        <>
          <ParamField label="Status Code" value={String(params.statusCode ?? 200)} onChange={(v) => onUpdate("statusCode", v)} type="number" error={statusError} />
          <ParamField label="Body Expression" value={String(params.bodyExpression ?? "")} onChange={(v) => onUpdate("bodyExpression", v)} type="textarea" />
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
  const nodes = useFlowStore((s) => s.nodes);
  const updateNodeParams = useFlowStore((s) => s.updateNodeParams);
  const updateNodeLabel = useFlowStore((s) => s.updateNodeLabel);
  const removeNode = useFlowStore((s) => s.removeNode);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const upstreamTypes = useUpstreamTypes(selectedNodeId);

  if (!selectedNode) {
    return (
      <div className="w-72 bg-card border-l border-border flex items-center justify-center h-full shrink-0">
        <p className="text-xs text-muted-foreground text-center px-4">
          點擊節點以編輯參數
        </p>
      </div>
    );
  }

  const data = selectedNode.data;

  const handleParamUpdate = (key: string, value: string) => {
    let parsedValue: unknown = value;

    // JSON 欄位（如 inputMapping）
    if (key === "inputMapping") {
      try { parsedValue = JSON.parse(value); } catch { parsedValue = value; }
    } else if (value === "true") {
      parsedValue = true;
    } else if (value === "false") {
      parsedValue = false;
    } else if (key === "statusCode") {
      // statusCode 強制為數字
      const num = Number(value);
      parsedValue = isNaN(num) ? value : num;
    } else if (!isNaN(Number(value)) && value !== "" && key !== "routePath" && key !== "name" && key !== "functionName" && key !== "flowPath") {
      parsedValue = Number(value);
    }

    updateNodeParams(selectedNode.id, { [key]: parsedValue } as never);
  };

  return (
    <div className="w-72 bg-card border-l border-border flex flex-col h-full shrink-0">
      <ScrollArea className="flex-1">
        <div className="p-3 flex flex-col gap-3">
          {/* Header */}
          <Card className="border-border">
            <CardHeader className="p-3 pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">節點設定</CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => removeNode(selectedNode.id)}
                  className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 text-xs"
                >
                  刪除
                </Button>
              </div>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-2">
              <p className="text-[10px] text-muted-foreground font-mono truncate">{selectedNode.id}</p>
              <ParamField
                label="節點名稱"
                value={data.label}
                onChange={(v) => updateNodeLabel(selectedNode.id, v)}
              />
            </CardContent>
          </Card>

          <Separator />

          {/* Params */}
          <Card className="border-border">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">參數</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-3">
              {renderParams(data, handleParamUpdate)}
            </CardContent>
          </Card>

          <Separator />

          {/* Ports */}
          <Card className="border-border">
            <CardHeader className="p-3 pb-2">
              <CardTitle className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">端口</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-1.5">
              {data.inputs.length > 0 && (
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-[10px] text-muted-foreground mr-1">輸入:</span>
                  {data.inputs.map((p) => (
                    <Badge key={p.id} variant="secondary" className="text-[10px]">
                      {p.label}
                    </Badge>
                  ))}
                </div>
              )}
              {data.outputs.length > 0 && (
                <div className="flex flex-wrap gap-1 items-center">
                  <span className="text-[10px] text-muted-foreground mr-1">輸出:</span>
                  {data.outputs.map((p) => (
                    <Badge key={p.id} variant="outline" className="text-[10px] text-amber-400 border-amber-400/30">
                      {p.label}
                    </Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upstream Types — 即時型別提示 */}
          {upstreamTypes.hasTypes && (
            <>
              <Separator />
              <Card className="border-border border-cyan-500/20">
                <CardHeader className="p-3 pb-2">
                  <CardTitle className="text-xs text-cyan-400 font-semibold uppercase tracking-wider">
                    flowState 可用欄位
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-3 pb-3 space-y-1">
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
                    上游 {upstreamTypes.entries.length} 個節點的輸出型別
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
