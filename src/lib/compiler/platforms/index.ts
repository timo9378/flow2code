/**
 * Platform Adapters - Registration & Exports
 */

export type { PlatformAdapter, PlatformContext, PlatformName, BuiltinPlatformName, TriggerInitContext } from "./types";
export {
  registerPlatform,
  getPlatform,
  getAvailablePlatforms,
} from "./types";

export { NextjsPlatform } from "./nextjs";
export { ExpressPlatform } from "./express";
export { CloudflarePlatform } from "./cloudflare";

// ── Register built-in platforms ──
import { registerPlatform } from "./types";
import { NextjsPlatform } from "./nextjs";
import { ExpressPlatform } from "./express";
import { CloudflarePlatform } from "./cloudflare";

registerPlatform("nextjs", () => new NextjsPlatform());
registerPlatform("express", () => new ExpressPlatform());
registerPlatform("cloudflare", () => new CloudflarePlatform());
