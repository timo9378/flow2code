/**
 * Test IR Example Factory
 * 
 * Provides various preset FlowIR objects for testing.
 */

import type {
  FlowIR,
  FlowNode,
  FlowEdge,
} from "@/lib/ir/types";
import {
  NodeCategory,
  TriggerType,
  ActionType,
  LogicType,
  OutputType,
} from "@/lib/ir/types";

/**
 * Simplest HTTP GET → Return Response flow
 */
export function createSimpleGetFlow(): FlowIR {
  return {
    version: "1.0.0",
    meta: {
      name: "Simple GET",
      description: "GET /api/hello → Response",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "GET /api/hello",
        params: {
          method: "GET",
          routePath: "/api/hello",
          parseBody: false,
        },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "response_1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Return Hello",
        params: {
          statusCode: 200,
          bodyExpression: '{ message: "Hello World" }',
        },
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      },
    ],
    edges: [
      {
        id: "e1",
        sourceNodeId: "trigger_1",
        sourcePortId: "request",
        targetNodeId: "response_1",
        targetPortId: "data",
      },
    ],
  };
}

/**
 * POST → Fetch API → Return Response
 */
export function createPostWithFetchFlow(): FlowIR {
  return {
    version: "1.0.0",
    meta: {
      name: "POST with Fetch",
      description: "POST → Fetch external API → Response",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "POST /api/proxy",
        params: {
          method: "POST",
          routePath: "/api/proxy",
          parseBody: true,
        },
        inputs: [],
        outputs: [
          { id: "request", label: "Request", dataType: "object" },
          { id: "body", label: "Body", dataType: "object" },
        ],
      },
      {
        id: "fetch_1",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Call External API",
        params: {
          url: "https://jsonplaceholder.typicode.com/posts",
          method: "GET",
          parseJson: true,
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [
          { id: "response", label: "Response", dataType: "object" },
          { id: "data", label: "Data", dataType: "any" },
        ],
      },
      {
        id: "response_1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Return Data",
        params: {
          statusCode: 200,
          bodyExpression: "{ data: flowState['fetch_1'] }",
        },
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      },
    ],
    edges: [
      {
        id: "e1",
        sourceNodeId: "trigger_1",
        sourcePortId: "request",
        targetNodeId: "fetch_1",
        targetPortId: "input",
      },
      {
        id: "e2",
        sourceNodeId: "fetch_1",
        sourcePortId: "data",
        targetNodeId: "response_1",
        targetPortId: "data",
      },
    ],
  };
}

/**
 * POST → If/Else → (True: Response 200) / (False: Response 400)
 */
export function createIfElseFlow(): FlowIR {
  return {
    version: "1.0.0",
    meta: {
      name: "If/Else Flow",
      description: "Conditional branching",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "POST /api/check",
        params: {
          method: "POST",
          routePath: "/api/check",
          parseBody: true,
        },
        inputs: [],
        outputs: [{ id: "body", label: "Body", dataType: "object" }],
      },
      {
        id: "if_1",
        nodeType: LogicType.IF_ELSE,
        category: NodeCategory.LOGIC,
        label: "Check Valid",
        params: {
          condition: "flowState['trigger_1'].body.valid === true",
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: true }],
        outputs: [
          { id: "true", label: "True", dataType: "any" },
          { id: "false", label: "False", dataType: "any" },
        ],
      },
      {
        id: "response_ok",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Success Response",
        params: {
          statusCode: 200,
          bodyExpression: '{ success: true }',
        },
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      },
      {
        id: "response_err",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Error Response",
        params: {
          statusCode: 400,
          bodyExpression: '{ success: false, error: "Invalid input" }',
        },
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      },
    ],
    edges: [
      {
        id: "e1",
        sourceNodeId: "trigger_1",
        sourcePortId: "body",
        targetNodeId: "if_1",
        targetPortId: "input",
      },
      {
        id: "e2",
        sourceNodeId: "if_1",
        sourcePortId: "true",
        targetNodeId: "response_ok",
        targetPortId: "data",
      },
      {
        id: "e3",
        sourceNodeId: "if_1",
        sourcePortId: "false",
        targetNodeId: "response_err",
        targetPortId: "data",
      },
    ],
  };
}

/**
 * Invalid IR with cycles (for testing the validator)
 */
export function createCyclicFlow(): FlowIR {
  return {
    version: "1.0.0",
    meta: {
      name: "Cyclic (Invalid)",
      description: "Should fail validation",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "Trigger",
        params: { method: "GET", routePath: "/api/cycle", parseBody: false },
        inputs: [],
        outputs: [{ id: "output", label: "Output", dataType: "any" }],
      },
      {
        id: "node_a",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Node A",
        params: { code: "const a = 1;", returnVariable: "a" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
      {
        id: "node_b",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Node B",
        params: { code: "const b = 2;", returnVariable: "b" },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "result", label: "Result", dataType: "any" }],
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "output", targetNodeId: "node_a", targetPortId: "input" },
      { id: "e2", sourceNodeId: "node_a", sourcePortId: "result", targetNodeId: "node_b", targetPortId: "input" },
      // Cycle!
      { id: "e3", sourceNodeId: "node_b", sourcePortId: "result", targetNodeId: "node_a", targetPortId: "input" },
    ],
  };
}

/**
 * Concurrent node flow: Trigger → (Fetch1 & Fetch2) → Merge → Response
 */
export function createConcurrentFlow(): FlowIR {
  return {
    version: "1.0.0",
    meta: {
      name: "Concurrent Flow",
      description: "Two parallel fetches then merge",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "GET /api/parallel",
        params: { method: "GET", routePath: "/api/parallel", parseBody: false },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "fetch_1",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch Users",
        params: { url: "https://api.example.com/users", method: "GET", parseJson: true },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "data", label: "Data", dataType: "any" }],
      },
      {
        id: "fetch_2",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch Posts",
        params: { url: "https://api.example.com/posts", method: "GET", parseJson: true },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "data", label: "Data", dataType: "any" }],
      },
      {
        id: "response_1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Merge & Return",
        params: {
          statusCode: 200,
          bodyExpression: "{ users: flowState['fetch_1'], posts: flowState['fetch_2'] }",
        },
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_1", targetPortId: "input" },
      { id: "e2", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_2", targetPortId: "input" },
      { id: "e3", sourceNodeId: "fetch_1", sourcePortId: "data", targetNodeId: "response_1", targetPortId: "data" },
      { id: "e4", sourceNodeId: "fetch_2", sourcePortId: "data", targetNodeId: "response_1", targetPortId: "data" },
    ],
  };
}

/**
 * Fetch flow with environment variables
 */
export function createEnvVarFlow(): FlowIR {
  return {
    version: "1.0.0",
    meta: {
      name: "Env Var Flow",
      description: "Fetch with env var in URL",
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    },
    nodes: [
      {
        id: "trigger_1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "GET /api/env",
        params: { method: "GET", routePath: "/api/env", parseBody: false },
        inputs: [],
        outputs: [{ id: "request", label: "Request", dataType: "object" }],
      },
      {
        id: "fetch_1",
        nodeType: ActionType.FETCH_API,
        category: NodeCategory.ACTION,
        label: "Fetch with Key",
        params: {
          url: "${API_BASE_URL}/data?key=${API_KEY}",
          method: "GET",
          parseJson: true,
        },
        inputs: [{ id: "input", label: "Input", dataType: "any", required: false }],
        outputs: [{ id: "data", label: "Data", dataType: "any" }],
      },
      {
        id: "response_1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Return",
        params: { statusCode: 200, bodyExpression: "flowState['fetch_1']" },
        inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
        outputs: [],
      },
    ],
    edges: [
      { id: "e1", sourceNodeId: "trigger_1", sourcePortId: "request", targetNodeId: "fetch_1", targetPortId: "input" },
      { id: "e2", sourceNodeId: "fetch_1", sourcePortId: "data", targetNodeId: "response_1", targetPortId: "data" },
    ],
  };
}
