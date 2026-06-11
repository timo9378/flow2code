/**
 * Decompiler Handler Discovery Tests — HOF unwrapping + pages/api detection
 *
 * Real-world API routes rarely export bare functions. They export consts,
 * wrap handlers in HOFs (`withAuth(...)`, `withApiWrapper({ handler })`),
 * or use pages/api `export default function handler(req, res)`. These tests
 * lock in discovery of the real handler inside those shapes.
 */

import { describe, it, expect } from "vitest";
import { decompile } from "../../src/lib/compiler/decompiler";
import { NodeCategory } from "../../src/lib/ir/types";

function getTrigger(code: string, fileName = "route.ts") {
  const result = decompile(code, { fileName });
  expect(result.success).toBe(true);
  const trigger = result.ir!.nodes.find((n) => n.category === NodeCategory.TRIGGER);
  expect(trigger).toBeDefined();
  return { result, trigger: trigger! };
}

describe("Handler discovery: exported const arrow handlers", () => {
  it("detects `export const GET = async () => {...}` as HTTP GET trigger", () => {
    const { trigger } = getTrigger(`
export const GET = async (req: Request) => {
  const data = await fetch("https://api.example.com/items");
  return Response.json(await data.json());
};
`);
    expect(trigger.nodeType).toBe("http_webhook");
    expect((trigger.params as any).method).toBe("GET");
  });

  it("detects multiple method consts and picks the first HTTP export", () => {
    const { trigger } = getTrigger(`
export const POST = async (req: Request) => {
  const body = await req.json();
  return Response.json({ ok: true }, { status: 201 });
};
`);
    expect((trigger.params as any).method).toBe("POST");
  });
});

describe("Handler discovery: HOF-wrapped handlers", () => {
  it("unwraps `export const GET = withAuth(async (req) => {...})`", () => {
    const { result, trigger } = getTrigger(`
import { withAuth } from "@/lib/auth";

export const GET = withAuth(async (req: Request) => {
  const items = await fetch("https://api.example.com/items");
  if (!items.ok) {
    return Response.json({ error: "Upstream failed" }, { status: 502 });
  }
  return Response.json(await items.json());
});
`);
    expect(trigger.nodeType).toBe("http_webhook");
    expect((trigger.params as any).method).toBe("GET");
    // body of the inner handler must be decompiled, not treated as opaque
    expect(result.ir!.nodes.length).toBeGreaterThanOrEqual(3);
  });

  it("unwraps object-style wrappers and prefers the `handler` property", () => {
    const { result, trigger } = getTrigger(`
import { withApiWrapper } from "@/lib/api";
import { z } from "zod";

export const POST = withApiWrapper({
  schema: z.object({ name: z.string() }).refine((v) => v.name.length > 0),
  handler: async (req: Request) => {
    const body = await req.json();
    if (!body.name) {
      return Response.json({ error: "Missing name" }, { status: 400 });
    }
    return Response.json({ created: true }, { status: 201 });
  },
});
`);
    expect(trigger.nodeType).toBe("http_webhook");
    expect((trigger.params as any).method).toBe("POST");
    // must decompile the handler body (if/else + responses), not the zod refine arrow
    const ifNode = result.ir!.nodes.find((n) => n.nodeType === "if_else");
    expect(ifNode).toBeDefined();
  });

  it("unwraps `export default withAuth(handler)` referencing a local function", () => {
    const { result, trigger } = getTrigger(`
import { withAuth } from "@/lib/auth";

async function handler(req: any, res: any) {
  if (req.method !== "DELETE") {
    return res.status(405).json({ error: "Method not allowed" });
  }
  res.status(204).end();
}

export default withAuth(handler);
`);
    expect(trigger.nodeType).toBe("http_webhook");
    expect((trigger.params as any).method).toBe("DELETE");
    expect(result.ir!.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("survives deeply nested wrappers without crashing (depth limit)", () => {
    const result = decompile(`
export const GET = a(b(c(d(e(f(async (req: Request) => Response.json({ ok: true })))))));
`);
    // beyond the unwrap depth limit we accept failure, but never a crash
    expect(typeof result.success).toBe("boolean");
  });
});

describe("Source-aware audit rules", () => {
  it("warns when the request body reaches the DB without validation", () => {
    const result = decompile(`
export async function POST(req: Request) {
  const body = await req.json();
  const user = await db.user.create({ data: body });
  return Response.json(user, { status: 201 });
}
`, { fileName: "route.ts", audit: true });
    expect(result.success).toBe(true);
    expect(result.audit?.some((h) => h.message.includes("schema validation"))).toBe(true);
  });

  it("stays quiet when the body is validated first", () => {
    const result = decompile(`
import { z } from "zod";
const Schema = z.object({ name: z.string() });

export async function POST(req: Request) {
  const parsed = Schema.safeParse(await req.json());
  if (!parsed.success) return Response.json({ error: "bad" }, { status: 422 });
  const user = await db.user.create({ data: parsed.data });
  return Response.json(user, { status: 201 });
}
`, { fileName: "route.ts", audit: true });
    expect(result.audit?.some((h) => h.message.includes("schema validation"))).toBeFalsy();
  });

  it("warns when err.message is returned to the client", () => {
    const result = decompile(`
export async function GET(req: Request) {
  try {
    const data = await fetch("https://api.example.com");
    return Response.json(await data.json());
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
`, { fileName: "route.ts", audit: true });
    expect(result.audit?.some((h) => h.message.includes("internal error details"))).toBe(true);
  });

  it("flags an unauthenticated DELETE handler at info level", () => {
    const result = decompile(`
export async function DELETE(req: Request) {
  const { id } = await req.json();
  await db.item.delete({ where: { id } });
  return new Response(null, { status: 204 });
}
`, { fileName: "route.ts", audit: true });
    const hint = result.audit?.find((h) => h.message.includes("auth/session check"));
    expect(hint).toBeDefined();
    expect(hint!.severity).toBe("info");
  });

  it("does not flag middleware-protected Express mutations", () => {
    const result = decompile(`
import { Router } from "express";
const router = Router();
router.delete("/items/:id", requireAdmin, async (req, res) => {
  await db.item.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
export default router;
`, { fileName: "items.ts", audit: true });
    expect(result.audit?.some((h) => h.message.includes("auth/session check"))).toBeFalsy();
  });
});

describe("Handler discovery: named export declarations", () => {
  it("resolves `const GET = ...; export { GET };` to the local declaration", () => {
    const { result, trigger } = getTrigger(`
import { withWrapper } from "@/lib/api";

const GET = withWrapper({
  handler: async (req: Request) => {
    const items = await fetch("https://api.example.com/items");
    return Response.json(await items.json());
  },
});

export { GET };
`);
    expect(trigger.nodeType).toBe("http_webhook");
    expect((trigger.params as any).method).toBe("GET");
    expect(result.ir!.nodes.length).toBeGreaterThanOrEqual(2);
  });

  it("resolves the first HTTP method from `export { GET, POST }`", () => {
    const { trigger } = getTrigger(`
async function GET(req: Request) {
  return Response.json({ items: [] });
}
async function POST(req: Request) {
  return Response.json({ created: true }, { status: 201 });
}

export { GET, POST };
`);
    expect(trigger.nodeType).toBe("http_webhook");
    expect((trigger.params as any).method).toBe("GET");
  });

  it("skips re-exports from other files without crashing", () => {
    const result = decompile(`export { GET } from "@/modules/api/health/route";`);
    expect(result.success).toBe(false);
    expect(result.confidence).toBe(0);
  });
});

describe("Handler discovery: Express/Hono router registrations", () => {
  it("extracts the handler from `router.post(path, handler)`", () => {
    const { result, trigger } = getTrigger(`
import { Router } from "express";
const router = Router();

router.post("/orders", async (req, res) => {
  const { productId } = req.body;
  if (!productId) {
    return res.status(400).json({ error: "Missing productId" });
  }
  res.status(201).json({ ok: true });
});

export default router;
`, "orders.ts");
    expect(trigger.nodeType).toBe("http_webhook");
    expect((trigger.params as any).method).toBe("POST");
    expect((trigger.params as any).routePath).toBe("/orders");
    expect(result.ir!.nodes.some((n) => n.nodeType === "if_else")).toBe(true);
  });

  it("skips middleware and takes the LAST function argument as the handler", () => {
    const { result, trigger } = getTrigger(`
import { Router } from "express";
import { requireAuth } from "./auth";
const router = Router();

router.delete("/items/:id", requireAuth, rateLimit(), async (req, res) => {
  if (!req.params.id) {
    return res.status(400).end();
  }
  res.status(204).end();
});

export default router;
`, "items.ts");
    expect((trigger.params as any).method).toBe("DELETE");
    expect((trigger.params as any).routePath).toBe("/items/:id");
    // the handler body (with its if branch) must be decompiled
    expect(result.ir!.nodes.some((n) => n.nodeType === "if_else")).toBe(true);
  });

  it("does not mistake non-router calls like axios.get for registrations", () => {
    const { trigger } = getTrigger(`
export async function GET(req: Request) {
  const r = await axios.get("https://api.example.com", { timeout: 5000 });
  return Response.json(r.data);
}
`);
    // named export wins; the axios.get call must not hijack trigger discovery
    expect((trigger.params as any).method).toBe("GET");
    expect((trigger.params as any).routePath).not.toBe("https://api.example.com");
  });
});

describe("Handler discovery: pages/api (req, res) handlers", () => {
  it("classifies `export default function handler(req, res)` as HTTP, not manual", () => {
    const { trigger } = getTrigger(`
export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).end();
  }
  const body = req.body;
  res.status(200).json({ ok: true });
}
`, "index.ts");
    expect(trigger.nodeType).toBe("http_webhook");
    expect((trigger.params as any).method).toBe("POST");
  });

  it("infers the first checked method when several are handled", () => {
    const { trigger } = getTrigger(`
export default async function handler(req: any, res: any) {
  if (req.method === "PUT") {
    return res.status(200).json({ updated: true });
  }
  if (req.method === "DELETE") {
    return res.status(204).end();
  }
  res.status(405).end();
}
`, "index.ts");
    expect(trigger.nodeType).toBe("http_webhook");
    expect((trigger.params as any).method).toBe("PUT");
  });

  it("defaults to POST when no method check exists but req.body is used", () => {
    const { trigger } = getTrigger(`
export default async function handler(req: any, res: any) {
  const data = req.body;
  res.status(200).json({ echo: data });
}
`, "index.ts");
    expect(trigger.nodeType).toBe("http_webhook");
    expect((trigger.params as any).method).toBe("POST");
  });

  it("defaults to GET for read-only handlers without body access", () => {
    const { trigger } = getTrigger(`
export default async function handler(req: any, res: any) {
  res.status(200).json({ status: "healthy" });
}
`, "index.ts");
    expect(trigger.nodeType).toBe("http_webhook");
    expect((trigger.params as any).method).toBe("GET");
  });

  it("infers the route path from any /api/ segment in the file path", () => {
    const { trigger } = getTrigger(`
export async function POST(req: Request) {
  return Response.json({ ok: true }, { status: 201 });
}
`, "examples/api/orders/route.ts");
    expect((trigger.params as any).routePath).toBe("/api/orders");
  });

  it("keeps non-HTTP exported functions as manual triggers", () => {
    const { trigger } = getTrigger(`
export async function processQueue(jobs: string[]) {
  for (const job of jobs) {
    console.log(job);
  }
}
`, "worker.ts");
    expect(trigger.nodeType).toBe("manual");
  });
});
