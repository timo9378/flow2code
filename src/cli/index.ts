#!/usr/bin/env node

/**
 * Flow2Code CLI
 *
 * Commands:
 *   flow2code compile <file>  - Compile a .flow.json file
 *   flow2code audit <file>    - Decompile and audit any TypeScript file
 *   flow2code watch [dir]     - Watch directory, auto-compile .flow.json files
 *   flow2code init            - Initialize Flow2Code in current project
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, dirname, resolve, extname, basename, relative } from "node:path";
import { execFileSync } from "node:child_process";
import { watch } from "chokidar";
import { fileURLToPath } from "node:url";
import { compile, traceLineToNode } from "../lib/compiler/compiler";
import { logger } from "../lib/logger";
import type { SourceMap } from "../lib/compiler/compiler";
import type { PlatformName } from "../lib/compiler/platforms/types";
import { validateFlowIR } from "../lib/ir/validator";
import { splitToFileSystem, mergeFromFileSystem } from "../lib/storage/split-storage";
import { loadFlowProject, loadFlowProjectAsync, saveFlowProject, migrateToSplit, detectFormat } from "../lib/storage/flow-project";
import { validateEnvVars, parseEnvFile, formatEnvValidationReport } from "../lib/compiler/env-validator";
import { semanticDiff, formatDiff } from "../lib/diff/semantic-diff";
import { diffRouteFiles, diffRouteFileVersions, diffIRs, formatRouteDiffMarkdown, formatRouteFileDiffMarkdown } from "../lib/diff/route-diff";
import type { RouteFileDiffResult } from "../lib/diff/route-diff";
import type { FlowIR, InputPort, OutputPort } from "../lib/ir/types";

const __cliFilename = fileURLToPath(import.meta.url);
const __cliDirname = dirname(__cliFilename);
const pkgJson = JSON.parse(readFileSync(join(__cliDirname, "..", "package.json"), "utf-8"));

const program = new Command();

program
  .name("flow2code")
  .description("Visual AST Compiler: Compile .flow.json into native TypeScript")
  .version(pkgJson.version);

// ============================================================
// compile command
// ============================================================

program
  .command("compile <file>")
  .description("Compile .flow.json or YAML directory to TypeScript (auto-detects format)")
  .option("-o, --output <path>", "Specify output path (overrides auto-detection)")
  .option("--platform <name>", "Target platform: nextjs | express | cloudflare", "nextjs")
  .option("--dry-run", "Display generated code without writing to file")
  .option("--source-map", "Generate Source Map mapping file (.flow.map.json)")
  .action((file: string, options: { output?: string; platform?: string; dryRun?: boolean; sourceMap?: boolean }) => {
    const filePath = resolve(file);

    if (!existsSync(filePath)) {
      console.error(`❌ File/directory not found: ${filePath}`);
      process.exit(1);
    }

    // ── Auto-detect format (supports .flow.json and YAML directories) ──
    let ir: FlowIR;
    try {
      const project = loadFlowProject(filePath);
      ir = project.ir;
      console.log(`📄 Reading: ${project.path} (${project.format === "split" ? "YAML directory" : "JSON"})`);
    } catch (err) {
      console.error(`❌ Load failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    // Validate
    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      console.error("❌ IR validation failed:");
      for (const err of validation.errors) {
        console.error(`  [${err.code}] ${err.message}`);
      }
      process.exit(1);
    }

    // Compile
    const result = compile(ir, { platform: (options.platform ?? "nextjs") as PlatformName });
    if (!result.success) {
      console.error("❌ Compilation failed:");
      result.errors?.forEach((e) => console.error(`  ${e}`));
      process.exit(1);
    }

    if (options.dryRun) {
      console.log("\n=== Generated Code ===\n");
      console.log(result.code);
      return;
    }

    // Output
    if (!result.code || !(options.output ?? result.filePath)) {
      console.error("❌ Compile result missing code or filePath");
      process.exit(1);
    }
    const outputPath = options.output ?? result.filePath!;
    const fullOutputPath = resolve(outputPath);
    const outputDir = dirname(fullOutputPath);

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(fullOutputPath, result.code, "utf-8");
    console.log(`✅ Compiled successfully: ${fullOutputPath}`);

    // Generate Source Map
    if (options.sourceMap && result.sourceMap) {
      const mapPath = fullOutputPath.replace(/\.ts$/, ".flow.map.json");
      writeFileSync(mapPath, JSON.stringify(result.sourceMap, null, 2), "utf-8");
      console.log(`🗺️ Source Map: ${mapPath}`);
    }

    // Dependency check
    if (result.dependencies && result.dependencies.all.length > 0) {
      const projectPkgPath = resolve("package.json");
      if (existsSync(projectPkgPath)) {
        try {
          const pkgJson = JSON.parse(readFileSync(projectPkgPath, "utf-8"));
          const installed = new Set([
            ...Object.keys(pkgJson.dependencies ?? {}),
            ...Object.keys(pkgJson.devDependencies ?? {}),
          ]);
          const missing = result.dependencies.all.filter((pkg) => !installed.has(pkg));
          if (missing.length > 0) {
            console.log(`\n⚠️  Missing packages:`);
            missing.forEach((pkg) => console.log(`   - ${pkg}`));
            console.log(`   Run: npm install ${missing.join(" ")}`);
          }
        } catch {
          // Ignore package.json parse errors
        }
      }
    }

    // Check and generate .env.example
    generateEnvExample();
  });

// ============================================================
// audit command — Universal TS Decompiler
// ============================================================

program
  .command("audit <file>")
  .description("Decompile any TypeScript file into a visual FlowIR for code auditing")
  .option("-o, --output <path>", "Write IR JSON to file instead of stdout")
  .option("--format <fmt>", "Output format: json | mermaid | summary", "summary")
  .option("--function <name>", "Target function name to decompile")
  .option("--no-audit-hints", "Disable audit hints")
  .action(async (file: string, options: { output?: string; format?: string; function?: string; auditHints?: boolean }) => {
    const { decompile, decompileAll } = await import("../lib/compiler/decompiler.js");
    const filePath = resolve(file);

    if (!existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      process.exit(1);
    }

    const code = readFileSync(filePath, "utf-8");
    const auditOpt = options.auditHints !== false;

    // --function pins a single handler; otherwise audit EVERY route in the file
    const entries = options.function
      ? (() => {
          const single = decompile(code, { fileName: filePath, functionName: options.function, audit: auditOpt });
          return single.success
            ? [{ name: options.function!, method: undefined as string | undefined, routePath: undefined as string | undefined, result: single }]
            : [];
        })()
      : (() => {
          const all = decompileAll(code, { fileName: filePath, audit: auditOpt });
          return all.entries.filter((e) => e.result.success);
        })();

    if (entries.length === 0) {
      console.error("❌ Decompile failed: no analyzable handler found");
      process.exit(1);
    }

    const fmt = options.format ?? "summary";
    const single = entries.length === 1;

    if (fmt === "json") {
      // single entry keeps the historical bare-IR shape; multi emits one IR per route
      const output = single
        ? JSON.stringify(entries[0].result.ir, null, 2)
        : JSON.stringify(
            entries.map((e) => ({ name: e.name, method: e.method, routePath: e.routePath, ir: e.result.ir })),
            null,
            2
          );
      if (options.output) {
        writeFileSync(resolve(options.output), output, "utf-8");
        console.log(`✅ IR written to: ${options.output}`);
      } else {
        console.log(output);
      }
    } else if (fmt === "mermaid") {
      const mermaidOutput = entries.map((e) => irToMermaid(e.result.ir!)).join("\n\n");
      if (options.output) {
        writeFileSync(resolve(options.output), mermaidOutput, "utf-8");
        console.log(`✅ Mermaid diagram written to: ${options.output}`);
      } else {
        console.log(mermaidOutput);
      }
    } else {
      // summary (default)
      console.log(`\n🔍 Flow2Code Audit: ${filePath}`);
      if (!single) console.log(`   Routes: ${entries.length}`);

      let warningCount = 0;
      for (const entry of entries) {
        const result = entry.result;
        const title = entry.routePath
          ? `${entry.method ?? ""} ${entry.routePath}`.trim()
          : entry.method ?? entry.name;
        if (!single) console.log(`\n── ${title} ──`);
        console.log(`   Confidence: ${(result.confidence * 100).toFixed(0)}%`);
        console.log(`   Nodes: ${result.ir!.nodes.length}`);
        console.log(`   Edges: ${result.ir!.edges.length}`);
        console.log("");

        for (const node of result.ir!.nodes) {
          const icon = getCategoryIcon(node.category);
          console.log(`   ${icon} [${node.id}] ${node.label} (${node.nodeType})`);
        }

        if (result.audit && result.audit.length > 0) {
          console.log("\n📋 Audit Hints:");
          for (const hint of result.audit) {
            if (hint.severity !== "info") warningCount++;
            const icon = hint.severity === "error" ? "🔴" : hint.severity === "warning" ? "🟠" : "🔵";
            const lineInfo = hint.line ? ` (line ${hint.line})` : "";
            console.log(`   ${icon} [${hint.nodeId}]${lineInfo}: ${hint.message}`);
          }
        }
      }
      console.log("");

      // Also save IR to file if -o is specified (regardless of display format)
      if (options.output) {
        const irJson = single
          ? JSON.stringify(entries[0].result.ir, null, 2)
          : JSON.stringify(entries.map((e) => ({ name: e.name, method: e.method, routePath: e.routePath, ir: e.result.ir })), null, 2);
        writeFileSync(resolve(options.output), irJson, "utf-8");
        console.log(`✅ IR written to: ${options.output}`);
      }
      process.exitCode = warningCount > 0 ? 2 : 0;
    }
  });

function getCategoryIcon(category: string): string {
  switch (category) {
    case "trigger": return "⚡";
    case "action": return "🔧";
    case "logic": return "🔀";
    case "variable": return "📦";
    case "output": return "📤";
    default: return "▪️";
  }
}

function irToMermaid(ir: FlowIR): string {
  const lines: string[] = ["graph TD"];
  for (const node of ir.nodes) {
    const shape = node.category === "trigger" ? `{{"${node.label}"}}` :
      node.category === "output" ? `(["${node.label}"])` :
        node.category === "logic" ? `{"${node.label}"}` :
          `["${node.label}"]`;
    lines.push(`  ${node.id}${shape}`);
  }
  for (const edge of ir.edges) {
    const label = edge.sourcePortId !== "output" ? `-- ${edge.sourcePortId} -->` : `-->`;
    lines.push(`  ${edge.sourceNodeId} ${label} ${edge.targetNodeId}`);
  }
  return lines.join("\n");
}

// ============================================================
// watch command
// ============================================================

program
  .command("watch [dir]")
  .description("Watch directory, auto-compile .flow.json and YAML directory changes")
  .option("-p, --project <path>", "Next.js project root directory", ".")
  .action((dir: string = ".", options: { project?: string }) => {
    const watchDir = resolve(dir);
    const projectRoot = resolve(options.project ?? ".");

    console.log(`👀 Watching: ${watchDir}/**/*.flow.json + **/*.yaml`);
    console.log(`📁 Output to: ${projectRoot}`);
    console.log("Press Ctrl+C to stop\n");

    // Watch both .flow.json and YAML (split directory format)
    const watcher = watch(
      [join(watchDir, "**/*.flow.json"), join(watchDir, "**/meta.yaml"), join(watchDir, "**/nodes/*.yaml"), join(watchDir, "**/edges.yaml")],
      {
        persistent: true,
        ignoreInitial: false,
      }
    );

    /** Determine the file's flow project and compile (with debounce) */
    const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const DEBOUNCE_MS = 150;

    const handleChange = (filePath: string) => {
      // Determine the compile key (group YAML files by their flow root)
      let compileKey = filePath;
      if (filePath.endsWith(".yaml")) {
        let dir = dirname(filePath);
        if (basename(dir) === "nodes") dir = dirname(dir);
        compileKey = dir;
      }

      // Debounce: cancel previous timer for the same key
      const existing = pendingTimers.get(compileKey);
      if (existing) clearTimeout(existing);

      pendingTimers.set(compileKey, setTimeout(() => {
        pendingTimers.delete(compileKey);
        if (filePath.endsWith(".flow.json")) {
          compileFileAsync(filePath, projectRoot);
        } else if (filePath.endsWith(".yaml")) {
          const metaPath = join(compileKey, "meta.yaml");
          if (existsSync(metaPath)) {
            compileFlowDirAsync(compileKey, projectRoot);
          }
        }
      }, DEBOUNCE_MS));
    };

    watcher.on("change", handleChange);
    watcher.on("add", handleChange);

    watcher.on("error", (error: unknown) => {
      console.error("❌ Watch error:", error instanceof Error ? error.message : String(error));
    });

    // Graceful shutdown: close watcher and clear timers on SIGINT/SIGTERM
    const cleanup = () => {
      console.log("\n🛑 Stopping watcher...");
      for (const timer of pendingTimers.values()) clearTimeout(timer);
      pendingTimers.clear();
      watcher.close().then(() => process.exit(0));
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);
  });

// ============================================================
// init command
// ============================================================

program
  .command("init")
  .description("Initialize Flow2Code in current project (Zero Pollution mode)")
  .action(() => {
    // ── Zero Pollution: all flow2code files stored in .flow2code/ ──
    const flow2codeDir = resolve(".flow2code");
    const flowsDir = join(flow2codeDir, "flows");

    if (!existsSync(flow2codeDir)) {
      mkdirSync(flow2codeDir, { recursive: true });
    }
    if (!existsSync(flowsDir)) {
      mkdirSync(flowsDir, { recursive: true });
    }

    // Create .flow2code/config.json
    const configPath = join(flow2codeDir, "config.json");
    if (!existsSync(configPath)) {
      const config = {
        version: "1.0.0",
        projectRoot: ".",
        flowsDir: ".flow2code/flows",
        outputMode: "next-app-router",
        port: 3003,
      };
      writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
      console.log("⚙️  Created .flow2code/config.json");
    }

    // Create example flow.json
    const exampleFlow = {
      version: "1.0.0",
      meta: {
        name: "Example API",
        description: "A simple GET endpoint",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      nodes: [
        {
          id: "trigger_1",
          nodeType: "http_webhook",
          category: "trigger",
          label: "GET /api/hello",
          params: {
            method: "GET",
            routePath: "/api/hello",
            parseBody: false,
          },
          inputs: [] as InputPort[],
          outputs: [{ id: "request", label: "Request", dataType: "object" }],
        },
        {
          id: "response_1",
          nodeType: "return_response",
          category: "output",
          label: "Return Hello",
          params: {
            statusCode: 200,
            bodyExpression: '{ message: "Hello from Flow2Code!" }',
          },
          inputs: [{ id: "data", label: "Data", dataType: "any", required: true }],
          outputs: [] as OutputPort[],
        },
      ],
      edges: [
        {
          id: "edge_1",
          sourceNodeId: "trigger_1",
          sourcePortId: "request",
          targetNodeId: "response_1",
          targetPortId: "data",
        },
      ],
    };

    const examplePath = join(flowsDir, "hello.flow.json");
    if (!existsSync(examplePath)) {
      writeFileSync(examplePath, JSON.stringify(exampleFlow, null, 2), "utf-8");
      console.log(`📄 Created example: ${examplePath}`);
    }

    // Ensure .gitignore includes .flow2code/
    const gitignorePath = resolve(".gitignore");
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      if (!content.includes(".flow2code/")) {
        writeFileSync(
          gitignorePath,
          content.trimEnd() + "\n\n# Flow2Code\n.flow2code/\n",
          "utf-8"
        );
        console.log("📝 Added .flow2code/ to .gitignore");
      }
    }

    console.log("\n🎉 Zero Pollution init complete!");
    console.log("  All Flow2Code files are stored in .flow2code/ directory");
    console.log("  Get started with:");
    console.log(`  npx ${pkgJson.name} compile .flow2code/flows/hello.flow.json --dry-run`);
    console.log(`  npx ${pkgJson.name} watch .flow2code/flows/`);
  });

// ============================================================
// split command
// ============================================================

program
  .command("split <file>")
  .description("Split .flow.json into a Git-friendly YAML directory structure")
  .option("-o, --output <dir>", "Specify output directory (default: same name as file)")
  .action((file: string, options: { output?: string }) => {
    const filePath = resolve(file);

    if (!existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      process.exit(1);
    }

    const raw = readFileSync(filePath, "utf-8");
    let ir: FlowIR;
    try {
      ir = JSON.parse(raw) as FlowIR;
    } catch {
      console.error("❌ JSON parse failed");
      process.exit(1);
    }

    const outputDir = options.output ?? filePath.replace(/\.flow\.json$|\.json$/, "");

    const written = splitToFileSystem(
      ir,
      resolve(outputDir),
      { mkdirSync, writeFileSync: (p, c) => writeFileSync(p, c, "utf-8") },
      { join }
    );

    console.log(`✅ Split into ${written.length} files:`);
    written.forEach((f) => console.log(`  📄 ${f}`));
  });

// ============================================================
// merge command
// ============================================================

program
  .command("merge <dir>")
  .description("Merge YAML directory structure into a .flow.json")
  .option("-o, --output <file>", "Specify output file path")
  .action((dir: string, options: { output?: string }) => {
    const dirPath = resolve(dir);

    if (!existsSync(dirPath)) {
      console.error(`❌ Directory not found: ${dirPath}`);
      process.exit(1);
    }

    try {
      const ir = mergeFromFileSystem(
        dirPath,
        { readFileSync: (p, e) => readFileSync(p, e as BufferEncoding), readdirSync: (p) => readdirSync(p) as string[], existsSync },
        { join }
      );

      const outputFile = options.output ?? `${dirPath}.flow.json`;
      writeFileSync(resolve(outputFile), JSON.stringify(ir, null, 2), "utf-8");
      console.log(`✅ Merged to: ${outputFile}`);
      console.log(`   ${ir.nodes.length} nodes, ${ir.edges.length} edges`);
    } catch (err) {
      console.error(`❌ Merge failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ============================================================
// trace command (Source Map debugging)
// ============================================================

program
  .command("migrate <file>")
  .description("Migrate .flow.json to Git-friendly YAML directory (preserves original file)")
  .option("--delete-json", "Delete original .flow.json after successful migration")
  .action((file: string, options: { deleteJson?: boolean }) => {
    const filePath = resolve(file);

    if (!existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      process.exit(1);
    }

    try {
      const written = migrateToSplit(filePath);
      console.log(`✅ Migrated to YAML directory (${written.length} files):`);
      written.forEach((f) => console.log(`  📄 ${f}`));

      if (options.deleteJson) {
        rmSync(filePath);
        console.log(`🗑️  Deleted original file: ${filePath}`);
      } else {
        console.log(`💡 Original .flow.json preserved. Delete manually after verification.`);
      }
    } catch (err) {
      console.error(`❌ Migration failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command("trace <file> <line>")
  .description("Trace a generated code line number back to its canvas node (Source Map)")
  .action((file: string, lineStr: string) => {
    const filePath = resolve(file);
    const lineNum = parseInt(lineStr, 10);

    if (isNaN(lineNum) || lineNum < 1) {
      console.error("❌ Line number must be a positive integer");
      process.exit(1);
    }

    // Try to find the corresponding .flow.map.json
    const mapPath = filePath.replace(/\.ts$/, ".flow.map.json");

    if (!existsSync(mapPath)) {
      // Try to find the corresponding .flow.map.json
      console.log(`🔍 Source Map not found (${mapPath})`);
      console.log("   Hint: Use flow2code compile with --source-map to generate mapping file");
      process.exit(1);
    }

    try {
      const mapRaw = readFileSync(mapPath, "utf-8");
      const sourceMap: SourceMap = JSON.parse(mapRaw);

      const result = traceLineToNode(sourceMap, lineNum);
      if (result) {
        console.log(`🎯 Node mapped to line ${lineNum}:`);
        console.log(`   Node ID:    ${result.nodeId}`);
        console.log(`   Line range: ${result.startLine}-${result.endLine}`);
      } else {
        console.log(`❓ Line ${lineNum} does not map to any node`);
        console.log("   It may be an import statement or framework-generated code");
      }
    } catch (err) {
      console.error(`❌ Failed to parse Source Map: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ============================================================
// diff command — Semantic diff comparison
// ============================================================

/** Prints a RouteFileDiffResult in the requested format and sets the exit code. */
function emitRouteDiff(
  result: RouteFileDiffResult,
  reportName: string,
  options: { md?: boolean; json?: boolean }
): void {
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (options.md) {
    console.log(formatRouteFileDiffMarkdown(result, { fileName: reportName }));
  } else {
    if (!result.success) {
      console.error(`❌ Analysis failed: ${(result.errors ?? []).join("; ")}`);
      process.exit(1);
    }
    const { stats } = result;
    console.log(
      `📊 Flow diff: ${stats.modified} route(s) changed, ${stats.added} added, ${stats.removed} removed, ${stats.unchanged} unchanged`
    );
    for (const route of result.routes) {
      if (route.status === "unchanged") continue;
      console.log("");
      if (route.status === "removed") {
        console.log(`  ⚠️ 🔴 Route removed: ${route.key}`);
      } else if (route.status === "added") {
        console.log(`  🟢 New route: ${route.key}`);
        for (const w of (route.audit ?? []).filter((h) => h.severity === "warning")) {
          console.log(`     🆕 [${w.severity}] ${w.message}${w.line ? ` (line ${w.line})` : ""}`);
        }
      } else if (route.diff) {
        console.log(`  ── ${route.key} ──`);
        for (const change of route.diff.changes) {
          const icon = change.type === "added" ? "🟢" : change.type === "removed" ? "🔴" : "🟡";
          console.log(`  ${icon} ${change.description}`);
        }
        for (const w of route.diff.newWarnings) {
          console.log(`  🆕 [${w.severity}] ${w.message}${w.line ? ` (line ${w.line})` : ""}`);
        }
        for (const w of route.diff.resolvedWarnings) {
          console.log(`  ✅ resolved: ${w.message}`);
        }
      }
    }
  }
  process.exitCode = result.success && result.hasWarnings ? 2 : 0;
}

/** Reads a file's content at a git ref, or null when it doesn't exist there. */
function gitShowFile(ref: string, filePath: string): string | null {
  const dir = dirname(filePath);
  try {
    const toplevel = execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
    }).trim();
    const relPath = relative(toplevel, filePath).split("\\").join("/");
    return execFileSync("git", ["-C", dir, "show", `${ref}:${relPath}`], {
      encoding: "utf-8",
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

/** True when `ref` resolves to a commit in the repo containing `filePath`. */
function isGitRef(ref: string, filePath: string): boolean {
  try {
    execFileSync("git", ["-C", dirname(filePath), "rev-parse", "--verify", "--quiet", `${ref}^{commit}`], {
      encoding: "utf-8",
    });
    return true;
  } catch {
    return false;
  }
}

const ROUTE_PATHS_DEFAULT = String.raw`(^|/)route\.[tj]sx?$|/pages/api/.+\.[tj]sx?$|/api/.+\.[tj]sx?$`;

/** Scans every changed route file between a git base and the working tree. */
function branchDiffScan(
  baseRef: string,
  options: { md?: boolean; json?: boolean; paths?: string }
): void {
  let toplevel: string;
  let mergeBase: string;
  try {
    toplevel = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
    mergeBase = baseRef === "HEAD"
      ? "HEAD"
      : execFileSync("git", ["merge-base", baseRef, "HEAD"], { encoding: "utf-8" }).trim();
  } catch {
    console.error("❌ Not a git repository (or unknown ref). Branch scan needs git.");
    process.exit(1);
  }

  const pathsRe = new RegExp(options.paths ?? ROUTE_PATHS_DEFAULT);
  const changed = execFileSync(
    "git", ["diff", "--name-only", "--diff-filter=ACMRD", mergeBase],
    { encoding: "utf-8", cwd: toplevel, maxBuffer: 64 * 1024 * 1024 }
  ).trim().split("\n").filter(Boolean).filter((f) => pathsRe.test(f));

  if (changed.length === 0) {
    console.log(`✅ No route files changed vs ${baseRef}.`);
    return;
  }

  let anyWarnings = false;
  const mdSections: string[] = [];
  const jsonResults: { file: string; result: RouteFileDiffResult }[] = [];

  for (const file of changed) {
    const absPath = join(toplevel, file);
    let before: string | null;
    try {
      before = execFileSync("git", ["show", `${mergeBase}:${file}`], {
        encoding: "utf-8", cwd: toplevel, maxBuffer: 16 * 1024 * 1024,
      });
    } catch {
      before = null; // added file
    }
    const after = existsSync(absPath) ? readFileSync(absPath, "utf-8") : null;

    const result = diffRouteFileVersions(before, after, { fileName: file });
    if (result.hasWarnings) anyWarnings = true;

    if (options.json) {
      jsonResults.push({ file, result });
    } else if (options.md) {
      mdSections.push(formatRouteFileDiffMarkdown(result, { fileName: file }));
    } else {
      const changedCount = result.stats.added + result.stats.removed + result.stats.modified;
      if (!result.success) {
        console.log(`\n📄 ${file} — ❓ could not analyze`);
        continue;
      }
      if (changedCount === 0) {
        console.log(`\n📄 ${file} — no flow-level changes`);
        continue;
      }
      console.log(`\n📄 ${file}`);
      emitRouteDiff(result, file, { md: false, json: false });
    }
  }

  if (options.json) console.log(JSON.stringify(jsonResults, null, 2));
  else if (options.md) console.log(mdSections.join("\n\n---\n\n"));
  process.exitCode = anyWarnings ? 2 : 0;
}

program
  .command("diff [before] [after]")
  .description(
    "Semantic flow diff. Compare two files, a git ref against the working tree, " +
    "a route file against HEAD, or every changed route on the branch:\n" +
    "  flow2code diff                       # all changed routes vs HEAD\n" +
    "  flow2code diff main...               # all changed routes vs main\n" +
    "  flow2code diff route.ts              # one file vs HEAD\n" +
    "  flow2code diff main route.ts         # one file vs ref\n" +
    "  flow2code diff old.ts new.ts         # two files"
  )
  .option("--md", "Output a Markdown report (PR comment format)")
  .option("--json", "Output machine-readable JSON")
  .option("--name <fileName>", "File name shown in the report header")
  .option("--paths <regex>", "Route file filter used by branch scans")
  .action((beforeFile: string | undefined, afterFile: string | undefined, options: { md?: boolean; json?: boolean; name?: string; paths?: string }) => {
    const isTs = (p: string) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p);

    // ── branch scan modes ──
    // `diff`            → every changed route file vs HEAD
    // `diff main...`    → every changed route file vs merge-base with main
    if (beforeFile === undefined) {
      branchDiffScan("HEAD", options);
      return;
    }
    const refArg = beforeFile.endsWith("...") ? beforeFile.slice(0, -3) : beforeFile;
    if (afterFile === undefined && !existsSync(resolve(beforeFile)) && isGitRef(refArg, process.cwd() + "/x")) {
      branchDiffScan(refArg, options);
      return;
    }

    // ── git modes ──
    // `diff route.ts`      → HEAD vs working tree
    // `diff <ref> route.ts` → ref vs working tree
    let gitRef: string | null = null;
    let gitFile: string | null = null;
    if (afterFile === undefined && isTs(beforeFile) && existsSync(resolve(beforeFile))) {
      gitRef = "HEAD";
      gitFile = resolve(beforeFile);
    } else if (
      afterFile !== undefined && isTs(afterFile) && existsSync(resolve(afterFile)) &&
      !existsSync(resolve(beforeFile)) && isGitRef(beforeFile, resolve(afterFile))
    ) {
      gitRef = beforeFile;
      gitFile = resolve(afterFile);
    }

    if (gitRef && gitFile) {
      const beforeContent = gitShowFile(gitRef, gitFile);
      if (beforeContent === null) {
        console.error(`❌ ${relative(process.cwd(), gitFile)} has no version at ${gitRef} (new file, or not in a git repository?)`);
        process.exit(1);
      }
      const reportName = options.name ?? relative(process.cwd(), gitFile);
      const result = diffRouteFiles(beforeContent, readFileSync(gitFile, "utf-8"), { fileName: reportName });
      emitRouteDiff(result, reportName, options);
      return;
    }

    if (afterFile === undefined) {
      console.error(`❌ ${beforeFile} not found. Usage: flow2code diff <file.ts> | <ref> <file.ts> | <before> <after>`);
      process.exit(1);
    }

    const beforePath = resolve(beforeFile);
    const afterPath = resolve(afterFile);

    if (!existsSync(beforePath)) {
      console.error(`❌ File not found: ${beforePath} (not an existing file, and not a git ref of ${afterFile})`);
      process.exit(1);
    }
    if (!existsSync(afterPath)) {
      console.error(`❌ File not found: ${afterPath}`);
      process.exit(1);
    }

    // TypeScript route diff: decompile both sides, align flows, report semantics
    if (isTs(beforePath) || isTs(afterPath)) {
      const reportName = options.name ?? afterFile;
      const result = diffRouteFiles(
        readFileSync(beforePath, "utf-8"),
        readFileSync(afterPath, "utf-8"),
        { fileName: reportName }
      );
      emitRouteDiff(result, reportName, options);
      return;
    }

    let beforeIR: FlowIR;
    let afterIR: FlowIR;
    try {
      beforeIR = JSON.parse(readFileSync(beforePath, "utf-8")) as FlowIR;
      afterIR = JSON.parse(readFileSync(afterPath, "utf-8")) as FlowIR;
    } catch {
      console.error("❌ JSON parse failed");
      process.exit(1);
    }

    if (options.md) {
      const result = diffIRs(beforeIR, afterIR);
      console.log(formatRouteDiffMarkdown(result, { fileName: options.name ?? afterFile }));
      return;
    }

    const summary = semanticDiff(beforeIR, afterIR);
    console.log(formatDiff(summary));
  });

// ============================================================
// mcp command — Model Context Protocol server (stdio)
// ============================================================

program
  .command("mcp")
  .description("Start the MCP server (stdio) exposing audit_route / diff_routes / flow_graph to AI agents")
  .action(async () => {
    // lazy import keeps MCP SDK out of the startup path for all other commands
    const { startMcpServer } = await import("../mcp/server");
    await startMcpServer();
  });

// ============================================================
// env-check command — Environment variable validation
// ============================================================

program
  .command("env-check <file>")
  .description("Validate that environment variables referenced in .flow.json are declared")
  .option("-e, --env <envFile>", "Specify .env file path", ".env")
  .action((file: string, options: { env: string }) => {
    const filePath = resolve(file);
    const envPath = resolve(options.env);

    if (!existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      process.exit(1);
    }

    let ir: FlowIR;
    try {
      ir = JSON.parse(readFileSync(filePath, "utf-8")) as FlowIR;
    } catch {
      console.error("❌ JSON parse failed");
      process.exit(1);
    }

    // Try to load .env file
    let declaredVars: string[] = [];
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, "utf-8");
      declaredVars = parseEnvFile(envContent);
    } else {
      // Also try .env.example
      const examplePath = resolve(".env.example");
      if (existsSync(examplePath)) {
        const envContent = readFileSync(examplePath, "utf-8");
        declaredVars = parseEnvFile(envContent);
        console.log(`ℹ️  ${options.env} not found, using .env.example as reference\n`);
      } else {
        console.log(`⚠️  No .env or .env.example found, will report all referenced env vars\n`);
      }
    }

    // Also include system environment variables (e.g. CI/CD pipeline injections)
    const systemEnvKeys = Object.keys(process.env).filter(
      (k) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k)
    );
    const allDeclaredVars = [...new Set([...declaredVars, ...systemEnvKeys])];

    const result = validateEnvVars(ir, allDeclaredVars);
    console.log(formatEnvValidationReport(result));

    if (!result.valid) {
      process.exit(1);
    }
  });

// ============================================================
// dev command — Start standalone server
// ============================================================

async function startDevServer(options: { port: string; open: boolean }) {
  const port = parseInt(options.port, 10);
  // Dynamic import — only loads server when dev/ui command is used
  const { startServer } = await import("../server/index.js");

  startServer({
    port,
    onReady: (url) => {
      console.log(`\n  🚀 Flow2Code Dev Server`);
      console.log(`  ├─ Editor:  ${url}`);
      console.log(`  ├─ API:     ${url}/api/compile`);
      console.log(`  └─ Project: ${process.cwd()}\n`);

      if (options.open) {
        // Cross-platform browser open
        const openCmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        import("node:child_process").then(({ exec }) => exec(`${openCmd} ${url}`));
      }
    },
  });
}

program
  .command("dev")
  .description("Start Flow2Code visual editor (standalone dev server)")
  .option("-p, --port <port>", "Server port", "3100")
  .option("--no-open", "Do not auto-open browser")
  .option("--silent", "Suppress non-error output (for CI/CD)")
  .action((opts) => {
    if (opts.silent) logger.level = "silent";
    startDevServer(opts);
  });

program
  .command("ui")
  .description("Start Flow2Code visual editor (alias for dev)")
  .option("-p, --port <port>", "Server port", "3100")
  .option("--no-open", "Do not auto-open browser")
  .option("--silent", "Suppress non-error output (for CI/CD)")
  .action((opts) => {
    if (opts.silent) logger.level = "silent";
    startDevServer(opts);
  });

// ============================================================
// Helper Functions
// ============================================================

function compileFile(filePath: string, projectRoot: string): void {
  const startTime = Date.now();

  try {
    const raw = readFileSync(filePath, "utf-8");
    const ir = JSON.parse(raw) as FlowIR;

    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      console.error(`❌ [${filePath}] Validation failed:`);
      validation.errors.forEach((e) => console.error(`  ${e.message}`));
      return;
    }

    const result = compile(ir);
    if (!result.success) {
      console.error(`❌ [${filePath}] Compilation failed:`);
      result.errors?.forEach((e) => console.error(`  ${e}`));
      return;
    }

    if (!result.code || !result.filePath) {
      console.error(`❌ [${filePath}] Compile result missing code or filePath`);
      return;
    }
    const outputPath = join(projectRoot, result.filePath);
    const outputDir = dirname(outputPath);

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(outputPath, result.code, "utf-8");

    const elapsed = Date.now() - startTime;
    console.log(`✅ [${elapsed}ms] ${filePath} → ${outputPath}`);
  } catch (err) {
    console.error(
      `❌ [${filePath}] Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Compile from YAML directory — used by watch */
function compileFlowDir(dirPath: string, projectRoot: string): void {
  const startTime = Date.now();
  try {
    const project = loadFlowProject(dirPath);
    const ir = project.ir;

    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      console.error(`❌ [${dirPath}] Validation failed:`);
      validation.errors.forEach((e) => console.error(`  ${e.message}`));
      return;
    }

    const result = compile(ir);
    if (!result.success) {
      console.error(`❌ [${dirPath}] Compilation failed:`);
      result.errors?.forEach((e) => console.error(`  ${e}`));
      return;
    }

    if (!result.code || !result.filePath) {
      console.error(`❌ [${dirPath}] Compile result missing code or filePath`);
      return;
    }
    const outputPath = join(projectRoot, result.filePath);
    const outputDir = dirname(outputPath);

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(outputPath, result.code, "utf-8");

    const elapsed = Date.now() - startTime;
    console.log(`✅ [${elapsed}ms] ${dirPath}/ → ${outputPath}`);
  } catch (err) {
    console.error(
      `❌ [${dirPath}] Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function generateEnvExample(): void {
  const envExamplePath = resolve(".env.example");
  if (!existsSync(envExamplePath)) {
    writeFileSync(
      envExamplePath,
      "# Flow2Code environment variables\n# Define API keys and sensitive information here\n",
      "utf-8"
    );
    console.log("📝 Generated .env.example");
  }
}

// ============================================================
// Async Compile Helpers (for watch mode — non-blocking I/O)
// ============================================================

async function compileFileAsync(filePath: string, projectRoot: string): Promise<void> {
  const startTime = Date.now();

  try {
    const raw = await readFile(filePath, "utf-8");
    const ir = JSON.parse(raw) as FlowIR;

    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      console.error(`❌ [${filePath}] Validation failed:`);
      validation.errors.forEach((e) => console.error(`  ${e.message}`));
      return;
    }

    const result = compile(ir);
    if (!result.success) {
      console.error(`❌ [${filePath}] Compilation failed:`);
      result.errors?.forEach((e) => console.error(`  ${e}`));
      return;
    }

    if (!result.code || !result.filePath) {
      console.error(`❌ [${filePath}] Compile result missing code or filePath`);
      return;
    }
    const outputPath = join(projectRoot, result.filePath);
    const outputDir = dirname(outputPath);

    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    await writeFile(outputPath, result.code, "utf-8");

    const elapsed = Date.now() - startTime;
    console.log(`✅ [${elapsed}ms] ${filePath} → ${outputPath}`);
  } catch (err) {
    console.error(
      `❌ [${filePath}] Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Async compile from YAML directory — used by watch (non-blocking I/O) */
async function compileFlowDirAsync(dirPath: string, projectRoot: string): Promise<void> {
  const startTime = Date.now();
  try {
    const project = await loadFlowProjectAsync(dirPath);
    const ir = project.ir;

    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      console.error(`❌ [${dirPath}] Validation failed:`);
      validation.errors.forEach((e) => console.error(`  ${e.message}`));
      return;
    }

    const result = compile(ir);
    if (!result.success) {
      console.error(`❌ [${dirPath}] Compilation failed:`);
      result.errors?.forEach((e) => console.error(`  ${e}`));
      return;
    }

    if (!result.code || !result.filePath) {
      console.error(`❌ [${dirPath}] Compile result missing code or filePath`);
      return;
    }
    const outputPath = join(projectRoot, result.filePath);
    const outputDir = dirname(outputPath);

    if (!existsSync(outputDir)) {
      await mkdir(outputDir, { recursive: true });
    }

    await writeFile(outputPath, result.code, "utf-8");

    const elapsed = Date.now() - startTime;
    console.log(`✅ [${elapsed}ms] ${dirPath}/ → ${outputPath}`);
  } catch (err) {
    console.error(
      `❌ [${dirPath}] Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ============================================================
// Execute
// ============================================================

// Show help if no command provided
if (process.argv.length <= 2) {
  program.help();
}

program.parse();
