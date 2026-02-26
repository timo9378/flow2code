/**
 * 節點預設值定義
 *
 * 從 flow-store.ts 提取，專注於節點的 ports / params / label 預設值。
 * 供 store 和其他需要節點預設值的模組共用。
 */

import {
  type NodeType,
  type NodeCategory,
  type NodeParamsMap,
  type InputPort,
  type OutputPort,
  NodeCategory as NC,
  TriggerType,
  ActionType,
  LogicType,
  VariableType,
  OutputType,
} from "@/lib/ir/types";

/**
 * 取得節點類型的預設輸入/輸出端口
 */
export function getDefaultPorts(nodeType: NodeType): {
  inputs: InputPort[];
  outputs: OutputPort[];
} {
  switch (nodeType) {
    case TriggerType.HTTP_WEBHOOK:
      return {
        inputs: [],
        outputs: [
          { id: "request", label: "Request", dataType: "object" },
          { id: "body", label: "Body", dataType: "object" },
          { id: "query", label: "Query", dataType: "object" },
        ],
      };
    case TriggerType.CRON_JOB:
    case TriggerType.MANUAL:
      return {
        inputs: [],
        outputs: [{ id: "output", label: "Output", dataType: "any" }],
      };
    case ActionType.FETCH_API:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "response", label: "Response", dataType: "object" },
          { id: "data", label: "Data", dataType: "any" },
        ],
      };
    case ActionType.SQL_QUERY:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "array" }],
      };
    case ActionType.REDIS_CACHE:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "value", label: "Value", dataType: "any" }],
      };
    case ActionType.CUSTOM_CODE:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      };
    case ActionType.CALL_SUBFLOW:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      };
    case LogicType.IF_ELSE:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
        outputs: [
          { id: "true", label: "True", dataType: "any" },
          { id: "false", label: "False", dataType: "any" },
        ],
      };
    case LogicType.FOR_LOOP:
      return {
        inputs: [{ id: "iterable", label: "Iterable", dataType: "array", required: true }],
        outputs: [
          { id: "item", label: "Item", dataType: "any" },
          { id: "result", label: "Result", dataType: "array" },
        ],
      };
    case LogicType.TRY_CATCH:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
        outputs: [
          { id: "success", label: "Success", dataType: "any" },
          { id: "error", label: "Error", dataType: "object" },
        ],
      };
    case LogicType.PROMISE_ALL:
      return {
        inputs: [
          { id: "task1", label: "Task 1", dataType: "any", required: true },
          { id: "task2", label: "Task 2", dataType: "any", required: true },
        ],
        outputs: [{ id: "results", label: "Results", dataType: "array" }],
      };
    case VariableType.DECLARE:
      return {
        inputs: [],
        outputs: [{ id: "value", label: "Value", dataType: "any" }],
      };
    case VariableType.TRANSFORM:
      return {
        inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
        outputs: [{ id: "output", label: "Output", dataType: "any" }],
      };
    case OutputType.RETURN_RESPONSE:
      return {
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      };
    default:
      return { inputs: [], outputs: [] };
  }
}

/**
 * 取得節點類型的預設參數
 */
export function getDefaultParams(nodeType: NodeType): NodeParamsMap[NodeType] {
  switch (nodeType) {
    case TriggerType.HTTP_WEBHOOK:
      return { method: "POST", routePath: "/api/endpoint", parseBody: true } as NodeParamsMap[typeof TriggerType.HTTP_WEBHOOK];
    case TriggerType.CRON_JOB:
      return { schedule: "0 * * * *", functionName: "cronHandler" } as NodeParamsMap[typeof TriggerType.CRON_JOB];
    case TriggerType.MANUAL:
      return { functionName: "handler", args: [] } as NodeParamsMap[typeof TriggerType.MANUAL];
    case ActionType.FETCH_API:
      return { url: "https://api.example.com", method: "GET", parseJson: true } as NodeParamsMap[typeof ActionType.FETCH_API];
    case ActionType.SQL_QUERY:
      return { orm: "drizzle", query: "SELECT * FROM users", params: [] } as NodeParamsMap[typeof ActionType.SQL_QUERY];
    case ActionType.REDIS_CACHE:
      return { operation: "get", key: "cache_key" } as NodeParamsMap[typeof ActionType.REDIS_CACHE];
    case ActionType.CUSTOM_CODE:
      return { code: "// your code here", returnVariable: "result" } as NodeParamsMap[typeof ActionType.CUSTOM_CODE];
    case ActionType.CALL_SUBFLOW:
      return { flowPath: "./sub-flow", functionName: "subHandler", inputMapping: {} } as NodeParamsMap[typeof ActionType.CALL_SUBFLOW];
    case LogicType.IF_ELSE:
      return { condition: "data !== null" } as NodeParamsMap[typeof LogicType.IF_ELSE];
    case LogicType.FOR_LOOP:
      return { iterableExpression: "items", itemVariable: "item" } as NodeParamsMap[typeof LogicType.FOR_LOOP];
    case LogicType.TRY_CATCH:
      return { errorVariable: "error" } as NodeParamsMap[typeof LogicType.TRY_CATCH];
    case LogicType.PROMISE_ALL:
      return {} as NodeParamsMap[typeof LogicType.PROMISE_ALL];
    case VariableType.DECLARE:
      return { name: "myVar", dataType: "string", isConst: true, initialValue: "''" } as NodeParamsMap[typeof VariableType.DECLARE];
    case VariableType.TRANSFORM:
      return { expression: "input.map(x => x)" } as NodeParamsMap[typeof VariableType.TRANSFORM];
    case OutputType.RETURN_RESPONSE:
      return { statusCode: 200, bodyExpression: "{{$input}}" } as NodeParamsMap[typeof OutputType.RETURN_RESPONSE];
    default:
      return {} as NodeParamsMap[NodeType];
  }
}

/**
 * 取得節點類型的預設標籤
 */
export function getDefaultLabel(nodeType: NodeType): string {
  const labels: Record<string, string> = {
    [TriggerType.HTTP_WEBHOOK]: "HTTP Webhook",
    [TriggerType.CRON_JOB]: "Cron Job",
    [TriggerType.MANUAL]: "Manual Trigger",
    [ActionType.FETCH_API]: "Fetch API",
    [ActionType.SQL_QUERY]: "SQL Query",
    [ActionType.REDIS_CACHE]: "Redis Cache",
    [ActionType.CUSTOM_CODE]: "Custom Code",
    [ActionType.CALL_SUBFLOW]: "Call Subflow",
    [LogicType.IF_ELSE]: "If / Else",
    [LogicType.FOR_LOOP]: "For Loop",
    [LogicType.TRY_CATCH]: "Try / Catch",
    [LogicType.PROMISE_ALL]: "Promise.all",
    [VariableType.DECLARE]: "Variable",
    [VariableType.TRANSFORM]: "Transform",
    [OutputType.RETURN_RESPONSE]: "Return Response",
  };
  return labels[nodeType] ?? "Unknown";
}

/**
 * 從節點類型推斷分類
 */
export function getCategoryForType(nodeType: NodeType): NodeCategory {
  if (Object.values(TriggerType).includes(nodeType as TriggerType)) return NC.TRIGGER;
  if (Object.values(ActionType).includes(nodeType as ActionType)) return NC.ACTION;
  if (Object.values(LogicType).includes(nodeType as LogicType)) return NC.LOGIC;
  if (Object.values(VariableType).includes(nodeType as VariableType)) return NC.VARIABLE;
  if (Object.values(OutputType).includes(nodeType as OutputType)) return NC.OUTPUT;
  return NC.ACTION;
}
