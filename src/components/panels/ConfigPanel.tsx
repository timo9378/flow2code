"use client";

/**
 * 節點配置面板（右側面板）— shadcn/ui 版
 *
 * 浮動卡片風格，當選擇節點時從右側出現。
 */

import { useFlowStore } from "@/store/flow-store";
import type { FlowNodeData } from "@/store/flow-store";
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

// ── Field Components ──

function ParamField({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string | number | boolean;
  onChange: (value: string) => void;
  type?: "text" | "number" | "select" | "textarea" | "checkbox";
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
          className="font-mono text-xs resize-y min-h-[60px]"
        />
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
        className="font-mono text-xs h-8"
      />
    </div>
  );
}

function renderParams(data: FlowNodeData, onUpdate: (key: string, value: string) => void) {
  const params = data.params as Record<string, unknown>;
  const nodeType = data.nodeType;

  switch (nodeType) {
    case TriggerType.HTTP_WEBHOOK:
      return (
        <>
          <ParamField label="HTTP Method" value={String(params.method ?? "")} onChange={(v) => onUpdate("method", v)} />
          <ParamField label="Route Path" value={String(params.routePath ?? "")} onChange={(v) => onUpdate("routePath", v)} />
          <ParamField label="Parse Body" value={Boolean(params.parseBody)} onChange={(v) => onUpdate("parseBody", v)} type="checkbox" />
        </>
      );
    case ActionType.FETCH_API:
      return (
        <>
          <ParamField label="URL" value={String(params.url ?? "")} onChange={(v) => onUpdate("url", v)} />
          <ParamField label="Method" value={String(params.method ?? "")} onChange={(v) => onUpdate("method", v)} />
          <ParamField label="Body" value={String(params.body ?? "")} onChange={(v) => onUpdate("body", v)} type="textarea" />
          <ParamField label="Parse JSON" value={Boolean(params.parseJson)} onChange={(v) => onUpdate("parseJson", v)} type="checkbox" />
        </>
      );
    case ActionType.SQL_QUERY:
      return (
        <>
          <ParamField label="ORM" value={String(params.orm ?? "")} onChange={(v) => onUpdate("orm", v)} />
          <ParamField label="Query" value={String(params.query ?? "")} onChange={(v) => onUpdate("query", v)} type="textarea" />
        </>
      );
    case ActionType.CUSTOM_CODE:
      return (
        <>
          <ParamField label="Code" value={String(params.code ?? "")} onChange={(v) => onUpdate("code", v)} type="textarea" />
          <ParamField label="Return Variable" value={String(params.returnVariable ?? "")} onChange={(v) => onUpdate("returnVariable", v)} />
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
    case VariableType.DECLARE:
      return (
        <>
          <ParamField label="Variable Name" value={String(params.name ?? "")} onChange={(v) => onUpdate("name", v)} />
          <ParamField label="Data Type" value={String(params.dataType ?? "")} onChange={(v) => onUpdate("dataType", v)} />
          <ParamField label="Initial Value" value={String(params.initialValue ?? "")} onChange={(v) => onUpdate("initialValue", v)} />
          <ParamField label="Is Const" value={Boolean(params.isConst)} onChange={(v) => onUpdate("isConst", v)} type="checkbox" />
        </>
      );
    case VariableType.TRANSFORM:
      return <ParamField label="Expression" value={String(params.expression ?? "")} onChange={(v) => onUpdate("expression", v)} type="textarea" />;
    case OutputType.RETURN_RESPONSE:
      return (
        <>
          <ParamField label="Status Code" value={String(params.statusCode ?? 200)} onChange={(v) => onUpdate("statusCode", v)} type="number" />
          <ParamField label="Body Expression" value={String(params.bodyExpression ?? "")} onChange={(v) => onUpdate("bodyExpression", v)} type="textarea" />
        </>
      );
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
    if (value === "true") parsedValue = true;
    else if (value === "false") parsedValue = false;
    else if (!isNaN(Number(value)) && value !== "") parsedValue = Number(value);
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
        </div>
      </ScrollArea>
    </div>
  );
}
