<p align="center">
  <h1 align="center">Flow2Code</h1>
  <p align="center">
    <strong>X-ray vision for your backend code.</strong><br/>
    See your API routes as visual flows. Fix them on the canvas. Export clean TypeScript.
  </p>
</p>

<p align="center">
  <a href="https://flow2code.koimsurai.com">Live Playground</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="USAGE.md">Docs</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/timo9378/flow2code/actions/workflows/ci.yml"><img src="https://github.com/timo9378/flow2code/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://www.npmjs.com/package/@timo9378/flow2code"><img src="https://img.shields.io/npm/v/@timo9378/flow2code.svg" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/@timo9378/flow2code"><img src="https://img.shields.io/npm/dm/@timo9378/flow2code.svg" alt="npm downloads"></a>
</p>

---

<!-- TODO: Replace with a 30-second GIF/video showing: paste TS code → decompile to visual flow → edit on canvas → recompile to TS -->
<!-- ![flow2code demo](docs/assets/demo.gif) -->

## The Problem

AI generates backend code fast — but **can you trust it?**

Reading 200 lines of nested `if/else`, `try/catch`, and `await fetch()` chains to verify correctness is slow and error-prone. Code reviews on AI-generated routes are painful because the control flow is hidden in linear text.

## The Solution

Flow2Code **decompiles any TypeScript API route into an editable visual flow**, so you can:

1. **See** every branch, error path, and data dependency as a DAG
2. **Fix** issues by dragging nodes on the canvas — add a missing `try/catch`, reorder logic, remove dead branches
3. **Export** clean, zero-dependency TypeScript that deploys anywhere

```
  Your TypeScript ──► decompile() ──► Visual Flow (audit & edit)
  Visual Flow    ──► compile()   ──► Clean TypeScript (deploy)
```

> **Not a low-code platform.** Flow2Code is a compiler. The output is native TypeScript with zero runtime dependencies — no vendor lock-in, no black boxes.

## Why Flow2Code?

| Traditional Low-Code | Flow2Code |
|---|---|
| Vendor-locked Runtime | **Zero-dependency** — outputs native TypeScript, deploy anywhere |
| Black-box nodes | **AST Compilation** — ts-morph generates syntactically correct code |
| Single platform | **Multi-platform** — Next.js, Express, Cloudflare Workers |
| Can't version control | **Git-friendly** — IR is JSON/YAML, diffable in PRs |
| Developers don't trust it | **Bidirectional** — code ↔ visual flow, always in sync |

## Key Features

- **Decompiler** — Paste any TypeScript → get an editable visual flow with confidence scoring
- **AST Compiler** — Visual flow → syntactically correct TypeScript via ts-morph (not string concatenation)
- **Zero-dependency output** — Generated code deploys directly to Vercel / AWS Lambda / Cloudflare
- **Multi-platform** — Same flow compiles to Next.js, Express, or Cloudflare Workers
- **Type Inference** — Auto-generates typed `FlowState` interface for cross-node data passing
- **Auto Concurrency** — Topological sort detects independent nodes, generates `Promise.allSettled`
- **Plugin System** — Extensible node types via per-instance plugin registry
- **Expression Parser** — Recursive Descent Parser for `{{$input}}` / `{{$trigger}}` / `{{$node.path}}` syntax
- **Source Map Tracing** — Runtime errors trace back to the exact canvas node
- **Semantic Diff** — Structural comparison of two flow versions for PR reviews
- **VS Code Extension** — Right-click decompile, compile, preview, and inline diagnostics

## Quick Start

### Install

```bash
npm install @timo9378/flow2code
```

### Decompile: See any TypeScript as a visual flow

```bash
# Audit any TypeScript API route → visual FlowIR
npx @timo9378/flow2code audit src/app/api/users/route.ts

# Open the visual editor to see and edit the flow
npx @timo9378/flow2code dev
```

### Compile: Visual flow → production TypeScript

```bash
# Initialize flow2code in your project
npx @timo9378/flow2code init

# Compile a flow to TypeScript
npx @timo9378/flow2code compile .flow2code/flows/hello.flow.json -o src/app/api/hello/route.ts

# Watch mode — auto-compile on file change
npx @timo9378/flow2code watch .flow2code/flows/
```

### Library Usage

```ts
import { compile, decompile, validate } from "@timo9378/flow2code";

// Decompile: TypeScript → FlowIR (code audit)
const audit = decompile(tsCode);
console.log(`Confidence: ${audit.confidence}`);

// Compile: FlowIR → TypeScript
const result = compile(audit.ir, { platform: "nextjs" });

// Validate: Check IR structure
const check = validate(ir);
```

### More CLI Commands

```bash
# Source Map trace — find which canvas node generated a specific line
npx @timo9378/flow2code trace src/app/api/hello/route.ts 15

# Semantic diff between two flow versions
npx @timo9378/flow2code diff v1.flow.json v2.flow.json

# Convert flow to Git-friendly YAML directory format
npx @timo9378/flow2code split my-flow.flow.json

# Check all environment variables are defined
npx @timo9378/flow2code env-check .flow2code/flows/
```

## Node Types

| Category | Node | Compiled Output |
|----------|------|-----------------|
| Trigger | HTTP Webhook | `export async function POST(req)` |
| Trigger | Cron Job | Scheduled function |
| Trigger | Manual | Exported async function |
| Action | Fetch API | `await fetch(...)` with error handling |
| Action | SQL Query | Drizzle / Prisma / Raw SQL |
| Action | Redis Cache | Redis get/set/del with TTL |
| Action | Custom Code | Inline TypeScript |
| Action | Call Subflow | `await importedFunction(...)` |
| Logic | If/Else | `if (...) { } else { }` |
| Logic | For Loop | `for (const item of ...)` |
| Logic | Try/Catch | `try { } catch (e) { }` |
| Logic | Promise.all | `await Promise.allSettled([...])` |
| Variable | Declare | `const x = ...` |
| Variable | Transform | Expression transform |
| Output | Return Response | Platform-specific Response |

## Platform Support

| Platform | Response Style | CLI Flag |
|----------|---------------|----------|
| **Next.js** (default) | `NextResponse.json()` | `--platform nextjs` |
| **Express** | `res.status().json()` | `--platform express` |
| **Cloudflare Workers** | `new Response()` | `--platform cloudflare` |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Visual Canvas | Next.js 15 + React 19 + React Flow v12 |
| State Management | Zustand 5 |
| IR Specification | Custom JSON Schema + TypeScript Types |
| AST Engine | ts-morph 27 (TypeScript Compiler API) |
| Plugin System | Per-instance factory (`createPluginRegistry()`) |
| CLI | Commander.js + Chokidar |
| Testing | Vitest — 413 unit tests + 20 Playwright E2E tests |

## Project Structure

```
flow2code/
├── src/lib/
│   ├── ir/                    # Intermediate Representation
│   │   ├── types.ts           # IR schema + TypeScript types
│   │   ├── validator.ts       # Validation + auto-migration
│   │   └── topological-sort.ts
│   ├── compiler/
│   │   ├── compiler.ts        # AST compiler core
│   │   ├── decompiler.ts      # TS → FlowIR reverse parser
│   │   ├── expression-parser.ts
│   │   ├── type-inference.ts
│   │   ├── symbol-table.ts
│   │   ├── plugins/           # Extensible plugin system
│   │   └── platforms/         # Next.js, Express, Cloudflare
│   └── index.ts               # Public API
├── src/cli/                   # CLI (10 commands)
├── src/components/            # Visual canvas (React Flow)
├── tests/                     # 413 unit + 20 E2E tests
└── vscode-extension/          # VS Code companion
```

## VS Code Extension

- **Right-click Decompile** — `.ts`/`.js` → visual FlowIR with confidence score
- **Right-click Compile** — `.flow.json` → TypeScript with platform selection
- **Flow Preview** — SVG DAG with pan, zoom, category coloring
- **Auto-Validation** — Inline diagnostics on open/save
- **Custom Editor** — Graphical view for `.flow.json` files

See [vscode-extension/README.md](vscode-extension/README.md) for details.

## Development

```bash
git clone https://github.com/timo9378/flow2code.git
cd flow2code && pnpm install

pnpm dev          # Start visual canvas (dev server)
pnpm test:run     # Run 413 unit tests
pnpm test:e2e     # Run 20 Playwright E2E tests
pnpm build        # Build CLI + UI
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, project structure, and commit conventions.

## License

MIT
