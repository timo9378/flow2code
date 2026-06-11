# Flow2Code Usage Guide

Practical recipes for every workflow. Quick reference:

| I want to… | Command |
|---|---|
| Review what a branch did to my routes | `flow2code diff main...` |
| Check my uncommitted route changes | `flow2code diff` |
| Diff one route file against HEAD | `flow2code diff src/app/api/users/route.ts` |
| Audit any route for structural issues | `flow2code audit route.ts` |
| Get flow diffs on every PR | GitHub Action (below) |
| Let my AI agent do all of the above | `flow2code mcp` |

```bash
npm install -g @timo9378/flow2code   # or: npx @timo9378/flow2code <cmd>
```

---

## Semantic flow diff

Compares route versions at the **control/data-flow level**, not the text
level. Formatting changes, comment edits, and reordering that don't change
the flow report **zero changes**.

```bash
# Everything the branch changed, route by route
flow2code diff main...

# Uncommitted work vs HEAD
flow2code diff

# One file: vs HEAD, vs a ref, or vs another file
flow2code diff src/app/api/orders/route.ts
flow2code diff v1.2.0 src/app/api/orders/route.ts
flow2code diff old.ts new.ts

# Output formats
flow2code diff --md      # Markdown with Mermaid graphs (PR-comment format)
flow2code diff --json    # machine-readable
```

What it reports, ordered by reviewer severity:

- ⚠️ **Removed error handling** — a `try/catch` is gone
- ⚠️ **Removed error response paths** — e.g. the 502 branch disappeared
- ⚠️ **Removed routes** — an endpoint no longer exists
- 🟡 Changed branch conditions, status codes, external calls
- 🟢 New routes and new operations (with their audit findings)
- 🆕 Audit warnings introduced by the change; ✅ warnings it resolved

Multi-route files are handled per route: every Express/Hono registration
(`router.get/post/…`) and every exported HTTP method (`export async function
GET/POST`) is matched by method+path and diffed individually.

Exit code `2` signals warning-level findings — usable as a CI gate.

## Structural audit

```bash
flow2code audit src/app/api/users/route.ts
flow2code audit route.ts --format mermaid   # flowchart markup
flow2code audit route.ts --format json -o flow.json
```

Findings include, with exact line numbers:

- `await` calls with no error handling
- `fetch` without `response.ok` checks
- request bodies reaching DB operations with **no schema validation**
- responses leaking `err.message` / `err.stack` to clients
- mutating handlers (POST/PUT/PATCH/DELETE) with no visible auth check
  (middleware-aware — wrapped handlers aren't flagged)
- every response path and its status code

## GitHub Action

```yaml
# .github/workflows/flow-diff.yml
name: Route Flow Diff
on: pull_request
permissions:
  contents: read
  pull-requests: write
jobs:
  flow-diff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: timo9378/flow2code@main
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          # fail-on-warning: "true"        # block PRs that remove error handling
          # paths-regex: "src/api/.*\\.ts$" # customize which files count as routes
          # max-files: "20"
```

One auto-updated comment per PR ([live example](https://github.com/timo9378/flow2code/pull/1)).
Fork PRs get read-only tokens; the action logs the report instead of failing.

## MCP server (AI agents)

```bash
claude mcp add flow2code -- npx -y @timo9378/flow2code mcp
```

| Tool | Returns |
|---|---|
| `audit_route` | Flow graph summary + findings with line numbers |
| `diff_routes` | Per-route semantic diff between two versions (Markdown) |
| `flow_graph` | Mermaid flowchart of the route |

## Library

```ts
import {
  decompile, decompileAll,          // TS → FlowIR (one / every entry point)
  diffRouteFiles,                    // per-route semantic diff
  formatRouteFileDiffMarkdown,       // PR-comment Markdown
  toMermaid,                         // FlowIR → Mermaid
  compile,                           // FlowIR → TS (the visual editor's engine)
} from "@timo9378/flow2code";

const diff = diffRouteFiles(beforeSource, afterSource, { fileName: "route.ts" });
for (const route of diff.routes) {
  console.log(route.key, route.status, route.diff?.changes.length ?? 0);
}
```

## Visual playground

[flow2code.koimsurai.com](https://flow2code.koimsurai.com) — paste a route,
see the interactive flow graph, click nodes to inspect. The same engine
compiles flows back to TypeScript (Next.js / Express / Cloudflare Workers)
with zero runtime dependencies:

```bash
flow2code compile my-flow.flow.json -o route.ts --platform nextjs
flow2code dev          # local canvas
```

## Known limitations

- **Single-file analysis** — handlers imported from other files
  (`export { GET } from "./impl"`) can't be resolved; run the tool on the
  implementation file instead.
- **Heuristics are heuristics** — the auth-check rule is deliberately
  info-level; auth handled by framework middleware outside the file can't
  be seen.
- **Dynamic registrations** — routes registered in loops or with computed
  paths are not detected.
