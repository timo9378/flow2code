"use client";

/**
 * 節點庫面板（左側面板）
 * 
 * 讓使用者從分類列表中拖放節點到畫布上。
 */

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

interface NodeTemplate {
  nodeType: NodeType;
  label: string;
  icon: string;
  category: NodeCategory;
}

const nodeTemplates: Record<string, NodeTemplate[]> = {
  "⚡ 觸發器": [
    { nodeType: TriggerType.HTTP_WEBHOOK, label: "HTTP Webhook", icon: "🌐", category: NodeCategory.TRIGGER },
    { nodeType: TriggerType.CRON_JOB, label: "Cron Job", icon: "⏰", category: NodeCategory.TRIGGER },
    { nodeType: TriggerType.MANUAL, label: "Manual", icon: "👤", category: NodeCategory.TRIGGER },
  ],
  "🔧 執行器": [
    { nodeType: ActionType.FETCH_API, label: "Fetch API", icon: "📡", category: NodeCategory.ACTION },
    { nodeType: ActionType.SQL_QUERY, label: "SQL Query", icon: "🗄️", category: NodeCategory.ACTION },
    { nodeType: ActionType.REDIS_CACHE, label: "Redis Cache", icon: "💾", category: NodeCategory.ACTION },
    { nodeType: ActionType.CUSTOM_CODE, label: "Custom Code", icon: "💻", category: NodeCategory.ACTION },
  ],
  "🔀 邏輯控制": [
    { nodeType: LogicType.IF_ELSE, label: "If / Else", icon: "🔀", category: NodeCategory.LOGIC },
    { nodeType: LogicType.FOR_LOOP, label: "For Loop", icon: "🔁", category: NodeCategory.LOGIC },
    { nodeType: LogicType.TRY_CATCH, label: "Try / Catch", icon: "🛡️", category: NodeCategory.LOGIC },
    { nodeType: LogicType.PROMISE_ALL, label: "Promise.all", icon: "⚡", category: NodeCategory.LOGIC },
  ],
  "📦 變數": [
    { nodeType: VariableType.DECLARE, label: "Declare Variable", icon: "📦", category: NodeCategory.VARIABLE },
    { nodeType: VariableType.TRANSFORM, label: "Transform", icon: "🔄", category: NodeCategory.VARIABLE },
  ],
  "📤 輸出": [
    { nodeType: OutputType.RETURN_RESPONSE, label: "Return Response", icon: "📤", category: NodeCategory.OUTPUT },
  ],
};

export default function NodeLibrary() {
  const addFlowNode = useFlowStore((s) => s.addFlowNode);

  const handleAddNode = (template: NodeTemplate) => {
    // 在畫布中央附近隨機位置添加
    const x = 200 + Math.random() * 300;
    const y = 100 + Math.random() * 400;
    addFlowNode(template.nodeType, template.category, { x, y });
  };

  return (
    <div className="w-60 bg-gray-900 text-white overflow-y-auto h-full p-3 flex flex-col gap-4">
      <h2 className="text-sm font-bold text-gray-300 uppercase tracking-wider">
        節點庫
      </h2>

      {Object.entries(nodeTemplates).map(([category, templates]) => (
        <div key={category}>
          <h3 className="text-xs font-semibold text-gray-400 mb-2">
            {category}
          </h3>
          <div className="flex flex-col gap-1">
            {templates.map((template) => (
              <button
                key={template.nodeType}
                onClick={() => handleAddNode(template)}
                className="
                  flex items-center gap-2 px-2 py-1.5 rounded-md text-xs
                  bg-gray-800 hover:bg-gray-700 transition-colors
                  text-gray-200 hover:text-white cursor-pointer
                  text-left
                "
              >
                <span>{template.icon}</span>
                <span>{template.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
