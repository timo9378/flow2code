/**
 * AI API Settings Store
 *
 * Manages custom AI API endpoint configurations, supporting:
 * - Environment variables (fallback behavior)
 * - Custom OpenAI-compatible endpoints (e.g., copilot-api proxy, Gemini Web API)
 * - Settings persistence (localStorage)
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AIEndpointConfig {
  /** Display name */
  name: string;
  /** API Base URL (e.g., http://localhost:4141 or https://your-proxy.com/v1) */
  baseUrl: string;
  /** API Key (can be empty, some proxies don't require it) */
  apiKey: string;
  /** Model name */
  model: string;
  /** Whether to use response_format: json_object (some APIs don't support it) */
  supportsJsonMode: boolean;
}

interface AISettingsState {
  /** Active endpoint ID ('env' = use environment variables, '0' = first custom endpoint) */
  activeEndpointId: string;
  /** Custom endpoint list */
  endpoints: AIEndpointConfig[];

  // Actions
  setActiveEndpoint: (id: string) => void;
  addEndpoint: (config: AIEndpointConfig) => void;
  updateEndpoint: (index: number, config: AIEndpointConfig) => void;
  removeEndpoint: (index: number) => void;
  getActiveConfig: () => AIEndpointConfig | null;
}

/** Default copilot-api endpoint (user-configurable) */
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
      activeEndpointId: "0",
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
          // If the removed endpoint was active, fall back to first endpoint
          const removedWasActive = s.activeEndpointId === String(index);
          return {
            endpoints: newEndpoints,
            activeEndpointId: removedWasActive ? "0" : s.activeEndpointId,
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
