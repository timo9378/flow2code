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
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, dirname, resolve, extname } from "node:path";
import { watch } from "chokidar";
import { compile, traceLineToNode } from "../lib/compiler/compiler";
import type { SourceMap } from "../lib/compiler/compiler";
import { validateFlowIR } from "../lib/ir/validator";
import { splitToFileSystem, mergeFromFileSystem } from "../lib/storage/split-storage";
import type { FlowIR } from "../lib/ir/types";

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
  .description("編譯單一 .flow.json 檔案為 TypeScript")
  .option("-o, --output <path>", "指定輸出路徑（覆蓋自動偵測）")
  .option("--dry-run", "僅顯示生成的代碼，不寫入檔案")
  .option("--source-map", "生成 Source Map 映射檔 (.flow.map.json)")
  .action((file: string, options: { output?: string; dryRun?: boolean; sourceMap?: boolean }) => {
    const filePath = resolve(file);

    if (!existsSync(filePath)) {
      console.error(`❌ 檔案不存在: ${filePath}`);
      process.exit(1);
    }

    console.log(`📄 讀取: ${filePath}`);
    const raw = readFileSync(filePath, "utf-8");

    let ir: FlowIR;
    try {
      ir = JSON.parse(raw) as FlowIR;
    } catch {
      console.error("❌ JSON 解析失敗");
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
    const result = compile(ir);
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
    const outputPath = options.output ?? result.filePath!;
    const fullOutputPath = resolve(outputPath);
    const outputDir = dirname(fullOutputPath);

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(fullOutputPath, result.code!, "utf-8");
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
// watch 指令
// ============================================================

program
  .command("watch [dir]")
  .description("監聽目錄，自動編譯 .flow.json 檔案變動")
  .option("-p, --project <path>", "Next.js 專案根目錄", ".")
  .action((dir: string = ".", options: { project?: string }) => {
    const watchDir = resolve(dir);
    const projectRoot = resolve(options.project ?? ".");

    console.log(`👀 監聽中: ${watchDir}/**/*.flow.json`);
    console.log(`📁 輸出至: ${projectRoot}`);
    console.log("按 Ctrl+C 停止\n");

    const watcher = watch(join(watchDir, "**/*.flow.json"), {
      persistent: true,
      ignoreInitial: false,
    });

    watcher.on("change", (filePath) => compileFile(filePath, projectRoot));
    watcher.on("add", (filePath) => compileFile(filePath, projectRoot));

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
          inputs: [] as any[],
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
          outputs: [] as any[],
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

    const outputPath = join(projectRoot, result.filePath!);
    const outputDir = dirname(outputPath);

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(outputPath, result.code!, "utf-8");

    const elapsed = Date.now() - startTime;
    console.log(`✅ [${elapsed}ms] ${filePath} → ${outputPath}`);
  } catch (err) {
    console.error(
      `❌ [${filePath}] 錯誤: ${err instanceof Error ? err.message : String(err)}`
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
