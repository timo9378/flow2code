#!/usr/bin/env node

/**
 * Flow2Code CLI
 * 
 * 指令：
 *   flow2code compile <file>  - 編譯單一 .flow.json 檔案
 *   flow2code watch [dir]     - 監聽目錄，自動編譯 .flow.json 檔案
 *   flow2code init             - 在當前專案初始化 Flow2Code
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { join, dirname, resolve, extname, basename } from "node:path";
import { watch } from "chokidar";
import { compile, traceLineToNode } from "../lib/compiler/compiler";
import type { SourceMap } from "../lib/compiler/compiler";
import type { PlatformName } from "../lib/compiler/platforms/types";
import { validateFlowIR } from "../lib/ir/validator";
import { splitToFileSystem, mergeFromFileSystem } from "../lib/storage/split-storage";
import { loadFlowProject, saveFlowProject, migrateToSplit, detectFormat } from "../lib/storage/flow-project";
import { validateEnvVars, parseEnvFile, formatEnvValidationReport } from "../lib/compiler/env-validator";
import { semanticDiff, formatDiff } from "../lib/diff/semantic-diff";
import type { FlowIR, InputPort, OutputPort } from "../lib/ir/types";

const program = new Command();

program
  .name("flow2code")
  .description("Visual AST Compiler: 將 .flow.json 編譯為原生 TypeScript")
  .version("0.1.0");

// ============================================================
// compile 指令
// ============================================================

program
  .command("compile <file>")
  .description("編譯 .flow.json 或 YAML 目錄為 TypeScript（自動偵測格式）")
  .option("-o, --output <path>", "指定輸出路徑（覆蓋自動偵測）")
  .option("--platform <name>", "目標平台: nextjs | express | cloudflare", "nextjs")
  .option("--dry-run", "僅顯示生成的代碼，不寫入檔案")
  .option("--source-map", "生成 Source Map 映射檔 (.flow.map.json)")
  .action((file: string, options: { output?: string; platform?: string; dryRun?: boolean; sourceMap?: boolean }) => {
    const filePath = resolve(file);

    if (!existsSync(filePath)) {
      console.error(`❌ 檔案/目錄不存在: ${filePath}`);
      process.exit(1);
    }

    // ── 自動偵測格式（支援 .flow.json 和 YAML 目錄） ──
    let ir: FlowIR;
    try {
      const project = loadFlowProject(filePath);
      ir = project.ir;
      console.log(`📄 讀取: ${project.path} (${project.format === "split" ? "YAML 目錄" : "JSON"})`);
    } catch (err) {
      console.error(`❌ 載入失敗: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }

    // 驗證
    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      console.error("❌ IR 驗證失敗:");
      for (const err of validation.errors) {
        console.error(`  [${err.code}] ${err.message}`);
      }
      process.exit(1);
    }

    // 編譯
    const result = compile(ir, { platform: (options.platform ?? "nextjs") as PlatformName });
    if (!result.success) {
      console.error("❌ 編譯失敗:");
      result.errors?.forEach((e) => console.error(`  ${e}`));
      process.exit(1);
    }

    if (options.dryRun) {
      console.log("\n=== Generated Code ===\n");
      console.log(result.code);
      return;
    }

    // 輸出
    if (!result.code || !(options.output ?? result.filePath)) {
      console.error("❌ 編譯結果缺少 code 或 filePath");
      process.exit(1);
    }
    const outputPath = options.output ?? result.filePath!;
    const fullOutputPath = resolve(outputPath);
    const outputDir = dirname(fullOutputPath);

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(fullOutputPath, result.code, "utf-8");
    console.log(`✅ 編譯成功: ${fullOutputPath}`);

    // 生成 Source Map
    if (options.sourceMap && result.sourceMap) {
      const mapPath = fullOutputPath.replace(/\.ts$/, ".flow.map.json");
      writeFileSync(mapPath, JSON.stringify(result.sourceMap, null, 2), "utf-8");
      console.log(`🗺️ Source Map: ${mapPath}`);
    }

    // 依賴套件檢查
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
            console.log(`\n⚠️  缺少的套件:`);
            missing.forEach((pkg) => console.log(`   - ${pkg}`));
            console.log(`   執行: npm install ${missing.join(" ")}`);
          }
        } catch {
          // 忽略 package.json 解析錯誤
        }
      }
    }

    // 檢查並生成 .env.example
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
    const { decompile } = await import("../lib/compiler/decompiler.js");
    const filePath = resolve(file);

    if (!existsSync(filePath)) {
      console.error(`❌ File not found: ${filePath}`);
      process.exit(1);
    }

    const code = readFileSync(filePath, "utf-8");
    const result = decompile(code, {
      fileName: basename(filePath),
      functionName: options.function,
      audit: options.auditHints !== false,
    });

    if (!result.success) {
      console.error("❌ Decompile failed:");
      result.errors?.forEach((e) => console.error(`  ${e}`));
      process.exit(1);
    }

    const fmt = options.format ?? "summary";

    if (fmt === "json") {
      const output = JSON.stringify(result.ir, null, 2);
      if (options.output) {
        writeFileSync(resolve(options.output), output, "utf-8");
        console.log(`✅ IR written to: ${options.output}`);
      } else {
        console.log(output);
      }
    } else if (fmt === "mermaid") {
      console.log(irToMermaid(result.ir!));
    } else {
      // summary (default)
      console.log(`\n🔍 Flow2Code Audit: ${filePath}`);
      console.log(`   Confidence: ${(result.confidence * 100).toFixed(0)}%`);
      console.log(`   Nodes: ${result.ir!.nodes.length}`);
      console.log(`   Edges: ${result.ir!.edges.length}`);
      console.log("");

      // Node summary
      for (const node of result.ir!.nodes) {
        const icon = getCategoryIcon(node.category);
        console.log(`   ${icon} [${node.id}] ${node.label} (${node.nodeType})`);
      }

      // Audit hints
      if (result.audit && result.audit.length > 0) {
        console.log("\n📋 Audit Hints:");
        for (const hint of result.audit) {
          const icon = hint.severity === "error" ? "🔴" : hint.severity === "warning" ? "🟠" : "🔵";
          const lineInfo = hint.line ? ` (line ${hint.line})` : "";
          console.log(`   ${icon} [${hint.nodeId}]${lineInfo}: ${hint.message}`);
        }
      }
      console.log("");
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
  .description("監聽目錄，自動編譯 .flow.json 和 YAML 目錄變動")
  .option("-p, --project <path>", "Next.js 專案根目錄", ".")
  .action((dir: string = ".", options: { project?: string }) => {
    const watchDir = resolve(dir);
    const projectRoot = resolve(options.project ?? ".");

    console.log(`👀 監聽中: ${watchDir}/**/*.flow.json + **/*.yaml`);
    console.log(`📁 輸出至: ${projectRoot}`);
    console.log("按 Ctrl+C 停止\n");

    // 同時監聽 .flow.json 和 YAML（split 目錄格式）
    const watcher = watch(
      [join(watchDir, "**/*.flow.json"), join(watchDir, "**/meta.yaml"), join(watchDir, "**/nodes/*.yaml"), join(watchDir, "**/edges.yaml")],
      {
        persistent: true,
        ignoreInitial: false,
      }
    );

    /** 判斷檔案所屬的 flow 專案並編譯 */
    const handleChange = (filePath: string) => {
      if (filePath.endsWith(".flow.json")) {
        compileFile(filePath, projectRoot);
      } else if (filePath.endsWith(".yaml")) {
        // 找到 flow 根目錄（含 meta.yaml 的目錄）
        let dir = dirname(filePath);
        if (basename(dir) === "nodes") dir = dirname(dir);
        const metaPath = join(dir, "meta.yaml");
        if (existsSync(metaPath)) {
          compileFlowDir(dir, projectRoot);
        }
      }
    };

    watcher.on("change", handleChange);
    watcher.on("add", handleChange);

    watcher.on("error", (error: unknown) => {
      console.error("❌ 監聽錯誤:", error instanceof Error ? error.message : String(error));
    });
  });

// ============================================================
// init 指令
// ============================================================

program
  .command("init")
  .description("在當前專案初始化 Flow2Code（Zero Pollution 模式）")
  .action(() => {
    // ── Zero Pollution：所有 flow2code 檔案存放在 .flow2code/ ──
    const flow2codeDir = resolve(".flow2code");
    const flowsDir = join(flow2codeDir, "flows");

    if (!existsSync(flow2codeDir)) {
      mkdirSync(flow2codeDir, { recursive: true });
    }
    if (!existsSync(flowsDir)) {
      mkdirSync(flowsDir, { recursive: true });
    }

    // 建立 .flow2code/config.json
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
      console.log("⚙️  已建立 .flow2code/config.json");
    }

    // 建立範例 flow.json
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
      console.log(`📄 已建立範例: ${examplePath}`);
    }

    // 確保 .gitignore 包含 .flow2code/
    const gitignorePath = resolve(".gitignore");
    if (existsSync(gitignorePath)) {
      const content = readFileSync(gitignorePath, "utf-8");
      if (!content.includes(".flow2code/")) {
        writeFileSync(
          gitignorePath,
          content.trimEnd() + "\n\n# Flow2Code\n.flow2code/\n",
          "utf-8"
        );
        console.log("📝 已將 .flow2code/ 加入 .gitignore");
      }
    }

    console.log("\n🎉 Zero Pollution 初始化完成！");
    console.log("  所有 Flow2Code 檔案存放在 .flow2code/ 目錄中");
    console.log("  執行以下指令開始：");
    console.log("  npx flow2code compile .flow2code/flows/hello.flow.json --dry-run");
    console.log("  npx flow2code watch .flow2code/flows/");
  });

// ============================================================
// split 指令
// ============================================================

program
  .command("split <file>")
  .description("將 .flow.json 拆分為 Git-friendly 的 YAML 目錄結構")
  .option("-o, --output <dir>", "指定輸出目錄（預設為同名目錄）")
  .action((file: string, options: { output?: string }) => {
    const filePath = resolve(file);

    if (!existsSync(filePath)) {
      console.error(`❌ 檔案不存在: ${filePath}`);
      process.exit(1);
    }

    const raw = readFileSync(filePath, "utf-8");
    let ir: FlowIR;
    try {
      ir = JSON.parse(raw) as FlowIR;
    } catch {
      console.error("❌ JSON 解析失敗");
      process.exit(1);
    }

    const outputDir = options.output ?? filePath.replace(/\.flow\.json$|\.json$/, "");

    const written = splitToFileSystem(
      ir,
      resolve(outputDir),
      { mkdirSync, writeFileSync: (p, c) => writeFileSync(p, c, "utf-8") },
      { join }
    );

    console.log(`✅ 已拆分為 ${written.length} 個檔案:`);
    written.forEach((f) => console.log(`  📄 ${f}`));
  });

// ============================================================
// merge 指令
// ============================================================

program
  .command("merge <dir>")
  .description("將 YAML 目錄結構合併為 .flow.json")
  .option("-o, --output <file>", "指定輸出檔案路徑")
  .action((dir: string, options: { output?: string }) => {
    const dirPath = resolve(dir);

    if (!existsSync(dirPath)) {
      console.error(`❌ 目錄不存在: ${dirPath}`);
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
      console.log(`✅ 已合併為: ${outputFile}`);
      console.log(`   ${ir.nodes.length} 個節點, ${ir.edges.length} 條連線`);
    } catch (err) {
      console.error(`❌ 合併失敗: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ============================================================
// trace 指令（Source Map 除錯）
// ============================================================

program
  .command("migrate <file>")
  .description("將 .flow.json 遷移為 Git-friendly 的 YAML 目錄（保留原始檔案）")
  .option("--delete-json", "遷移成功後刪除原始 .flow.json")
  .action((file: string, options: { deleteJson?: boolean }) => {
    const filePath = resolve(file);

    if (!existsSync(filePath)) {
      console.error(`❌ 檔案不存在: ${filePath}`);
      process.exit(1);
    }

    try {
      const written = migrateToSplit(filePath);
      console.log(`✅ 已遷移為 YAML 目錄 (${written.length} 個檔案):`);
      written.forEach((f) => console.log(`  📄 ${f}`));

      if (options.deleteJson) {
        rmSync(filePath);
        console.log(`🗑️  已刪除原始檔案: ${filePath}`);
      } else {
        console.log(`💡 原始 .flow.json 已保留，確認無誤後可手動刪除`);
      }
    } catch (err) {
      console.error(`❌ 遷移失敗: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

program
  .command("trace <file> <line>")
  .description("根據生成的程式碼行號，追溯對應的畫布節點 (Source Map)")
  .action((file: string, lineStr: string) => {
    const filePath = resolve(file);
    const lineNum = parseInt(lineStr, 10);

    if (isNaN(lineNum) || lineNum < 1) {
      console.error("❌ 行號必須為正整數");
      process.exit(1);
    }

    // 嘗試找到對應的 .flow.map.json
    const mapPath = filePath.replace(/\.ts$/, ".flow.map.json");

    if (!existsSync(mapPath)) {
      // 嘗試從原始碼重新編譯生成 source map
      console.log(`🔍 未找到 Source Map (${mapPath})`);
      console.log("   提示: 使用 flow2code compile 搭配 --source-map 生成映射檔");
      process.exit(1);
    }

    try {
      const mapRaw = readFileSync(mapPath, "utf-8");
      const sourceMap: SourceMap = JSON.parse(mapRaw);

      const result = traceLineToNode(sourceMap, lineNum);
      if (result) {
        console.log(`🎯 第 ${lineNum} 行對應的節點:`);
        console.log(`   Node ID:    ${result.nodeId}`);
        console.log(`   行範圍:     ${result.startLine}-${result.endLine}`);
      } else {
        console.log(`❓ 第 ${lineNum} 行沒有對應到任何節點`);
        console.log("   可能是匯入語句或框架生成的程式碼");
      }
    } catch (err) {
      console.error(`❌ 解析 Source Map 失敗: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

// ============================================================
// diff 指令 — 語意化差異比較
// ============================================================

program
  .command("diff <before> <after>")
  .description("比較兩個 .flow.json 的語意化差異")
  .action((beforeFile: string, afterFile: string) => {
    const beforePath = resolve(beforeFile);
    const afterPath = resolve(afterFile);

    if (!existsSync(beforePath)) {
      console.error(`❌ 檔案不存在: ${beforePath}`);
      process.exit(1);
    }
    if (!existsSync(afterPath)) {
      console.error(`❌ 檔案不存在: ${afterPath}`);
      process.exit(1);
    }

    let beforeIR: FlowIR;
    let afterIR: FlowIR;
    try {
      beforeIR = JSON.parse(readFileSync(beforePath, "utf-8")) as FlowIR;
      afterIR = JSON.parse(readFileSync(afterPath, "utf-8")) as FlowIR;
    } catch {
      console.error("❌ JSON 解析失敗");
      process.exit(1);
    }

    const summary = semanticDiff(beforeIR, afterIR);
    console.log(formatDiff(summary));
  });

// ============================================================
// env-check 指令 — 環境變數驗證
// ============================================================

program
  .command("env-check <file>")
  .description("驗證 .flow.json 中引用的環境變數是否已宣告")
  .option("-e, --env <envFile>", "指定 .env 檔案路徑", ".env")
  .action((file: string, options: { env: string }) => {
    const filePath = resolve(file);
    const envPath = resolve(options.env);

    if (!existsSync(filePath)) {
      console.error(`❌ 檔案不存在: ${filePath}`);
      process.exit(1);
    }

    let ir: FlowIR;
    try {
      ir = JSON.parse(readFileSync(filePath, "utf-8")) as FlowIR;
    } catch {
      console.error("❌ JSON 解析失敗");
      process.exit(1);
    }

    // 嘗試載入 .env 檔案
    let declaredVars: string[] = [];
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, "utf-8");
      declaredVars = parseEnvFile(envContent);
    } else {
      // 也嘗試 .env.example
      const examplePath = resolve(".env.example");
      if (existsSync(examplePath)) {
        const envContent = readFileSync(examplePath, "utf-8");
        declaredVars = parseEnvFile(envContent);
        console.log(`ℹ️  未找到 ${options.env}，使用 .env.example 作為參考\n`);
      } else {
        console.log(`⚠️  未找到 .env 或 .env.example，將報告所有使用的環境變數\n`);
      }
    }

    const result = validateEnvVars(ir, declaredVars);
    console.log(formatEnvValidationReport(result));

    if (!result.valid) {
      process.exit(1);
    }
  });

// ============================================================
// dev 指令 — 啟動 standalone server
// ============================================================

async function startDevServer(options: { port: string; open: boolean }) {
  const port = parseInt(options.port, 10);
  // 動態 import — 僅在 dev/ui 指令時載入 server
  const { startServer } = await import("../server/index.js");

  startServer({
    port,
    onReady: (url) => {
      console.log(`\n  🚀 Flow2Code Dev Server`);
      console.log(`  ├─ Editor:  ${url}`);
      console.log(`  ├─ API:     ${url}/api/compile`);
      console.log(`  └─ Project: ${process.cwd()}\n`);

      if (options.open) {
        // 跨平台開啟瀏覽器
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
  .description("啟動 Flow2Code 視覺化編輯器 (standalone dev server)")
  .option("-p, --port <port>", "伺服器埠號", "3100")
  .option("--no-open", "不自動開啟瀏覽器")
  .action(startDevServer);

program
  .command("ui")
  .description("啟動 Flow2Code 視覺化編輯器 (dev 的別名)")
  .option("-p, --port <port>", "伺服器埠號", "3100")
  .option("--no-open", "不自動開啟瀏覽器")
  .action(startDevServer);

// ============================================================
// 輔助函式
// ============================================================

function compileFile(filePath: string, projectRoot: string): void {
  const startTime = Date.now();

  try {
    const raw = readFileSync(filePath, "utf-8");
    const ir = JSON.parse(raw) as FlowIR;

    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      console.error(`❌ [${filePath}] 驗證失敗:`);
      validation.errors.forEach((e) => console.error(`  ${e.message}`));
      return;
    }

    const result = compile(ir);
    if (!result.success) {
      console.error(`❌ [${filePath}] 編譯失敗:`);
      result.errors?.forEach((e) => console.error(`  ${e}`));
      return;
    }

    if (!result.code || !result.filePath) {
      console.error(`❌ [${filePath}] 編譯結果缺少 code 或 filePath`);
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
      `❌ [${filePath}] 錯誤: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** 從 YAML 目錄編譯 — 供 watch 使用 */
function compileFlowDir(dirPath: string, projectRoot: string): void {
  const startTime = Date.now();
  try {
    const project = loadFlowProject(dirPath);
    const ir = project.ir;

    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      console.error(`❌ [${dirPath}] 驗證失敗:`);
      validation.errors.forEach((e) => console.error(`  ${e.message}`));
      return;
    }

    const result = compile(ir);
    if (!result.success) {
      console.error(`❌ [${dirPath}] 編譯失敗:`);
      result.errors?.forEach((e) => console.error(`  ${e}`));
      return;
    }

    if (!result.code || !result.filePath) {
      console.error(`❌ [${dirPath}] 編譯結果缺少 code 或 filePath`);
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
      `❌ [${dirPath}] 錯誤: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function generateEnvExample(): void {
  const envExamplePath = resolve(".env.example");
  if (!existsSync(envExamplePath)) {
    writeFileSync(
      envExamplePath,
      "# Flow2Code 環境變數\n# 在此定義 API 金鑰與敏感資訊\n",
      "utf-8"
    );
    console.log("📝 已生成 .env.example");
  }
}

// ============================================================
// 執行
// ============================================================

program.parse();
