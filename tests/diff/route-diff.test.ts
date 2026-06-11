/**
 * Route Diff Tests — semantic flow diff between two TypeScript versions
 *
 * The critical property: node IDs renumber when statements shift, so the
 * diff must align nodes by content, never by ID. A one-line insertion at the
 * top of a route must NOT report the rest of the file as rewritten.
 */

import { describe, it, expect } from "vitest";
import { diffRoutes, formatRouteDiffMarkdown } from "../../src/lib/diff/route-diff";

const BASE_ROUTE = `
export async function POST(req: Request) {
  const body = await req.json();

  if (!body.email) {
    return Response.json({ error: "Email required" }, { status: 400 });
  }

  try {
    const res = await fetch("https://api.example.com/users", {
      method: "POST",
      body: JSON.stringify(body),
    });
    const user = await res.json();
    return Response.json({ user }, { status: 201 });
  } catch (err) {
    return Response.json({ error: "Upstream failed" }, { status: 502 });
  }
}
`;

describe("diffRoutes: noise resistance", () => {
  it("reports zero changes for identical code", () => {
    const result = diffRoutes(BASE_ROUTE, BASE_ROUTE);
    expect(result.success).toBe(true);
    expect(result.changes).toHaveLength(0);
    expect(result.stats.unchanged).toBeGreaterThan(0);
  });

  it("does NOT report the whole file when a statement is inserted early (ID shift)", () => {
    const after = BASE_ROUTE.replace(
      "const body = await req.json();",
      `const start = Date.now();\n  const body = await req.json();`
    );
    const result = diffRoutes(BASE_ROUTE, after);
    expect(result.success).toBe(true);
    // one declaration added; everything else must align despite renumbered IDs
    expect(result.stats.added).toBeLessThanOrEqual(2);
    expect(result.stats.removed).toBe(0);
  });

  it("reports no flow changes for formatting-only edits", () => {
    const after = BASE_ROUTE.replace(/\n\n/g, "\n").replace("{ user }", "{ user  }");
    const result = diffRoutes(BASE_ROUTE, after);
    expect(result.success).toBe(true);
    expect(result.stats.added).toBe(0);
    expect(result.stats.removed).toBe(0);
  });
});

describe("diffRoutes: reviewer-level signals", () => {
  it("flags removed try/catch as a warning", () => {
    const after = `
export async function POST(req: Request) {
  const body = await req.json();

  if (!body.email) {
    return Response.json({ error: "Email required" }, { status: 400 });
  }

  const res = await fetch("https://api.example.com/users", {
    method: "POST",
    body: JSON.stringify(body),
  });
  const user = await res.json();
  return Response.json({ user }, { status: 201 });
}
`;
    const result = diffRoutes(BASE_ROUTE, after);
    expect(result.success).toBe(true);
    const warning = result.changes.find(
      (c) => c.severity === "warning" && c.nodeType === "try_catch" && c.type === "removed"
    );
    expect(warning).toBeDefined();
    // removing the try/catch also removes the 502 error path
    const lostErrorPath = result.changes.find(
      (c) => c.type === "removed" && c.description.includes("502")
    );
    expect(lostErrorPath).toBeDefined();
  });

  it("flags a changed branch condition as modified, not removed+added", () => {
    const after = BASE_ROUTE.replace("if (!body.email)", "if (!body.email || !body.name)");
    const result = diffRoutes(BASE_ROUTE, after);
    expect(result.success).toBe(true);
    const condChange = result.changes.find(
      (c) => c.type === "modified" && c.nodeType === "if_else"
    );
    expect(condChange).toBeDefined();
    expect(condChange!.description).toContain("body.name");
    expect(result.stats.removed).toBe(0);
  });

  it("flags response status changes", () => {
    const after = BASE_ROUTE.replace('{ status: 400 }', '{ status: 422 }');
    const result = diffRoutes(BASE_ROUTE, after);
    expect(result.success).toBe(true);
    const statusChange = result.changes.find(
      (c) => c.type === "modified" && c.nodeType === "return_response"
    );
    expect(statusChange).toBeDefined();
  });

  it("orders warnings before notices and infos", () => {
    const after = BASE_ROUTE
      .replace(/try \{[\s\S]*?\} catch \(err\) \{[\s\S]*?\}\n/, `const res = await fetch("https://api.example.com/users", { method: "POST" });
  const user = await res.json();
  const extra = 1;
  return Response.json({ user }, { status: 201 });
`);
    const result = diffRoutes(BASE_ROUTE, after);
    expect(result.success).toBe(true);
    const severities = result.changes.map((c) => c.severity);
    const firstNonWarning = severities.findIndex((s) => s !== "warning");
    if (firstNonWarning !== -1) {
      expect(severities.slice(firstNonWarning)).not.toContain("warning");
    }
  });

  it("surfaces newly introduced audit warnings", () => {
    const before = `
export async function GET(req: Request) {
  return Response.json({ ok: true });
}
`;
    const after = `
export async function GET(req: Request) {
  const data = await fetch("https://api.example.com/data");
  return Response.json(await data.json());
}
`;
    const result = diffRoutes(before, after);
    expect(result.success).toBe(true);
    expect(result.newWarnings.length).toBeGreaterThan(0);
  });
});

describe("diffRoutes: relocation tolerance (refactor false-positive guard)", () => {
  it("does not report a removed error path when the status code moved to another branch", () => {
    const before = `
export async function POST(req: Request) {
  const body = await req.json();
  if (!body.id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  return Response.json({ ok: true }, { status: 201 });
}
`;
    // same 400, but relocated under a different guard and rephrased
    const after = `
export async function POST(req: Request) {
  const body = await req.json();
  if (!body.id || !body.name) {
    return Response.json({ error: "id and name are required" }, { status: 400 });
  }
  return Response.json({ ok: true }, { status: 201 });
}
`;
    const result = diffRoutes(before, after);
    expect(result.success).toBe(true);
    const removedError = result.changes.find(
      (c) => c.type === "removed" && c.description.includes("400")
    );
    expect(removedError).toBeUndefined();
  });

  it("still reports a genuinely removed error path (status code gone entirely)", () => {
    const before = `
export async function POST(req: Request) {
  const body = await req.json();
  if (!body.id) {
    return Response.json({ error: "id required" }, { status: 400 });
  }
  return Response.json({ ok: true }, { status: 201 });
}
`;
    const after = `
export async function POST(req: Request) {
  const body = await req.json();
  return Response.json({ ok: true }, { status: 201 });
}
`;
    const result = diffRoutes(before, after);
    expect(result.success).toBe(true);
    const removedError = result.changes.find(
      (c) => c.type === "removed" && c.description.includes("400")
    );
    expect(removedError).toBeDefined();
  });

  it("does not report removed error handling when try/catch was only reindented", () => {
    const before = `
export async function GET(req: Request) {
  try {
    const r = await fetch("https://api.example.com");
    return Response.json(await r.json());
  } catch (err) {
    return Response.json({ error: "upstream" }, { status: 502 });
  }
}
`;
    // same try/catch, wrapped in an extra guard (reindented, restructured)
    const after = `
export async function GET(req: Request) {
  const flag = req.headers.get("x-flag");
  if (flag) {
    try {
      const r = await fetch("https://api.example.com");
      return Response.json(await r.json());
    } catch (err) {
      return Response.json({ error: "upstream" }, { status: 502 });
    }
  }
  return Response.json({ ok: true });
}
`;
    const result = diffRoutes(before, after);
    expect(result.success).toBe(true);
    const removedTry = result.changes.find(
      (c) => c.type === "removed" && c.nodeType === "try_catch"
    );
    expect(removedTry).toBeUndefined();
  });

  it("still reports try/catch removal when the count actually drops", () => {
    const before = `
export async function GET(req: Request) {
  try {
    const r = await fetch("https://api.example.com");
    return Response.json(await r.json());
  } catch (err) {
    return Response.json({ error: "upstream" }, { status: 502 });
  }
}
`;
    const after = `
export async function GET(req: Request) {
  const r = await fetch("https://api.example.com");
  return Response.json(await r.json());
}
`;
    const result = diffRoutes(before, after);
    expect(result.success).toBe(true);
    const removedTry = result.changes.find(
      (c) => c.type === "removed" && c.nodeType === "try_catch"
    );
    expect(removedTry).toBeDefined();
  });
});

describe("diffRoutes: failure handling", () => {
  it("fails gracefully when one side has no analyzable handler", () => {
    const result = diffRoutes(`export { GET } from "./other";`, BASE_ROUTE);
    expect(result.success).toBe(false);
    expect(result.errors?.[0]).toContain("before");
  });
});

describe("formatRouteDiffMarkdown", () => {
  it("renders a PR-ready markdown section with mermaid graph", () => {
    const after = BASE_ROUTE.replace("if (!body.email)", "if (!body.email || !body.name)");
    const result = diffRoutes(BASE_ROUTE, after);
    const md = formatRouteDiffMarkdown(result, { fileName: "src/app/api/users/route.ts" });

    expect(md).toContain("#### `src/app/api/users/route.ts`");
    expect(md).toContain("```mermaid");
    expect(md).toContain("flowchart TD");
    expect(md).toContain("confidence");
  });

  it("renders a refactor-only note when nothing changed", () => {
    const result = diffRoutes(BASE_ROUTE, BASE_ROUTE);
    const md = formatRouteDiffMarkdown(result, { fileName: "route.ts" });
    expect(md).toContain("refactor only");
  });

  it("renders an analysis-failure note instead of throwing", () => {
    const result = diffRoutes("not typescript at all {{{", BASE_ROUTE);
    const md = formatRouteDiffMarkdown(result, { fileName: "broken.ts" });
    expect(md).toContain("Could not analyze");
  });
});
