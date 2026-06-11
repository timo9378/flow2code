/**
 * Multi-route file diff tests — every entry point analyzed, matched by
 * method+path, with added/removed routes surfaced as first-class changes.
 */

import { describe, it, expect } from "vitest";
import { decompileAll } from "../../src/lib/compiler/decompiler";
import { diffRouteFiles, formatRouteFileDiffMarkdown } from "../../src/lib/diff/route-diff";

const EXPRESS_FILE = `
import { Router } from "express";
const router = Router();

router.get("/items", async (req, res) => {
  const items = await db.item.findMany();
  res.json({ items });
});

router.post("/items", requireAuth, async (req, res) => {
  if (!req.body.name) {
    return res.status(400).json({ error: "Name required" });
  }
  const item = await db.item.create({ data: req.body });
  res.status(201).json(item);
});

router.delete("/items/:id", requireAuth, async (req, res) => {
  try {
    await db.item.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch (err) {
    res.status(404).json({ error: "Not found" });
  }
});

export default router;
`;

const NEXT_MULTI_METHOD = `
export async function GET(req: Request) {
  const items = await db.item.findMany();
  return Response.json({ items });
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.name) {
    return Response.json({ error: "Name required" }, { status: 400 });
  }
  return Response.json({ created: true }, { status: 201 });
}
`;

describe("decompileAll: every entry point", () => {
  it("finds all three Express router registrations with paths", () => {
    const result = decompileAll(EXPRESS_FILE, { fileName: "items.ts" });
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(3);
    expect(result.entries.map((e) => `${e.method} ${e.routePath}`)).toEqual([
      "GET /items",
      "POST /items",
      "DELETE /items/:id",
    ]);
    for (const e of result.entries) expect(e.result.success).toBe(true);
  });

  it("finds every exported HTTP method in a Next.js route file", () => {
    const result = decompileAll(NEXT_MULTI_METHOD, { fileName: "route.ts" });
    expect(result.success).toBe(true);
    expect(result.entries.map((e) => e.method)).toEqual(["GET", "POST"]);
  });

  it("falls back to the single best handler for non-HTTP files", () => {
    const result = decompileAll(`
export async function processQueue(jobs: string[]) {
  for (const job of jobs) { console.log(job); }
}
`, { fileName: "worker.ts" });
    expect(result.success).toBe(true);
    expect(result.entries).toHaveLength(1);
  });
});

describe("diffRouteFiles: per-route alignment", () => {
  it("reports zero changes for identical files", () => {
    const result = diffRouteFiles(EXPRESS_FILE, EXPRESS_FILE);
    expect(result.success).toBe(true);
    expect(result.stats.modified).toBe(0);
    expect(result.stats.unchanged).toBe(3);
    expect(result.hasWarnings).toBe(false);
  });

  it("only flags the route that actually changed", () => {
    const after = EXPRESS_FILE.replace("if (!req.body.name)", "if (false)");
    const result = diffRouteFiles(EXPRESS_FILE, after);
    expect(result.success).toBe(true);
    expect(result.stats.modified).toBe(1);
    expect(result.stats.unchanged).toBe(2);
    const changed = result.routes.find((r) => r.status === "modified");
    expect(changed!.key).toBe("POST /items");
  });

  it("flags a removed route as a warning-level change", () => {
    const after = EXPRESS_FILE.replace(
      /router\.delete\([\s\S]*?\}\);\n/,
      ""
    );
    const result = diffRouteFiles(EXPRESS_FILE, after);
    expect(result.success).toBe(true);
    expect(result.stats.removed).toBe(1);
    expect(result.hasWarnings).toBe(true);
    const removed = result.routes.find((r) => r.status === "removed");
    expect(removed!.key).toBe("DELETE /items/:id");
  });

  it("reports an added route with its audit warnings", () => {
    const after = EXPRESS_FILE.replace(
      "export default router;",
      `router.put("/items/:id", async (req, res) => {
  const item = await db.item.update({ where: { id: req.params.id }, data: req.body });
  res.json(item);
});

export default router;`
    );
    const result = diffRouteFiles(EXPRESS_FILE, after);
    expect(result.success).toBe(true);
    expect(result.stats.added).toBe(1);
    const added = result.routes.find((r) => r.status === "added");
    expect(added!.key).toBe("PUT /items/:id");
  });

  it("matches Next.js multi-method files per method", () => {
    const after = NEXT_MULTI_METHOD.replace('{ status: 400 }', '{ status: 422 }');
    const result = diffRouteFiles(NEXT_MULTI_METHOD, after);
    expect(result.success).toBe(true);
    expect(result.stats.modified).toBe(1);
    expect(result.routes.find((r) => r.status === "modified")!.key).toContain("POST");
  });
});

describe("formatRouteFileDiffMarkdown", () => {
  it("renders per-route sections with severity icons", () => {
    const after = EXPRESS_FILE
      .replace("if (!req.body.name)", "if (!req.body.name || !req.body.sku)")
      .replace(/router\.delete\([\s\S]*?\}\);\n/, "");
    const result = diffRouteFiles(EXPRESS_FILE, after);
    const md = formatRouteFileDiffMarkdown(result, { fileName: "src/routes/items.ts" });
    expect(md).toContain("`POST /items`");
    expect(md).toContain("Route removed: `DELETE /items/:id`");
    expect(md).toContain("⚠️");
  });

  it("renders refactor-only note when nothing changed", () => {
    const md = formatRouteFileDiffMarkdown(diffRouteFiles(EXPRESS_FILE, EXPRESS_FILE), { fileName: "items.ts" });
    expect(md).toContain("refactor only");
  });
});
