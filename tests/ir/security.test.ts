/**
 * IR Security Validation Tests
 *
 * Tests for AI-generated IR security validation
 */

import { describe, it, expect } from "vitest";
import { validateIRSecurity, formatSecurityReport } from "../../src/lib/ir/security";
import type { FlowIR } from "../../src/lib/ir/types";
import { NodeCategory, ActionType, TriggerType, VariableType, OutputType, CURRENT_IR_VERSION } from "../../src/lib/ir/types";

function makeIR(nodes: FlowIR["nodes"]): FlowIR {
  return {
    version: CURRENT_IR_VERSION,
    meta: { name: "test", createdAt: "", updatedAt: "" },
    nodes,
    edges: [],
  };
}

describe("validateIRSecurity", () => {
  it("should pass for safe IR with no custom code", () => {
    const ir = makeIR([
      {
        id: "t1",
        nodeType: TriggerType.HTTP_WEBHOOK,
        category: NodeCategory.TRIGGER,
        label: "HTTP",
        params: { method: "GET", routePath: "/api/test", parseBody: false },
        inputs: [],
        outputs: [{ id: "output", label: "Output" }],
      },
    ]);

    const result = validateIRSecurity(ir);
    expect(result.safe).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.nodesScanned).toBe(0);
  });

  it("should pass for safe custom code", () => {
    const ir = makeIR([
      {
        id: "c1",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Safe Code",
        params: { code: "const result = 1 + 2;\nreturn result;", returnVariable: "result" },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "output", label: "Output" }],
      },
    ]);

    const result = validateIRSecurity(ir);
    expect(result.safe).toBe(true);
    expect(result.findings).toHaveLength(0);
    expect(result.nodesScanned).toBe(1);
  });

  it("should detect eval() as critical", () => {
    const ir = makeIR([
      {
        id: "c1",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Evil Code",
        params: { code: 'const x = eval("1+1");', returnVariable: "x" },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "output", label: "Output" }],
      },
    ]);

    const result = validateIRSecurity(ir);
    expect(result.safe).toBe(false);
    expect(result.findings.length).toBeGreaterThan(0);
    expect(result.findings[0].severity).toBe("critical");
    expect(result.findings[0].pattern).toContain("eval");
  });

  it("should detect child_process as critical", () => {
    const ir = makeIR([
      {
        id: "c1",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "RCE",
        params: { code: 'const { exec } = require("child_process");', returnVariable: "" },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "output", label: "Output" }],
      },
    ]);

    const result = validateIRSecurity(ir);
    expect(result.safe).toBe(false);
    const criticals = result.findings.filter((f) => f.severity === "critical");
    expect(criticals.length).toBeGreaterThanOrEqual(2); // child_process + require('child_process')
  });

  it("should detect process.env as critical", () => {
    const ir = makeIR([
      {
        id: "c1",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Env Leak",
        params: { code: "const secret = process.env.SECRET_KEY;", returnVariable: "secret" },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "output", label: "Output" }],
      },
    ]);

    const result = validateIRSecurity(ir);
    expect(result.safe).toBe(false);
    expect(result.findings.some((f) => f.pattern.includes("process.env"))).toBe(true);
  });

  it("should detect fs write operations as critical", () => {
    const ir = makeIR([
      {
        id: "c1",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "FS Write",
        params: { code: "fs.writeFileSync('/etc/hosts', 'hacked');", returnVariable: "" },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "output", label: "Output" }],
      },
    ]);

    const result = validateIRSecurity(ir);
    expect(result.safe).toBe(false);
    expect(result.findings.some((f) => f.severity === "critical")).toBe(true);
  });

  it("should detect dynamic import as warning", () => {
    const ir = makeIR([
      {
        id: "c1",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Dynamic Import",
        params: { code: 'const mod = await import("fs");', returnVariable: "mod" },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "output", label: "Output" }],
      },
    ]);

    const result = validateIRSecurity(ir);
    // dynamic import is warning, not critical → still safe
    expect(result.safe).toBe(true);
    expect(result.findings.some((f) => f.severity === "warning")).toBe(true);
  });

  it("should detect while(true) as info", () => {
    const ir = makeIR([
      {
        id: "c1",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Infinite Loop",
        params: { code: "while (true) { break; }", returnVariable: "" },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "output", label: "Output" }],
      },
    ]);

    const result = validateIRSecurity(ir);
    expect(result.safe).toBe(true);
    expect(result.findings.some((f) => f.severity === "info")).toBe(true);
  });

  it("should scan transform expressions", () => {
    const ir = makeIR([
      {
        id: "t1",
        nodeType: VariableType.TRANSFORM,
        category: NodeCategory.VARIABLE,
        label: "Evil Transform",
        params: { expression: "eval('exploit')" },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "output", label: "Output" }],
      },
    ]);

    const result = validateIRSecurity(ir);
    expect(result.safe).toBe(false);
    expect(result.findings[0].nodeId).toBe("t1");
  });

  it("should scan bodyExpression in return_response", () => {
    const ir = makeIR([
      {
        id: "r1",
        nodeType: OutputType.RETURN_RESPONSE,
        category: NodeCategory.OUTPUT,
        label: "Response",
        params: { statusCode: 200, bodyExpression: "{ leak: process.env.DB_URL }" },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [],
      },
    ]);

    const result = validateIRSecurity(ir);
    expect(result.safe).toBe(false);
    expect(result.findings.some((f) => f.pattern.includes("process.env"))).toBe(true);
  });

  it("should scan condition in if_else", () => {
    const ir = makeIR([
      {
        id: "if1",
        nodeType: "if_else" as ActionType,
        category: NodeCategory.LOGIC,
        label: "Check",
        params: { condition: "eval('hack') === true" },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "true", label: "True" }, { id: "false", label: "False" }],
      },
    ]);

    const result = validateIRSecurity(ir);
    expect(result.safe).toBe(false);
  });

  it("should detect multiple findings in one node", () => {
    const ir = makeIR([
      {
        id: "c1",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Multi Danger",
        params: {
          code: `
            const proc = require("child_process");
            eval("hack");
            process.exit(1);
          `,
          returnVariable: "",
        },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "output", label: "Output" }],
      },
    ]);

    const result = validateIRSecurity(ir);
    expect(result.safe).toBe(false);
    expect(result.findings.length).toBeGreaterThanOrEqual(3);
  });

  it("should scan multiple nodes", () => {
    const ir = makeIR([
      {
        id: "c1",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Safe",
        params: { code: "const a = 1;", returnVariable: "a" },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "output", label: "Output" }],
      },
      {
        id: "c2",
        nodeType: ActionType.CUSTOM_CODE,
        category: NodeCategory.ACTION,
        label: "Dangerous",
        params: { code: 'eval("hack");', returnVariable: "" },
        inputs: [{ id: "input", label: "Input" }],
        outputs: [{ id: "output", label: "Output" }],
      },
    ]);

    const result = validateIRSecurity(ir);
    expect(result.safe).toBe(false);
    expect(result.nodesScanned).toBe(2);
    expect(result.findings[0].nodeId).toBe("c2");
  });
});

describe("formatSecurityReport", () => {
  it("should format clean report", () => {
    const report = formatSecurityReport({ safe: true, findings: [], nodesScanned: 5 });
    expect(report).toContain("✅");
    expect(report).toContain("5");
  });

  it("should format findings by severity", () => {
    const report = formatSecurityReport({
      safe: false,
      findings: [
        { severity: "critical", nodeId: "c1", nodeLabel: "Code", pattern: "eval()", match: "eval(" },
        { severity: "warning", nodeId: "c1", nodeLabel: "Code", pattern: "import()", match: "import(" },
        { severity: "info", nodeId: "c1", nodeLabel: "Code", pattern: "while(true)", match: "while (true)" },
      ],
      nodesScanned: 1,
    });

    expect(report).toContain("🔴 Critical (1)");
    expect(report).toContain("🟡 Warning (1)");
    expect(report).toContain("🔵 Info (1)");
  });
});
