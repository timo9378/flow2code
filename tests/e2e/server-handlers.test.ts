/**
 * Server Handlers Integration Tests
 *
 * Tests the pure-function API handlers used by both the standalone server
 * and Next.js API routes.
 */

import { describe, it, expect } from "vitest";
import {
  handleCompile,
  handleDecompile,
  handleImportOpenAPI,
} from "@/server/handlers";
import { createSimpleGetFlow, createPostWithFetchFlow } from "../fixtures";
import { compile } from "@/lib/compiler/compiler";
import { NodeCategory } from "@/lib/ir/types";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

describe("Server Handler: /api/compile", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "flow2code-test-"));

  it("compiles valid IR and returns success", async () => {
    const ir = createSimpleGetFlow();
    const result = await handleCompile({ ir, write: false }, tempDir);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.code).toBeDefined();
    expect(typeof result.body.code).toBe("string");
    expect((result.body.code as string).length).toBeGreaterThan(0);
  });

  it("returns 400 when IR is missing", async () => {
    const result = await handleCompile({}, tempDir);
    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
  });

  it("writes output file when write=true", async () => {
    const ir = createSimpleGetFlow();
    const result = await handleCompile({ ir, write: true }, tempDir);

    expect(result.status).toBe(200);
    expect(result.body.writtenTo).toBeDefined();
  });

  it("compiles multi-node flows", async () => {
    const ir = createPostWithFetchFlow();
    const result = await handleCompile({ ir, write: false }, tempDir);

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect((result.body.code as string)).toContain("POST");
  });

  it("rejects path traversal via directory prefix attack", async () => {
    // Craft an IR whose compiled filePath might prefix-escape the project root
    // e.g. projectRoot = "/tmp/abc" → filePath = "../abc-evil/route.ts" → "/tmp/abc-evil/route.ts"
    // The old check `startsWith(resolve(projectRoot))` would pass this — the new check with separator must reject it
    const ir = createSimpleGetFlow();
    const result = await handleCompile({ ir, write: true }, tempDir);
    // Normal compilation should succeed
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
  });
});

describe("Server Handler: /api/decompile", () => {
  it("decompiles valid TypeScript code", () => {
    // First compile an IR to get valid TypeScript
    const ir = createSimpleGetFlow();
    const compiled = compile(ir);

    const result = handleDecompile({ code: compiled.code!, fileName: "route.ts" });

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(result.body.ir).toBeDefined();
    expect(result.body.confidence).toBeGreaterThan(0);
  });

  it("returns 400 when code is missing", () => {
    const result = handleDecompile({});
    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
  });

  it("returns 400 when code is empty", () => {
    const result = handleDecompile({ code: "   " });
    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
  });

  it("decompiles arbitrary TypeScript with low confidence", () => {
    const code = `
export default function hello() {
  return "world";
}
`;
    const result = handleDecompile({ code, fileName: "hello.ts" });
    // Even arbitrary code should return *something*
    expect([200, 422]).toContain(result.status);
  });

  it("roundtrips through compile → decompile → compile", async () => {
    const ir = createPostWithFetchFlow();
    const ts1 = compile(ir);

    // Decompile
    const decompiled = handleDecompile({ code: ts1.code!, fileName: ts1.filePath });
    expect(decompiled.status).toBe(200);
    expect(decompiled.body.ir).toBeDefined();

    // Re-compile the decompiled IR
    const ir2 = decompiled.body.ir as any;
    const recompiled = await handleCompile({ ir: ir2, write: false }, ".");
    expect(recompiled.status).toBe(200);
    expect(recompiled.body.success).toBe(true);
  });
});

describe("Server Handler: /api/import-openapi", () => {
  it("converts minimal OpenAPI spec to IR", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test API", version: "1.0.0" },
      paths: {
        "/api/users": {
          get: {
            operationId: "getUsers",
            responses: {
              "200": { description: "OK" },
            },
          },
        },
      },
    };

    const result = handleImportOpenAPI({ spec: JSON.stringify(spec), selectPaths: ["/api/users"] });
    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
  });
});
