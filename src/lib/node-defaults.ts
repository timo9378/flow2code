/**
 * 節點預設值定義（向下相容層）
 *
 * 現在委託給 NodeRegistry — 這些函式保留是為了不破壞既有呼叫者。
 * 新程式碼應直接使用 `nodeRegistry` 或 `NodeRegistry` class。
 *
 * @see {@link ./node-registry.ts}
 */

import { type NodeType, type NodeCategory, type NodeParamsMap, type InputPort, type OutputPort } from "@/lib/ir/types";
import { nodeRegistry } from "@/lib/node-registry";

/**
 * 取得節點類型的預設輸入/輸出端口
 */
export function getDefaultPorts(nodeType: NodeType): {
  inputs: InputPort[];
  outputs: OutputPort[];
} {
  return nodeRegistry.getDefaultPorts(nodeType);
}

/**
 * 取得節點類型的預設參數
 */
export function getDefaultParams(nodeType: NodeType): NodeParamsMap[NodeType] {
  return nodeRegistry.getDefaultParams(nodeType) as NodeParamsMap[NodeType];
}

/**
 * 取得節點類型的預設標籤
 */
export function getDefaultLabel(nodeType: NodeType): string {
  return nodeRegistry.getDefaultLabel(nodeType);
}

/**
 * 從節點類型推斷分類
 */
export function getCategoryForType(nodeType: NodeType): NodeCategory {
  return nodeRegistry.getCategoryForType(nodeType);
}
