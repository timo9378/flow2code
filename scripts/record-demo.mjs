/**
 * Records the README demo video against the live playground.
 *
 * Usage:
 *   node scripts/record-demo.mjs [url]
 *
 * Output: docs/assets/demo.webm (convert to GIF with scripts/make-demo-gif.sh)
 */
import { chromium } from "@playwright/test";
import { mkdirSync, renameSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = join(ROOT, "docs", "assets");
const URL = process.argv[2] ?? "https://flow2code.koimsurai.com";

const DEMO_CODE = `export async function POST(req: Request) {
  const { userId } = await req.json();

  try {
    const res = await fetch(\`https://api.example.com/users/\${userId}\`);
    const user = await res.json();

    if (user.role === "admin") {
      return Response.json({ user, admin: true });
    }
    return Response.json({ error: "Forbidden" }, { status: 403 });
  } catch (err) {
    return Response.json({ error: "Upstream failed" }, { status: 502 });
  }
}`;

mkdirSync(OUT_DIR, { recursive: true });

const executablePath =
  process.env.F2C_CHROMIUM ??
  join(
    process.env.HOME,
    ".cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell"
  );

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({
  viewport: { width: 1440, height: 810 },
  recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 810 } },
});
const page = await context.newPage();

// --- fake cursor so viewers can follow the mouse in the recording ---
async function installCursor() {
  await page.evaluate(() => {
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    c.style.cssText = [
      "position:fixed", "z-index:999999", "top:0", "left:0",
      "width:22px", "height:22px", "border-radius:50%",
      "background:rgba(255,170,40,.85)", "border:2px solid #fff",
      "box-shadow:0 0 14px rgba(255,170,40,.9)",
      "pointer-events:none", "transform:translate(-50%,-50%)",
      "transition:width .12s,height .12s",
    ].join(";");
    document.body.appendChild(c);
    document.addEventListener("mousemove", (e) => {
      c.style.left = e.clientX + "px";
      c.style.top = e.clientY + "px";
    }, true);
    document.addEventListener("mousedown", () => {
      c.style.width = "16px"; c.style.height = "16px";
    }, true);
    document.addEventListener("mouseup", () => {
      c.style.width = "22px"; c.style.height = "22px";
    }, true);
  });
}

let mouse = { x: 720, y: 400 };
async function glideTo(locator, holdMs = 250) {
  const box = await locator.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(mouse.x, mouse.y);
  await page.mouse.move(x, y, { steps: 22 });
  mouse = { x, y };
  await page.waitForTimeout(holdMs);
}
async function glideClick(locator, holdMs = 250) {
  await glideTo(locator, holdMs);
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

// ============ storyboard ============
await page.goto(URL, { waitUntil: "networkidle" });
await installCursor();
await page.waitForTimeout(1400);

// 1. dismiss welcome modal
await glideClick(page.getByText("Start from scratch"));
await page.waitForTimeout(500);

// 2. open Decompile modal
await glideClick(page.getByRole("button", { name: /Decompile/ }).first());
await page.waitForTimeout(700);

// 3. paste-type the TypeScript route
const ta = page.locator("textarea");
await glideClick(ta, 150);
for (const line of DEMO_CODE.split("\n")) {
  await page.keyboard.type(line, { delay: 4 });
  await page.keyboard.press("Enter");
  await page.waitForTimeout(30);
}
await page.waitForTimeout(500);

// 4. hit Decompile
await glideClick(page.locator("button", { hasText: "Decompile" }).last());
await page.waitForTimeout(1200);

// 5. admire the audit result modal (confidence + hints)
await page.waitForTimeout(2600);

// 6. close modal, admire the DAG canvas
await page.keyboard.press("Escape");
await page.waitForTimeout(2800);

// 7. compile back to TypeScript
await glideClick(page.getByRole("button", { name: /Compile/ }).first());
await page.waitForTimeout(1400);

// 8. scroll the generated code inside the output modal
await glideTo(page.locator("pre, code").last(), 400);
await page.mouse.wheel(0, 260);
await page.waitForTimeout(1100);
await page.mouse.wheel(0, 260);
await page.waitForTimeout(2400);

const video = page.video();
await context.close();
const path = await video.path();
await browser.close();

const target = join(OUT_DIR, "demo.webm");
renameSync(path, target);
// clean up any stray auto-named recordings from earlier runs
for (const f of readdirSync(OUT_DIR)) {
  if (f.endsWith(".webm") && f !== "demo.webm") {
    try { renameSync(join(OUT_DIR, f), "/tmp/" + f); } catch {}
  }
}
console.log("Recorded:", target);
