# Contributing to Flow2Code

Thanks for your interest in contributing to Flow2Code!

## Quick Start

```bash
# 1. Clone & Install
git clone https://github.com/timo9378/flow2code.git
cd flow2code
pnpm install

# 2. Start dev UI (with Hot Reload)
pnpm dev

# 3. Run tests
pnpm test:run

# 4. Build CLI + Compiler
pnpm build:cli
```

## Project Structure

```
src/
  lib/
    ir/            # FlowIR types, validator, topological sort
    compiler/      # AST compiler core
      plugins/     # Node Plugin system (extensible)
      platforms/   # Platform Adapters (Next.js / Express / Cloudflare)
    storage/       # .flow.json split/merge
    diff/          # Semantic Diff
  cli/             # CLI tools (compile / watch / init)
  server/          # Standalone HTTP Server
  app/             # Next.js UI (Visual Canvas)
tests/             # Vitest tests
```

## Development Workflow

1. **Create a branch** — `feat/xxx` or `fix/xxx`
2. **Write tests** — All compiler changes must have corresponding tests
3. **Pass CI** — `pnpm lint && pnpm test:run`
4. **Open a PR** — Describe the motivation and impact of changes

## Adding a New Node Plugin

```typescript
// src/lib/compiler/plugins/builtin/my-plugin.ts
import type { NodePlugin } from "../types";

export const myPlugin: NodePlugin = {
  nodeType: "my_custom_action",
  generate(node, writer, ctx) {
    const varName = ctx.getVarName(node.id);
    writer.writeLine(`const ${varName} = doSomething();`);
    writer.writeLine(`flowState['${node.id}'] = ${varName};`);
  },
  getRequiredPackages() {
    return ["some-package"];
  },
};
```

Then register it in `src/lib/compiler/plugins/builtin/index.ts`.

## Adding a New Platform Adapter

Create a new file in `src/lib/compiler/platforms/`, implement the `PlatformAdapter` interface,
then register it in `platforms/index.ts` with `registerPlatform("myplatform", () => new MyPlatform())`.

## Testing Guidelines

- Test files go in the `tests/` directory, using Vitest
- Naming convention: `*.test.ts`
- Compiler tests should use snapshots or `toContain()` to verify generated code

## Commit Convention

```
feat: New feature
fix: Bug fix
refactor: Refactor (no behavior change)
test: Add or modify tests
docs: Documentation changes
chore: Build/CI/dependency updates
```

## License

Contributed code will be released under the MIT License.
