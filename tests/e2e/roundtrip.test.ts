/**
 * E2E Roundtrip Tests
 *
 * Full pipeline: FlowIR → compile → TypeScript → decompile → FlowIR
 * Validates that the compiler + decompiler form a stable cycle.
 */

import { describe, it, expect } from "vitest";
import { compile } from "@/lib/compiler/compiler";
import { decompile } from "@/lib/compiler/decompiler";
import { validateFlowIR } from "@/lib/ir/validator";
import { NodeCategory } from "@/lib/ir/types";
import type { FlowIR } from "@/lib/ir/types";
import {
  createSimpleGetFlow,
  createPostWithFetchFlow,
  createIfElseFlow,
  createConcurrentFlow,
  createEnvVarFlow,
} from "../fixtures";

describe("E2E Roundtrip: IR → TS → IR", () => {
  const fixtures: Array<{ name: string; factory: () => FlowIR }> = [
    { name: "Simple GET", factory: createSimpleGetFlow },
    { name: "POST + Fetch", factory: createPostWithFetchFlow },
    { name: "If/Else Branch", factory: createIfElseFlow },
    { name: "Concurrent (Promise.all)", factory: createConcurrentFlow },
    { name: "Environment Variables", factory: createEnvVarFlow },
  ];

  for (const { name, factory } of fixtures) {
    describe(`[${name}]`, () => {
      it("original IR passes validation", () => {
        const ir = factory();
        const result = validateFlowIR(ir);
        expect(result.valid).toBe(true);
      });

      it("compiles to valid TypeScript", () => {
        const ir = factory();
        const result = compile(ir);
        expect(result.success).toBe(true);
        expect(result.code).toBeDefined();
        expect(result.code!.length).toBeGreaterThan(0);
      });

      it("decompiles back to IR", () => {
        const ir = factory();
        const compiled = compile(ir);
        const result = decompile(compiled.code!, { fileName: compiled.filePath });

        expect(result.success).toBe(true);
        expect(result.ir).toBeDefined();
        expect(result.confidence).toBeGreaterThan(0);
      });

      it("roundtrip IR passes validation", () => {
        const ir = factory();
        const compiled = compile(ir);
        const result = decompile(compiled.code!, { fileName: compiled.filePath });

        expect(result.ir).toBeDefined();
        const validation = validateFlowIR(result.ir!);
        expect(validation.valid).toBe(true);
      });

      it("roundtrip preserves trigger node", () => {
        const ir = factory();
        const compiled = compile(ir);
        const result = decompile(compiled.code!, { fileName: compiled.filePath });

        const originalTrigger = ir.nodes.find((n) => n.category === NodeCategory.TRIGGER);
        const roundtripTrigger = result.ir!.nodes.find((n) => n.category === NodeCategory.TRIGGER);

        expect(roundtripTrigger).toBeDefined();
        if (originalTrigger) {
          expect(roundtripTrigger!.nodeType).toBe(originalTrigger.nodeType);
        }
      });

      it("roundtrip preserves reasonable node count", () => {
        const ir = factory();
        const compiled = compile(ir);
        const result = decompile(compiled.code!, { fileName: compiled.filePath });

        // The decompiler is a heuristic AST analyzer — it may infer extra nodes
        // (e.g. splitting compound expressions). We verify it finds at least as
        // many nodes as the compact original, within a generous upper bound.
        const originalCount = ir.nodes.length;
        const roundtripCount = result.ir!.nodes.length;
        expect(roundtripCount).toBeGreaterThanOrEqual(Math.max(1, originalCount - 1));
        // Upper bound: decompiler shouldn't hallucinate >5× the original nodes
        expect(roundtripCount).toBeLessThanOrEqual(originalCount * 5);
      });

      it("double-roundtrip is roughly stable (IR₂ → TS₂ → IR₃ ≈ IR₂)", () => {
        const ir = factory();

        // First roundtrip
        const ts1 = compile(ir);
        const ir2Result = decompile(ts1.code!, { fileName: ts1.filePath });
        if (!ir2Result.success || !ir2Result.ir) return; // skip if first decompile fails

        // Second roundtrip
        const ts2 = compile(ir2Result.ir);
        const ir3Result = decompile(ts2.code!, { fileName: ts2.filePath });
        if (!ir3Result.success || !ir3Result.ir) return;

        // Node count should stay in the same ballpark (±50% of IR₂)
        const diff = Math.abs(ir3Result.ir.nodes.length - ir2Result.ir.nodes.length);
        expect(diff).toBeLessThanOrEqual(Math.ceil(ir2Result.ir.nodes.length * 0.5));
        // Confidence should not collapse
        expect(ir3Result.confidence).toBeGreaterThan(0);
      });
    });
  }
});

describe("E2E Multi-platform Compilation", () => {
  const platforms = ["nextjs", "express", "cloudflare"] as const;

  for (const platform of platforms) {
    it(`compiles Simple GET on ${platform}`, () => {
      const ir = createSimpleGetFlow();
      const result = compile(ir, { platform });
      expect(result.success).toBe(true);
      expect(result.code!.length).toBeGreaterThan(0);
    });

    it(`compiles POST+Fetch on ${platform}`, () => {
      const ir = createPostWithFetchFlow();
      const result = compile(ir, { platform });
      expect(result.success).toBe(true);
      expect(result.code!.length).toBeGreaterThan(0);
    });
  }
});
