# Flow2Code

**The Visual AST Compiler & Code Audit Tool for Backend APIs.**

> AI generates the code, Flow2Code decompiles it into a visual flow for you to audit, or compiles your visual flow into production-ready TypeScript.

[![CI](https://github.com/timo9378/flow2code/actions/workflows/ci.yml/badge.svg)](https://github.com/timo9378/flow2code/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/flow2code.svg)](https://www.npmjs.com/package/flow2code)

```
            ┌──────────────────────────────────┐
            │         flow2code                │
            │                                  │
  TS Code ──┤►  decompile() → FlowIR → Canvas  │  ← AI Code Audit
            │                                  │
  Canvas  ──┤►  FlowIR → compile() → TS Code   │  ← Visual Compiler
            └──────────────────────────────────┘
```

## Why Flow2Code?

| Traditional Low-Code | Flow2Code |
|---|---|
| Vendor-locked Runtime | **Zero-dependency** — outputs native TypeScript, deploy anywhere |
| Black-box nodes | **AST Compilation** — ts-morph generates syntactically correct code |
| Single platform | **Multi-platform** — Next.js, Express, Cloudflare Workers |
| Can't version control | **Git-friendly** — IR is JSON/YAML, diffable in PRs |
| Developers don't trust it | **Visual Audit** — bidirectional canvas ↔ code mapping |

## Core Features

- **AST Compilation, not interpretation** — Uses ts-morph to generate syntactically correct TypeScript. No string concatenation.
- **Zero-dependency output** — Generated code has no runtime dependency. Deploy directly to Vercel / AWS Lambda / Cloudflare.
- **Multi-platform output** — Same flow compiles to Next.js, Express, or Cloudflare Workers.
- **Per-instance Plugin System** — Node logic is extensible via plugins. Compile sessions are isolated.
- **flowState + Type Inference** — Cross-node data passing with TypeScript type safety.
- **Auto concurrency detection** — Topological sort identifies independent nodes, auto-generates `Promise.allSettled`.
- **Environment variable protection** — Secrets auto-converted to `process.env.XXX`.
- **Expression Parser** — Recursive Descent Parser for `$input` / `$trigger` / `$node.xxx` template syntax.
- **Decompiler** — TypeScript → FlowIR reverse parser for code auditing.
- **Semantic Diff** — Structural comparison of two IR versions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Visual Canvas | Next.js 16 + React 19 + React Flow (@xyflow/react v12) |
| State Management | Zustand 5 |
| IR Specification | Custom JSON Schema + TypeScript Types |
| AST Engine | ts-morph 27 (TypeScript Compiler API Wrapper) |
| Platform Adapters | NextjsPlatform / ExpressPlatform / CloudflarePlatform |
| Plugin System | `createPluginRegistry()` factory (per-instance) |
| CLI | Commander.js + Chokidar |
| Testing | Vitest 4 — 207+ tests |
| CI | GitHub Actions (Node 20/22 matrix) |

## Quick Start

```bash
# Install dependencies
pnpm install

# Start dev server (visual canvas)
pnpm dev

# Run tests
pnpm test:run

# Compile a single .flow.json (preview mode)
npx tsx src/cli/index.ts compile flows/hello.flow.json --dry-run

# Compile for a specific platform
npx tsx src/cli/index.ts compile flows/hello.flow.json --platform express

# Watch mode (auto-compile on file change)
npx tsx src/cli/index.ts watch flows/

# Build CLI + Compiler
pnpm build:cli
```

## Headless Usage (No UI Required)

```ts
import { compile } from "flow2code/compiler";

const ir = JSON.parse(fs.readFileSync("my-api.flow.json", "utf-8"));
const result = compile(ir, { platform: "express" });

if (result.success) {
  fs.writeFileSync(result.filePath!, result.code!);
}
```

## Decompiler (TypeScript → Visual Flow)

```ts
import { decompile } from "flow2code/compiler";

const code = fs.readFileSync("route.ts", "utf-8");
const result = decompile(code);

if (result.success) {
  console.log(JSON.stringify(result.ir, null, 2));
  console.log(`Confidence: ${result.confidence}`);
}
```

## Project Structure

```
flow2code/
├── src/
│   ├── app/                         # Next.js App Router (UI)
│   ├── components/                  # Visual canvas components
│   ├── store/                       # Zustand canvas state management
│   ├── lib/
│   │   ├── index.ts                 # Headless Compiler public API
│   │   ├── ir/
│   │   │   ├── types.ts             # IR Schema + TypeScript types
│   │   │   ├── validator.ts         # IR validator
│   │   │   └── topological-sort.ts  # Topological sort + concurrency detection
│   │   ├── compiler/
│   │   │   ├── compiler.ts          # AST compiler core
│   │   │   ├── decompiler.ts        # TS → FlowIR reverse parser
│   │   │   ├── expression-parser.ts # Recursive Descent Parser
│   │   │   ├── type-inference.ts    # Type inference engine
│   │   │   ├── symbol-table.ts      # Human-readable variable naming
│   │   │   ├── plugins/             # Plugin system (extensible)
│   │   │   │   ├── types.ts         # PluginRegistry interface
│   │   │   │   └── builtin.ts       # 14 built-in plugins
│   │   │   └── platforms/           # Platform adapters
│   │   │       ├── types.ts         # PlatformAdapter interface
│   │   │       ├── nextjs.ts        # Next.js App Router
│   │   │       ├── express.ts       # Express.js
│   │   │       └── cloudflare.ts    # Cloudflare Workers
│   │   ├── diff/                    # Semantic Diff
│   │   └── storage/                 # .flow.json split/merge
│   ├── cli/                         # CLI (compile/watch/init)
│   └── server/                      # Standalone HTTP Server
├── tests/                           # 207+ tests (Vitest)
├── .github/workflows/ci.yml         # GitHub Actions CI
├── CONTRIBUTING.md
└── vitest.config.ts
```

## Node Types

| Category | Node | Compiled Output |
|----------|------|-----------------|
| ⚡ Trigger | HTTP Webhook | `export async function POST(req)` |
| ⚡ Trigger | Cron Job | Scheduled function |
| ⚡ Trigger | Manual | Exported async function |
| 🔧 Action | Fetch API | `await fetch(...)` + try/catch |
| 🔧 Action | SQL Query | Drizzle / Prisma / Raw SQL |
| 🔧 Action | Redis Cache | Redis get/set/del |
| 🔧 Action | Custom Code | Inline TypeScript |
| 🔧 Action | Call Subflow | `await importedFunction(...)` |
| 🔀 Logic | If/Else | `if (...) { } else { }` |
| 🔀 Logic | For Loop | `for (const item of ...)` |
| 🔀 Logic | Try/Catch | `try { } catch (e) { }` |
| 🔀 Logic | Promise.all | `await Promise.allSettled([...])` |
| 📦 Variable | Declare | `const x = ...` |
| 📦 Variable | Transform | Expression transform |
| 📤 Output | Return Response | Platform-specific Response |

## Platform Support

| Platform | Trigger Init | Response | CLI Flag |
|----------|-------------|----------|----------|
| **Next.js** (default) | `req.nextUrl.searchParams` / `req.json()` | `NextResponse.json()` | `--platform nextjs` |
| **Express** | `req.query` / `req.body` | `res.status().json()` | `--platform express` |
| **Cloudflare Workers** | `new URL(request.url)` / `request.json()` | `new Response()` | `--platform cloudflare` |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT
