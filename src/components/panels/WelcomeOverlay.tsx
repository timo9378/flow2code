"use client";

/**
 * Welcome Overlay — shown when the canvas is empty.
 *
 * Provides orientation for new users: quick-start actions and an
 * example flow that can be loaded with one click.
 */

import { useFlowStore } from "@/store/flow-store";
import { type FlowIR, TriggerType, VariableType, LogicType, ActionType, OutputType, NodeCategory } from "@/lib/ir/types";
import { Button } from "@/components/ui/button";

// ── Example flow: GET /api/users with auth check ──
const EXAMPLE_FLOW: FlowIR = {
  version: "1.0.0",
  meta: {
    name: "User List API",
    description: "GET /api/users — Auth check → Fetch users → Return JSON",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  nodes: [
    {
      id: "trigger_1",
      nodeType: TriggerType.HTTP_WEBHOOK,
      category: NodeCategory.TRIGGER,
      label: "GET /api/users",
      params: { method: "GET", routePath: "/api/users", parseBody: false },
      inputs: [],
      outputs: [{ id: "request", label: "Request", dataType: "object" }],
    },
    {
      id: "transform_1",
      nodeType: VariableType.TRANSFORM,
      category: NodeCategory.VARIABLE,
      label: "Get Auth Token",
      params: { expression: "req.headers.get('authorization')" },
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [{ id: "result", label: "Result", dataType: "any" }],
    },
    {
      id: "if_1",
      nodeType: LogicType.IF_ELSE,
      category: NodeCategory.LOGIC,
      label: "Has Token?",
      params: { condition: "token !== undefined && token !== ''" },
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [
        { id: "true", label: "Yes", dataType: "any" },
        { id: "false", label: "No", dataType: "any" },
      ],
    },
    {
      id: "fetch_1",
      nodeType: ActionType.FETCH_API,
      category: NodeCategory.ACTION,
      label: "Fetch Users",
      params: { url: "https://jsonplaceholder.typicode.com/users", method: "GET", parseJson: true },
      inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
      outputs: [{ id: "data", label: "Data", dataType: "any" }],
    },
    {
      id: "response_1",
      nodeType: OutputType.RETURN_RESPONSE,
      category: NodeCategory.OUTPUT,
      label: "200 OK",
      params: { statusCode: 200, bodyExpression: "flowState['fetch_1']" },
      inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
      outputs: [],
    },
    {
      id: "response_2",
      nodeType: OutputType.RETURN_RESPONSE,
      category: NodeCategory.OUTPUT,
      label: "401 Unauthorized",
      params: { statusCode: 401, bodyExpression: "{ error: 'Missing auth token' }" },
      inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
      outputs: [],
    },
  ],
  edges: [
    { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "transform_1", targetPortId: "input" },
    { id: "e2", sourceNodeId: "transform_1", sourcePortId: "result", targetNodeId: "if_1", targetPortId: "input" },
    { id: "e3", sourceNodeId: "if_1", sourcePortId: "true", targetNodeId: "fetch_1", targetPortId: "input" },
    { id: "e4", sourceNodeId: "fetch_1", sourcePortId: "data", targetNodeId: "response_1", targetPortId: "data" },
    { id: "e5", sourceNodeId: "if_1", sourcePortId: "false", targetNodeId: "response_2", targetPortId: "data" },
  ],
};

interface WelcomeOverlayProps {
  onDismiss: () => void;
}

export default function WelcomeOverlay({ onDismiss }: WelcomeOverlayProps) {
  const loadIR = useFlowStore((s) => s.loadIR);

  const handleLoadExample = () => {
    loadIR(EXAMPLE_FLOW);
    onDismiss();
  };

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto max-w-lg w-full mx-4">
        {/* Main card */}
        <div className="bg-[oklch(0.15_0_0)] border border-[oklch(0.25_0_0)] rounded-xl overflow-hidden">

          {/* Header */}
          <div className="px-8 pt-8 pb-4">
            <div className="flex items-center gap-3 mb-1">
              <span className="text-2xl font-bold text-[oklch(0.95_0_0)] tracking-tight">
                Flow2Code
              </span>
              <span className="text-[10px] font-mono bg-[oklch(0.22_0_0)] text-[oklch(0.6_0_0)] px-2 py-0.5 rounded">
                v0.1.4
              </span>
            </div>
            <p className="text-sm text-[oklch(0.55_0_0)] leading-relaxed mt-2">
              Build API handlers visually, compile to native TypeScript.
              <br />
              Drag nodes from the left panel, connect ports, then hit Compile.
            </p>
          </div>

          {/* Quick start hints */}
          <div className="px-8 pb-4">
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <Hint icon="1" text="Drag a Trigger node to start" />
              <Hint icon="2" text="Add Actions for your logic" />
              <Hint icon="3" text="Connect ports with edges" />
              <Hint icon="4" text="Click Compile to generate TS" />
            </div>
          </div>

          {/* Keyboard shortcuts */}
          <div className="px-8 pb-5">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[oklch(0.45_0_0)]">
              <span><Kbd>Ctrl+Z</Kbd> Undo</span>
              <span><Kbd>Ctrl+Shift+Z</Kbd> Redo</span>
              <span><Kbd>Delete</Kbd> Remove selected</span>
              <span><Kbd>Click edge</Kbd> Select → Delete</span>
            </div>
          </div>

          {/* Actions */}
          <div className="border-t border-[oklch(0.22_0_0)] px-8 py-4 flex items-center gap-3">
            <Button
              onClick={handleLoadExample}
              className="bg-[oklch(0.65_0.2_260)] hover:bg-[oklch(0.6_0.2_260)] text-white text-sm h-9 px-4"
            >
              Load example flow
            </Button>
            <Button
              variant="ghost"
              onClick={onDismiss}
              className="text-sm text-[oklch(0.55_0_0)] hover:text-[oklch(0.8_0_0)] h-9 px-4"
            >
              Start from scratch
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Small components ──

function Hint({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="flex items-center gap-2 text-[oklch(0.6_0_0)]">
      <span className="w-4 h-4 rounded bg-[oklch(0.22_0_0)] text-[oklch(0.5_0_0)] flex items-center justify-center text-[10px] font-mono shrink-0">
        {icon}
      </span>
      <span>{text}</span>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block px-1 py-0.5 rounded bg-[oklch(0.2_0_0)] border border-[oklch(0.28_0_0)] text-[oklch(0.6_0_0)] font-mono text-[9px] mx-0.5">
      {children}
    </kbd>
  );
}
