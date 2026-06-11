# Roadmap

Flow2Code is deliberately narrow: **semantic flow diff and structural audit
for TypeScript API routes.** Depth over breadth.

## Now (0.5.x)

- [x] Multi-route files — every Express/Hono registration and every exported
      HTTP method analyzed individually
- [x] Branch-level diff — `flow2code diff` / `flow2code diff main...`
- [x] Route-specific audit rules — unvalidated request bodies reaching data
      sinks, internal error details leaked to clients, mutating routes with
      no visible auth check (middleware-aware heuristic)
- [ ] Scan results from real-world open-source PRs (launch content)

## Next

- [ ] SARIF output for `diff`/`audit` so findings surface in GitHub code scanning
- [ ] Config file (`flow2code.config.json`) — route globs, rule severities, ignores
- [ ] VS Code extension: flow diff view for the working tree
- [ ] tRPC procedure support in the decompiler

## Explicitly out of scope

- Codebase-wide dependency graphs (ast-grep, Joern, and code-review-graph
  do this well already)
- Languages other than TypeScript/JavaScript — narrow and deep beats wide
  and shallow
- Becoming a workflow runtime — the compiler stays zero-dependency output

Suggest changes via issues — small, focused PRs welcome.
