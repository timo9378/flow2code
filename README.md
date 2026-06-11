<p align="center">
  <h1 align="center">Flow2Code</h1>
  <p align="center">
    <strong>X-ray vision for your API routes.</strong><br/>
    Semantic flow diff and structural audit for TypeScript backends — built for the age of AI-generated code.
  </p>
</p>

<p align="center">
  <a href="https://flow2code.koimsurai.com">Live Playground</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#github-action-flow-diff-in-every-pr">GitHub Action</a> ·
  <a href="#mcp-server-let-your-ai-agent-use-it">MCP Server</a> ·
  <a href="USAGE.md">Docs</a>
</p>

<p align="center">
  <a href="https://github.com/timo9378/flow2code/actions/workflows/ci.yml"><img src="https://github.com/timo9378/flow2code/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://www.npmjs.com/package/@timo9378/flow2code"><img src="https://img.shields.io/npm/v/@timo9378/flow2code.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@timo9378/flow2code"><img src="https://img.shields.io/npm/dm/@timo9378/flow2code.svg" alt="npm downloads"></a>
</p>

---

![flow2code demo — a text diff that looks harmless, exposed by the flow diff as removed error handling and a weakened check](docs/assets/demo.gif)

## The Problem

AI writes your backend routes now. Reviewing them is the bottleneck.

A text diff shows you *lines* that changed. It does not show you that the PR
**weakened a stock check**, **dropped the 502 error path**, or **moved a query
outside its try/catch**. Reading 200 lines of nested `if/else` and `await` chains
to find that out is slow — and it's exactly where AI-generated bugs hide.

## The Solution

Flow2Code decompiles TypeScript API routes into a control/data-flow graph
(via the TypeScript compiler API — no AI, no guessing) and answers the question
reviewers actually have: **"what did this change do to the route's logic?"**

```diff
$ flow2code diff route.old.ts route.new.ts

📊 Flow diff: +0 added, -0 removed, ✏️ 2 modified, 20 unchanged

  🟡 Response status changed: 429 → 503
  🟡 Branch condition changed: `!product || product.stock < quantity` → `!product`
```

That second line is an oversell bug a text diff buries in noise. Flow diff is
robust to formatting, renames of generated IDs, and statement reordering —
**a refactor that doesn't change the flow reports zero changes.**

## Quick Start

```bash
# Audit any route: flow graph + structural findings with line numbers
npx @timo9378/flow2code audit src/app/api/users/route.ts

# Semantic flow diff — git-aware, like you'd expect
npx @timo9378/flow2code diff main...                       # every changed route on the branch
npx @timo9378/flow2code diff                               # uncommitted route changes vs HEAD
npx @timo9378/flow2code diff src/app/api/users/route.ts    # one file vs HEAD
npx @timo9378/flow2code diff old.ts new.ts                 # two files
npx @timo9378/flow2code diff route.ts --md                 # PR-comment Markdown (Mermaid graph)
```

`audit` finds — with exact line numbers:
- `await` calls with **no error handling**
- `fetch` without `response.ok` checks
- request bodies reaching DB operations with **no schema validation**
- responses **leaking `err.message`/`err.stack`** to clients
- mutating handlers with no visible auth check (middleware-aware heuristic)
- every response path and its status code

Works on real-world code, **every route in the file**: all Express/Hono
registrations (`router.post("/orders", auth, handler)` — middleware skipped,
path extracted), all exported HTTP methods in Next.js route files, `pages/api`
handlers, and HOF-wrapped handlers (`withAuth(...)`, `wrapper({ handler })`)
are unwrapped automatically. Removed routes are flagged as warning-level
changes. Benchmarked on 389 production routes from open-source SaaS
(papermark, formbricks, documenso): **0 crashes, 89% analyzable, 82% of
extracted nodes carry real structure** (not opaque code blocks). Known
limitations are documented in [USAGE.md](USAGE.md#known-limitations).

## Why not difftastic / ast-grep?

Both are excellent — and they answer a different question.

| | difftastic / ast-grep | flow2code diff |
|---|---|---|
| Layer | Syntax tree (which *expressions* changed) | Control/data flow (which *logic paths* changed) |
| Knows "this `catch` guarded that `await`" | No | Yes — it diffs the graph, not the tree |
| Output | Aligned source text | "Error response path removed: Response 502" |
| Scope | Any language, any file | TypeScript API routes, deliberately narrow |

A syntax diff shows you a removed `try` keyword. A flow diff tells you the
upstream call **lost its error handling and the 502 path is gone**. Use
difftastic for everything; use flow2code when the file is an API route and
the question is *"did this PR change what the route does?"*

## GitHub Action: flow diff in every PR

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
          # fail-on-warning: "true"   # block PRs that remove error handling
```

Every PR touching an API route gets **one auto-updated comment**: per-route
flow changes ordered by severity, newly introduced audit warnings, and a
Mermaid graph with added/modified nodes highlighted. Refactors that don't
change the flow are skipped — no comment spam.

**[See it live on a real PR →](https://github.com/timo9378/flow2code/pull/1)** —
an innocuous-looking "simplification" that the diff exposes as removed error
handling plus a weakened stock check.

> **Note on fork PRs:** on `pull_request` events from forks, GitHub hands the
> workflow a read-only token, so the comment step is skipped (analysis still
> runs and `fail-on-warning` still works). For public repos that want comments
> on fork PRs, run the action from a `pull_request_target` workflow that
> checks out the PR head — with the usual care that implies.

## MCP Server: let your AI agent use it

```bash
# Claude Code
claude mcp add flow2code -- npx -y @timo9378/flow2code mcp
```

Exposes three tools over the Model Context Protocol:

| Tool | What the agent gets |
|------|---------------------|
| `audit_route` | Flow graph summary + structural findings with line numbers |
| `diff_routes` | Reviewer-level semantic diff between two route versions |
| `flow_graph` | Mermaid flowchart of a route's control/data flow |

Your agent stops re-deriving control flow from raw text on every review.

## Visual Playground

The [live playground](https://flow2code.koimsurai.com) renders routes as an
interactive canvas — paste code, see the DAG, click nodes to inspect. The same
engine also **compiles flows back to TypeScript** (Next.js / Express /
Cloudflare Workers, zero runtime dependencies), which powers the visual editor.

## How it works

```
TypeScript ──► decompile() ──► FlowIR (JSON graph) ──► audit / diff / mermaid
                                    │
                                    └──► compile() ──► TypeScript (visual editor path)
```

- **Decompiler** — ts-morph (TypeScript compiler API) pattern-matches real AST
  structures: branches, loops, try/catch, fetches, queries, response paths.
  Deterministic, runs locally, zero network calls.
- **Node alignment** — diff matches nodes by content fingerprint, then fuzzy
  similarity. Inserting a line at the top of a file does not light up the whole
  graph.
- **FlowIR** — a JSON intermediate representation. Diffable, versionable,
  renderable (Mermaid / React Flow canvas).

## CLI Commands

| Command | Purpose |
|---------|---------|
| `audit <file>` | Decompile + structural audit of any TypeScript route |
| `diff <before> <after>` | Semantic flow diff (.ts ↔ .ts or .flow.json ↔ .flow.json) |
| `mcp` | Start the MCP server (stdio) for AI agents |
| `compile <flow>` | Compile FlowIR to TypeScript (Next.js / Express / Cloudflare) |
| `trace <file> <line>` | Map a generated line back to its flow node |
| `dev` | Launch the visual canvas locally |
| `init` / `watch` / `split` / `merge` / `env-check` | Project tooling |

## Project Structure

```
flow2code/
├── src/lib/
│   ├── compiler/
│   │   ├── decompiler.ts      # TS → FlowIR (the read direction)
│   │   ├── compiler.ts        # FlowIR → TS (the write direction)
│   │   └── platforms/         # Next.js, Express, Cloudflare
│   ├── diff/
│   │   ├── route-diff.ts      # node alignment + reviewer-level classification
│   │   ├── semantic-diff.ts   # raw IR diff
│   │   └── mermaid.ts         # FlowIR → Mermaid
│   └── ir/                    # FlowIR types + validation
├── src/mcp/                   # MCP server (audit_route / diff_routes / flow_graph)
├── src/cli/                   # CLI
├── scripts/pr-flow-diff.mjs   # GitHub Action worker
├── action.yml                 # GitHub Action definition
└── tests/                     # 450+ unit tests + Playwright E2E
```

## Development

```bash
git clone https://github.com/timo9378/flow2code.git
cd flow2code && pnpm install

pnpm test:run     # unit tests
pnpm build:cli    # build CLI + compiler + server bundles
pnpm dev          # visual canvas dev server
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, project structure, and commit conventions.

## License

MIT
