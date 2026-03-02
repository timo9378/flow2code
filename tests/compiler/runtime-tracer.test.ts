/**
 * Runtime Error Tracer Tests
 */

import { describe, it, expect } from "vitest";
import { traceError, formatTraceResults } from "@/lib/compiler/runtime-tracer";
import type { SourceMap } from "@/lib/compiler/compiler";
import type { FlowIR } from "@/lib/ir/types";
import { createSimpleGetFlow, createPostWithFetchFlow } from "../fixtures";

describe("traceError", () => {
  const sourceMap: SourceMap = {
    version: 1,
    generatedFile: "app/api/test/route.ts",
    mappings: {
      trigger_1: { startLine: 5, endLine: 10 },
      fetch_api_1: { startLine: 12, endLine: 20 },
      response_1: { startLine: 22, endLine: 30 },
    },
  };

  it("should trace error to correct node by line number", () => {
    const error = new Error("fetch failed");
    // Simulate stack containing route.ts:15
    error.stack = `Error: fetch failed
    at fetchData (app/api/test/route.ts:15:5)
    at handler (app/api/test/route.ts:8:3)`;

    const traces = traceError(error, sourceMap);
    expect(traces.length).toBeGreaterThan(0);

    // Should match fetch_api_1 (line 15 is between 12-20)
    const fetchTrace = traces.find((t) => t.nodeId === "fetch_api_1");
    expect(fetchTrace).toBeDefined();
    expect(fetchTrace!.startLine).toBe(12);
    expect(fetchTrace!.endLine).toBe(20);

    // Should also match trigger_1 (line 8 is between 5-10)
    const triggerTrace = traces.find((t) => t.nodeId === "trigger_1");
    expect(triggerTrace).toBeDefined();
  });

  it("should include deep link in trace result", () => {
    const error = new Error("oops");
    error.stack = `Error: oops\n    at fn (app/api/test/route.ts:15:5)`;

    const traces = traceError(error, sourceMap, undefined, "http://localhost:3001");
    expect(traces.length).toBe(1);
    expect(traces[0].deepLink).toBe("http://localhost:3001?highlight=fetch_api_1");
  });

  it("should include node label from IR if provided", () => {
    const ir = createPostWithFetchFlow();
    const sm: SourceMap = {
      version: 1,
      generatedFile: "route.ts",
      mappings: {
        trigger_1: { startLine: 1, endLine: 5 },
      },
    };
    const error = new Error("test");
    error.stack = `Error: test\n    at x (route.ts:3:1)`;

    const traces = traceError(error, sm, ir);
    expect(traces[0].nodeLabel).toBeTruthy();
  });

  it("should return empty array when no lines match", () => {
    const error = new Error("no match");
    error.stack = `Error: no match\n    at x (other-file.ts:100:1)`;

    const traces = traceError(error, sourceMap);
    expect(traces).toEqual([]);
  });

  it("should handle error without stack gracefully", () => {
    const error = new Error("no stack");
    error.stack = undefined;

    const traces = traceError(error, sourceMap);
    expect(traces).toEqual([]);
  });
});

describe("formatTraceResults", () => {
  it("should format trace results as readable string", () => {
    const traces = [
      {
        nodeId: "fetch_api_1",
        nodeLabel: "Fetch User",
        nodeType: "action:fetch_api",
        startLine: 12,
        endLine: 20,
        deepLink: "http://localhost:3001?highlight=fetch_api_1",
      },
    ];

    const formatted = formatTraceResults(new Error("oops"), traces, "route.ts");
    expect(formatted).toContain("fetch_api_1");
    expect(formatted).toContain("Fetch User");
    expect(formatted).toContain("http://localhost:3001?highlight=fetch_api_1");
    expect(formatted).toContain("oops");
  });

  it("should handle empty trace results", () => {
    const formatted = formatTraceResults(new Error("test"), [], "route.ts");
    expect(formatted).toContain("test");
  });
});
