/**
 * AI API 設定 Store
 *
 * 管理自訂 AI API 端點設定，支援：
 * - 環境變數（預設行為）
 * - 自訂 OpenAI 相容端點（如 copilot-api 逆向代理、Gemini Web API 等）
 * - 設定持久化（localStorage）
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AIEndpointConfig {
  /** 顯示名稱 */
  name: string;
  /** API Base URL（如 http://localhost:4141 或 https://your-proxy.com/v1） */
  baseUrl: string;
  /** API Key（可為空，部分逆向代理不需要） */
  apiKey: string;
  /** 模型名稱 */
  model: string;
  /** 是否使用 response_format: json_object（部分 API 不支援） */
  supportsJsonMode: boolean;
}

interface AISettingsState {
  /** 目前啟用的端點 ID（'env' = 使用環境變數） */
  activeEndpointId: string;
  /** 自訂端點列表 */
  endpoints: AIEndpointConfig[];

  // Actions
  setActiveEndpoint: (id: string) => void;
  addEndpoint: (config: AIEndpointConfig) => void;
  updateEndpoint: (index: number, config: AIEndpointConfig) => void;
  removeEndpoint: (index: number) => void;
  getActiveConfig: () => AIEndpointConfig | null;
}

/** 預設 copilot-api 端點（使用者可修改） */
const DEFAULT_ENDPOINTS: AIEndpointConfig[] = [
  {
    name: "Copilot API (Local)",
    baseUrl: "http://localhost:4141/v1",
    apiKey: "",
    model: "gpt-4o",
    supportsJsonMode: true,
  },
];

export const useAISettingsStore = create<AISettingsState>()(
  persist(
    (set, get) => ({
      activeEndpointId: "env",
      endpoints: DEFAULT_ENDPOINTS,

      setActiveEndpoint: (id) => set({ activeEndpointId: id }),

      addEndpoint: (config) =>
        set((s) => ({ endpoints: [...s.endpoints, config] })),

      updateEndpoint: (index, config) =>
        set((s) => ({
          endpoints: s.endpoints.map((e, i) => (i === index ? config : e)),
        })),

      removeEndpoint: (index) =>
        set((s) => {
          const newEndpoints = s.endpoints.filter((_, i) => i !== index);
          // 如果刪除的是目前啟用的端點，切回環境變數
          const removedWasActive = s.activeEndpointId === String(index);
          return {
            endpoints: newEndpoints,
            activeEndpointId: removedWasActive ? "env" : s.activeEndpointId,
          };
        }),

      getActiveConfig: () => {
        const { activeEndpointId, endpoints } = get();
        if (activeEndpointId === "env") return null;
        const idx = parseInt(activeEndpointId, 10);
        return endpoints[idx] ?? null;
      },
    }),
    {
      name: "flow2code-ai-settings",
    }
  )
);
