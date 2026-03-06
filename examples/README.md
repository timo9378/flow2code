# Flow2Code Examples

This directory contains sample `.flow.json` files you can compile directly with the CLI.

## Getting Started

```bash
# Compile a flow to TypeScript (dry-run)
npx flow2code compile examples/hello-world.flow.json --dry-run

# Compile with a specific platform
npx flow2code compile examples/fetch-external-api.flow.json --platform express

# Compile all examples
for f in examples/*.flow.json; do npx flow2code compile "$f" --dry-run; done
```

## Examples

| File | Description | Concepts |
|------|-------------|----------|
| `hello-world.flow.json` | Simplest GET API returning a greeting | HTTP trigger → Response |
| `fetch-external-api.flow.json` | Fetch users from JSONPlaceholder | HTTP trigger → Fetch API → Response |
| `if-else-auth.flow.json` | POST login with credential validation | HTTP trigger → If/Else → branched Response |
| `copilot-chat-completions.flow.json` | Proxy chat completions to copilot-api | Streaming, If/Else, env vars |
| `copilot-models.flow.json` | Fetch available models from copilot-api | Fetch API, env vars |
| `copilot-usage-stats.flow.json` | Aggregate copilot usage statistics | Multiple fetches, transform |

## Headless Usage

You can also compile flows programmatically without the CLI:

```ts
import { compile } from "@timo9378/flow2code/compiler";
import fs from "fs";

const ir = JSON.parse(fs.readFileSync("examples/hello-world.flow.json", "utf-8"));
const result = compile(ir, { platform: "nextjs" });

if (result.success) {
  console.log(result.code);
}
```
