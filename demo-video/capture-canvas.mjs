/**
 * Captures a hi-res screenshot of the playground canvas showing the
 * decompiled orders route — used as the hook scene of the demo video.
 */
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const CODE = readFileSync(new URL("../examples/api/orders/route.ts", import.meta.url), "utf-8");

const browser = await chromium.launch({
  executablePath:
    process.env.HOME +
    "/.cache/ms-playwright/chromium_headless_shell-1223/chrome-headless-shell-linux64/chrome-headless-shell",
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
await page.goto("http://127.0.0.1:3199", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
await page.getByText("Start from scratch").click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /Decompile/ }).first().click();
await page.waitForTimeout(600);
await page.locator("textarea").fill(CODE);
await page.waitForTimeout(300);
await page.locator("button", { hasText: "Decompile" }).last().click();
await page.waitForTimeout(2500);
await page.keyboard.press("Escape");
await page.waitForTimeout(600);
// collapse the node library sidebar for a cleaner canvas
try {
  await page.getByRole("button", { name: "«" }).click();
  await page.waitForTimeout(800);
} catch {}
await page.screenshot({ path: new URL("./public/canvas.png", import.meta.url).pathname });
await browser.close();
console.log("captured public/canvas.png");
