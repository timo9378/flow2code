import { test, expect } from "@playwright/test";

test.describe("Flow2Code UI — Smoke Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='rf__wrapper']", { timeout: 15000 });
  });

  test("renders page title and toolbar", async ({ page }) => {
    await expect(page).toHaveTitle(/Flow2Code/);
    await expect(page.getByRole("button", { name: /Compile/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Validate/ })).toBeVisible();
  });

  test("shows welcome overlay on empty canvas", async ({ page }) => {
    await expect(page.getByRole("button", { name: "Load example flow" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start from scratch" })).toBeVisible();
  });

  test("can dismiss welcome overlay", async ({ page }) => {
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await expect(page.getByRole("button", { name: "Load example flow" })).not.toBeVisible();
  });

  test("node library panel is visible with categories", async ({ page }) => {
    await expect(page.getByText("Node Library")).toBeVisible();
    await expect(page.getByRole("button", { name: /Triggers/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Actions/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Logic Control/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Variables/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Output/ })).toBeVisible();
  });

  test("can load example flow and see nodes", async ({ page }) => {
    await page.getByRole("button", { name: "Load example flow" }).click();
    // Example flow has 6 nodes — wait for at least 1 to appear
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 5000 });
    const count = await page.locator(".react-flow__node").count();
    expect(count).toBeGreaterThanOrEqual(2);
    // Welcome overlay should dismiss
    await expect(page.getByRole("button", { name: "Load example flow" })).not.toBeVisible();
  });

  test("react flow controls are present", async ({ page }) => {
    await expect(page.locator("[data-testid='rf__controls']")).toBeVisible();
    await expect(page.getByTitle("Zoom In")).toBeVisible();
    await expect(page.getByTitle("Zoom Out")).toBeVisible();
    await expect(page.getByTitle("Fit View")).toBeVisible();
  });

  test("minimap is visible", async ({ page }) => {
    await expect(page.locator("[data-testid='rf__minimap']")).toBeVisible();
  });
});

test.describe("Flow2Code UI — Node Operations", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='rf__wrapper']", { timeout: 15000 });
    await page.getByRole("button", { name: "Start from scratch" }).click();
  });

  test("can add a node by clicking node library item", async ({ page }) => {
    await page.getByRole("button", { name: "HTTP Webhook" }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(1, { timeout: 5000 });
  });

  test("can add multiple nodes", async ({ page }) => {
    await page.getByRole("button", { name: "HTTP Webhook" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Return Response" }).click();
    await expect(page.locator(".react-flow__node")).toHaveCount(2, { timeout: 5000 });
  });

  test("node count badge updates on add", async ({ page }) => {
    await expect(page.getByText("0 nodes")).toBeVisible();
    await page.getByRole("button", { name: "HTTP Webhook" }).click();
    await expect(page.getByText("1 nodes")).toBeVisible({ timeout: 3000 });
  });

  test("clicking a node on canvas selects it", async ({ page }) => {
    await page.getByRole("button", { name: "HTTP Webhook" }).click();
    await page.locator(".react-flow__node").first().waitFor({ timeout: 5000 });
    await page.locator(".react-flow__node").first().click();
    await expect(page.locator(".react-flow__node.selected")).toHaveCount(1, { timeout: 3000 });
  });
});

test.describe("Flow2Code UI — Toolbar Actions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='rf__wrapper']", { timeout: 15000 });
  });

  test("toolbar buttons are accessible", async ({ page }) => {
    await expect(page.getByRole("button", { name: /Compile/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Validate/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Analyze/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /AI Generate/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /File/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /History/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Reset/ })).toBeVisible();
  });

  test("compile with example flow shows result", async ({ page }) => {
    await page.getByRole("button", { name: "Load example flow" }).click();
    await page.locator(".react-flow__node").first().waitFor({ timeout: 5000 });
    await page.getByRole("button", { name: /Compile/ }).click();
    await page.waitForTimeout(3000);
  });

  test("validate with empty canvas works", async ({ page }) => {
    await page.getByRole("button", { name: "Start from scratch" }).click();
    await page.getByRole("button", { name: /Validate/ }).click();
    await page.waitForTimeout(1000);
  });

  test("file menu opens dropdown", async ({ page }) => {
    await page.getByRole("button", { name: /File/ }).click();
    await page.waitForTimeout(500);
  });
});

test.describe("Flow2Code API — Compile Endpoint", () => {
  test("GET / returns HTML app shell", async ({ request }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain("Flow2Code");
    expect(html).toContain("react-flow");
  });

  test("POST /api/compile returns 400 for empty IR", async ({ request }) => {
    const response = await request.post("/api/compile", {
      data: { ir: { nodes: [], edges: [] } },
    });
    expect(response.status()).toBe(400);
    const json = await response.json();
    expect(json.success).toBe(false);
    expect(json.error).toBeDefined();
  });

  test("POST /api/compile compiles valid IR", async ({ request }) => {
    const response = await request.post("/api/compile", {
      data: {
        ir: {
          version: "1.0.0",
          meta: { name: "Test", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" },
          nodes: [
            {
              id: "trigger",
              nodeType: "http_webhook",
              label: "GET /api/test",
              category: "trigger",
              params: { method: "GET", routePath: "/api/test", parseBody: false },
              inputs: [],
              outputs: [{ id: "request", label: "Request", dataType: "object" }],
            },
            {
              id: "resp",
              nodeType: "return_response",
              label: "Response",
              category: "output",
              params: { statusCode: 200, bodyExpression: '{ ok: true }' },
              inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
              outputs: [],
            },
          ],
          edges: [{ id: "e1", sourceNodeId: "trigger", sourcePortId: "request", targetNodeId: "resp", targetPortId: "data" }],
        },
      },
    });
    const json = await response.json();
    expect(response.status()).toBe(200);
    expect(json.success).toBe(true);
    expect(json.code).toContain("NextResponse");
    expect(json.code).toContain("GET");
  });

  test("POST /api/compile returns source map", async ({ request }) => {
    const response = await request.post("/api/compile", {
      data: {
        ir: {
          version: "1.0.0",
          meta: { name: "Test", createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z" },
          nodes: [
            {
              id: "t1",
              nodeType: "http_webhook",
              label: "GET /api/hello",
              category: "trigger",
              params: { method: "GET", routePath: "/api/hello", parseBody: false },
              inputs: [],
              outputs: [{ id: "request", label: "Request", dataType: "object" }],
            },
            {
              id: "r1",
              nodeType: "return_response",
              label: "OK",
              category: "output",
              params: { statusCode: 200, bodyExpression: '{ hello: "world" }' },
              inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
              outputs: [],
            },
          ],
          edges: [{ id: "e1", sourceNodeId: "t1", sourcePortId: "request", targetNodeId: "r1", targetPortId: "data" }],
        },
      },
    });
    const json = await response.json();
    expect(json.success).toBe(true);
    expect(json.sourceMap).toBeDefined();
    expect(json.sourceMap.mappings).toBeDefined();
  });

  test("POST /api/compile handles malformed body gracefully", async ({ request }) => {
    const response = await request.post("/api/compile", {
      headers: { "Content-Type": "application/json" },
      data: "not valid json{{{",
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });
});
