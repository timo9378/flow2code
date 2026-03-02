/**
 * Platform Adapter Tests
 *
 * Verifies correctness of multi-platform output and feasibility of platform decoupling.
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import { createSimpleGetFlow, createPostWithFetchFlow } from "../fixtures";

describe("Platform Adapters", () => {
  describe("Next.js (Default)", () => {
    it("should use Next.js platform by default", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      expect(result.code).toContain("NextResponse");
      expect(result.code).toContain('from "next/server"');
      expect(result.filePath).toBe("src/app/api/hello/route.ts");
    });

    it("explicitly specifying nextjs should produce the same result as default", () => {
      const ir = createSimpleGetFlow();
      const defaultResult = compile(ir);
      const explicitResult = compile(ir, { platform: "nextjs" });

      expect(defaultResult.code).toBe(explicitResult.code);
    });
  });

  describe("Express", () => {
    it("should generate Express-style route handler", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir, { platform: "express" });

      expect(result.success).toBe(true);
      // Express uses Request/Response
      expect(result.code).toContain('from "express"');
      expect(result.code).toContain("res.");
      // Should not contain NextResponse
      expect(result.code).not.toContain("NextResponse");
    });

    it("should generate Express file path", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir, { platform: "express" });

      expect(result.filePath).toMatch(/^src\/routes\//);
    });

    it("Express should report express as a dependency", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir, { platform: "express" });

      expect(result.dependencies!.all).toContain("express");
      expect(result.dependencies!.all).toContain("@types/express");
    });
  });

  describe("Cloudflare Workers", () => {
    it("should generate Cloudflare Workers style handler", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir, { platform: "cloudflare" });

      expect(result.success).toBe(true);
      // Cloudflare uses Web API Response
      expect(result.code).toContain("new Response");
      // Should not contain NextResponse
      expect(result.code).not.toContain("NextResponse");
      // Should have export default
      expect(result.code).toContain("export default");
    });

    it("Cloudflare should report workers-types as a dependency", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir, { platform: "cloudflare" });

      expect(result.dependencies!.all).toContain("@cloudflare/workers-types");
    });
  });
});
