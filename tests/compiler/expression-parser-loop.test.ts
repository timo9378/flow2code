import { describe, it, expect } from "vitest";
import { parseExpression } from "../../src/lib/compiler/expression-parser";
import { FlowIR, NodeCategory } from "../../src/lib/ir/types";

describe("Expression Parser - Loop Scoping", () => {
    it("should resolve $node.item properly in loop scope", () => {
        const result = parseExpression("{{for_loop_1.item.title}}", {
            ir: { nodes: [], edges: [], version: "1.0.0", meta: { name: "test", createdAt: "0", updatedAt: "0" } },
            nodeMap: new Map(),
            scopeStack: [
                { nodeId: "for_loop_1", scopeVar: "_scope_for_loop_1" }
            ]
        });

        // Inside the loop, "for_loop_1" refers to the current item in the current scope.
        // The expected outcome: _scope_for_loop_1['for_loop_1'].item.title
        // Wait, the user error was: accessing flowState['for_loop_args'].item.title
        // But with our recursive descent parser, the local scope should map `for_loop_1` 
        // to `_scope_for_loop_1['for_loop_1']`.
        expect(result).toBe("_scope_for_loop_1['for_loop_1'].item.title");
    });
});
