"use client";

/**
 * 節點配置面板（右側面板）
 * 
 * 當使用者點擊節點後，顯示其參數並允許編輯。
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
  if (type === "textarea") {
    return (
      <div className="flex flex-col gap-1">
        <label className="text-[10px] font-semibold text-gray-400 uppercase">
          {label}
        </label>
        <textarea
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          className="bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none resize-y min-h-[60px] font-mono"
        />
      </div>
    );
  }

  if (type === "checkbox") {
    return (
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(String(e.target.checked))}
          className="rounded"
        />
        <label className="text-[10px] font-semibold text-gray-400 uppercase">
          {label}
        </label>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-semibold text-gray-400 uppercase">
        {label}
      </label>
      <input
        type={type}
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="bg-gray-800 text-white text-xs rounded px-2 py-1.5 border border-gray-700 focus:border-blue-500 outline-none font-mono"
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
      return (
        <ParamField label="Condition" value={String(params.condition ?? "")} onChange={(v) => onUpdate("condition", v)} type="textarea" />
      );

    case LogicType.FOR_LOOP:
      return (
        <>
          <ParamField label="Iterable Expression" value={String(params.iterableExpression ?? "")} onChange={(v) => onUpdate("iterableExpression", v)} />
          <ParamField label="Item Variable" value={String(params.itemVariable ?? "")} onChange={(v) => onUpdate("itemVariable", v)} />
          <ParamField label="Index Variable" value={String(params.indexVariable ?? "")} onChange={(v) => onUpdate("indexVariable", v)} />
        </>
      );

    case LogicType.TRY_CATCH:
      return (
        <ParamField label="Error Variable" value={String(params.errorVariable ?? "")} onChange={(v) => onUpdate("errorVariable", v)} />
      );

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
      return (
        <ParamField label="Expression" value={String(params.expression ?? "")} onChange={(v) => onUpdate("expression", v)} type="textarea" />
      );

    case OutputType.RETURN_RESPONSE:
      return (
        <>
          <ParamField label="Status Code" value={String(params.statusCode ?? 200)} onChange={(v) => onUpdate("statusCode", v)} type="number" />
          <ParamField label="Body Expression" value={String(params.bodyExpression ?? "")} onChange={(v) => onUpdate("bodyExpression", v)} type="textarea" />
        </>
      );

    default:
      return (
        <pre className="text-[10px] text-gray-500 font-mono overflow-x-auto">
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
      <div className="w-72 bg-gray-900 text-gray-500 p-4 flex items-center justify-center h-full">
        <p className="text-xs text-center">點擊節點以編輯參數</p>
      </div>
    );
  }

  const data = selectedNode.data;

  const handleParamUpdate = (key: string, value: string) => {
    // 特殊型別處理
    let parsedValue: unknown = value;
    if (value === "true") parsedValue = true;
    else if (value === "false") parsedValue = false;
    else if (!isNaN(Number(value)) && value !== "") parsedValue = Number(value);

    updateNodeParams(selectedNode.id, { [key]: parsedValue } as never);
  };

  return (
    <div className="w-72 bg-gray-900 text-white overflow-y-auto h-full p-3 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-gray-300">節點設定</h2>
        <button
          onClick={() => removeNode(selectedNode.id)}
          className="text-red-400 hover:text-red-300 text-xs cursor-pointer"
        >
          刪除
        </button>
      </div>

      {/* Node ID */}
      <div className="text-[10px] text-gray-500 font-mono">{selectedNode.id}</div>

      {/* Label */}
      <ParamField
        label="節點名稱"
        value={data.label}
        onChange={(v) => updateNodeLabel(selectedNode.id, v)}
      />

      {/* Divider */}
      <hr className="border-gray-700" />

      {/* Params */}
      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-gray-400">參數</h3>
        {renderParams(data, handleParamUpdate)}
      </div>

      {/* Ports Info */}
      <hr className="border-gray-700" />
      <div className="flex flex-col gap-1">
        <h3 className="text-xs font-semibold text-gray-400">端口</h3>
        {data.inputs.length > 0 && (
          <div>
            <span className="text-[10px] text-gray-500">輸入: </span>
            {data.inputs.map((p) => (
              <span key={p.id} className="text-[10px] text-indigo-400 mr-1">
                {p.label}
              </span>
            ))}
          </div>
        )}
        {data.outputs.length > 0 && (
          <div>
            <span className="text-[10px] text-gray-500">輸出: </span>
            {data.outputs.map((p) => (
              <span key={p.id} className="text-[10px] text-amber-400 mr-1">
                {p.label}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
