/**
 * Flow2Code Type Inference Engine
 *
 * 根據 FlowIR 的節點定義和端口型別，推斷 flowState 的 TypeScript 型別。
 * 取代 `Record<string, any>` 的粗暴宣告，讓生成的代碼具備真正的型別安全。
 *
 * 推斷策略：
 *   1. 觸發器節點：根據觸發器類型和參數推斷（如 HTTP body、query 等）
 *   2. Action 節點：根據 Plugin 的 getOutputType() 推斷
 *   3. 手動指定：使用端口的 dataType 作為 fallback
 *   4. 自動窄化：$input 引用會根據上游節點型別收窄
 */

import type { FlowIR, FlowNode, NodeType } from "../ir/types";
import { getPlugin } from "./plugins/types";

// ============================================================
// Type Inference API
// ============================================================

export interface FlowStateTypeInfo {
  /** 完整的 TypeScript interface 原始碼 */
  interfaceCode: string;
  /** 每個節點 ID 對應的 TypeScript 型別 */
  nodeTypes: Map<string, string>;
}

/**
 * 推斷 FlowIR 中所有節點的輸出型別，生成對應的 TypeScript interface。
 *
 * @param ir - Flow IR
 * @returns FlowStateTypeInfo 包含生成的 interface 和各節點型別映射
 */
export function inferFlowStateTypes(ir: FlowIR): FlowStateTypeInfo {
  const nodeTypes = new Map<string, string>();

  for (const node of ir.nodes) {
    const type = inferNodeOutputType(node);
    nodeTypes.set(node.id, type);
  }

  // 生成 interface 代碼（所有欄位為 optional，因為節點按拓撲順序執行，不一定每個都會被賦值）
  const fields = ir.nodes
    .map((node) => {
      const type = nodeTypes.get(node.id) || "unknown";
      const safeId = node.id;
      return `  '${safeId}'?: ${type};`;
    })
    .join("\n");

  const interfaceCode = `interface FlowState {\n${fields}\n}`;

  return { interfaceCode, nodeTypes };
}

/**
 * 生成 flowState 的宣告語句
 * 取代舊的 `const flowState: Record<string, any> = {}`
 */
export function generateFlowStateDeclaration(ir: FlowIR): string {
  const typeInfo = inferFlowStateTypes(ir);
  return `${typeInfo.interfaceCode}\nconst flowState: Partial<FlowState> = {};`;
}

// ============================================================
// 單節點型別推斷
// ============================================================

function inferNodeOutputType(node: FlowNode): string {
  // 1. 嘗試從 Plugin 取得型別
  const plugin = getPlugin(node.nodeType);
  if (plugin?.getOutputType) {
    return plugin.getOutputType(node);
  }

  // 2. 從端口的 dataType 推斷
  if (node.outputs.length > 0) {
    const primaryOutput = node.outputs[0];
    return mapFlowDataTypeToTS(primaryOutput.dataType);
  }

  // 3. Fallback
  return "unknown";
}

/**
 * 將 FlowDataType 映射為 TypeScript 型別
 */
function mapFlowDataTypeToTS(
  dataType: string
): string {
  switch (dataType) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "object":
      return "Record<string, unknown>";
    case "array":
      return "unknown[]";
    case "void":
      return "void";
    case "Response":
      return "Response";
    case "any":
    default:
      return "unknown";
  }
}
