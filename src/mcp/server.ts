/**
 * Flow2Code MCP Server — structural route analysis for AI agents
 *
 * Exposes the read-direction engine over the Model Context Protocol so
 * coding agents (Claude Code, Codex, OpenCode, …) can ask structural
 * questions about TypeScript API routes instead of re-deriving control
 * flow from raw text:
 *
 *   audit_route  — decompile a route into a flow graph + audit hints
 *   diff_routes  — semantic flow diff between two versions of a route
 *   flow_graph   — Mermaid flowchart of a route's control/data flow
 *
 * Started via `flow2code mcp` (stdio transport).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

import { decompile } from "../lib/compiler/decompiler";
import { diffRouteFiles, formatRouteFileDiffMarkdown } from "../lib/diff/route-diff";
import { toMermaid } from "../lib/diff/mermaid";

function readSource(args: { code?: string; file_path?: string }): { code: string; fileName: string } {
  if (args.code) return { code: args.code, fileName: "route.ts" };
  if (args.file_path) {
    return { code: readFileSync(args.file_path, "utf-8"), fileName: basename(args.file_path) };
  }
  throw new Error("Provide either `code` or `file_path`.");
}

const sourceInput = {
  code: z.string().optional().describe("TypeScript source of the route (alternative to file_path)"),
  file_path: z.string().optional().describe("Path to the route file (alternative to code)"),
};

export async function startMcpServer(): Promise<void> {
  const server = new McpServer({
    name: "flow2code",
    version: "0.5.1",
  });

  server.registerTool(
    "audit_route",
    {
      title: "Audit a TypeScript API route",
      description:
        "Decompiles a TypeScript API route into a control/data flow graph and returns " +
        "structural audit findings (missing error handling, unchecked fetches, branch " +
        "coverage) with line numbers, plus a node summary and confidence score. " +
        "Use this to understand or review a route without reading it line by line.",
      inputSchema: sourceInput,
    },
    async (args) => {
      const { code, fileName } = readSource(args);
      const result = decompile(code, { fileName, audit: true });
      if (!result.success) {
        return {
          content: [{ type: "text", text: `Decompile failed: ${(result.errors ?? []).join("; ")}` }],
          isError: true,
        };
      }
      const nodes = result.ir!.nodes.map((n) => ({
        id: n.id,
        type: n.nodeType,
        label: n.label,
      }));
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                confidence: result.confidence,
                nodeCount: nodes.length,
                nodes,
                auditHints: result.audit ?? [],
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  server.registerTool(
    "diff_routes",
    {
      title: "Semantic flow diff between two route versions",
      description:
        "Compares two versions of a TypeScript API route at the flow level and reports " +
        "reviewer-relevant changes: removed error handling, changed branch conditions, " +
        "added/removed response paths and external calls. Returns a Markdown report. " +
        "Robust to formatting changes and statement reordering — use this instead of a " +
        "text diff when reviewing route changes.",
      inputSchema: {
        before_code: z.string().optional().describe("Old version source (alternative to before_path)"),
        before_path: z.string().optional().describe("Path to old version (alternative to before_code)"),
        after_code: z.string().optional().describe("New version source (alternative to after_path)"),
        after_path: z.string().optional().describe("Path to new version (alternative to after_code)"),
        file_name: z.string().optional().describe("Display name for the report header"),
      },
    },
    async (args) => {
      const before = readSource({ code: args.before_code, file_path: args.before_path });
      const after = readSource({ code: args.after_code, file_path: args.after_path });
      const fileName = args.file_name ?? after.fileName;
      const result = diffRouteFiles(before.code, after.code, { fileName });
      const md = formatRouteFileDiffMarkdown(result, { fileName });
      return {
        content: [{ type: "text", text: md }],
        isError: !result.success,
      };
    }
  );

  server.registerTool(
    "flow_graph",
    {
      title: "Render a route's flow as a Mermaid diagram",
      description:
        "Decompiles a TypeScript API route and returns a Mermaid flowchart of its " +
        "control/data flow — triggers, branches, external calls, response paths. " +
        "Useful for explaining a route's structure to a human.",
      inputSchema: sourceInput,
    },
    async (args) => {
      const { code, fileName } = readSource(args);
      const result = decompile(code, { fileName, audit: false });
      if (!result.success) {
        return {
          content: [{ type: "text", text: `Decompile failed: ${(result.errors ?? []).join("; ")}` }],
          isError: true,
        };
      }
      const mermaid = toMermaid(result.ir!, { maxNodes: 80 });
      if (!mermaid) {
        return {
          content: [{ type: "text", text: "Graph too large to render (>80 nodes)." }],
          isError: true,
        };
      }
      return { content: [{ type: "text", text: "```mermaid\n" + mermaid + "\n```" }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
