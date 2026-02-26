/**
 * Platform Adapter 測試
 *
 * 驗證多平台輸出的正確性，以及平台解耦的可行性。
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import { createSimpleGetFlow, createPostWithFetchFlow } from "../fixtures";

describe("Platform Adapters", () => {
  describe("Next.js (預設)", () => {
    it("預設應使用 Next.js 平台", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir);

      expect(result.success).toBe(true);
      expect(result.code).toContain("NextResponse");
      expect(result.code).toContain('from "next/server"');
      expect(result.filePath).toBe("src/app/api/hello/route.ts");
    });

    it("明確指定 nextjs 應與預設結果相同", () => {
      const ir = createSimpleGetFlow();
      const defaultResult = compile(ir);
      const explicitResult = compile(ir, { platform: "nextjs" });

      expect(defaultResult.code).toBe(explicitResult.code);
    });
  });

  describe("Express", () => {
    it("應生成 Express 風格的 route handler", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir, { platform: "express" });

      expect(result.success).toBe(true);
      // Express 使用 Request/Response
      expect(result.code).toContain('from "express"');
      expect(result.code).toContain("res.");
      // 不應有 NextResponse
      expect(result.code).not.toContain("NextResponse");
    });

    it("應生成 Express 的檔案路徑", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir, { platform: "express" });

      expect(result.filePath).toMatch(/^src\/routes\//);
    });

    it("Express 應報告 express 為依賴", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir, { platform: "express" });

      expect(result.dependencies!.all).toContain("express");
      expect(result.dependencies!.all).toContain("@types/express");
    });
  });

  describe("Cloudflare Workers", () => {
    it("應生成 Cloudflare Workers 風格的 handler", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir, { platform: "cloudflare" });

      expect(result.success).toBe(true);
      // Cloudflare 使用 Web API 的 Response
      expect(result.code).toContain("new Response");
      // 不應有 NextResponse
      expect(result.code).not.toContain("NextResponse");
      // 應有 export default
      expect(result.code).toContain("export default");
    });

    it("Cloudflare 應報告 workers-types 為依賴", () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir, { platform: "cloudflare" });

      expect(result.dependencies!.all).toContain("@cloudflare/workers-types");
    });
  });
});
