/**
 * Flow2Code Commands
 *
 * Implements all user-facing commands:
 *   - decompileToFlow: TS file → .flow.json
 *   - decompileSelectionToFlow: selected code → .flow.json
 *   - compileToTS: .flow.json → .ts
 *   - validateIR: validate .flow.json
 *   - previewFlow: open DAG visualization webview
 */

import * as vscode from "vscode";
import * as path from "path";
import { compile } from "@/lib/compiler/compiler";
import { decompile } from "@/lib/compiler/decompiler";
import { validateFlowIR } from "@/lib/ir/validator";
import type { FlowIR } from "@/lib/ir/types";
import type { PlatformName } from "@/lib/compiler/platforms/types";
import { getPreviewHtml } from "./webview/preview-html";

export function registerCommands(
  context: vscode.ExtensionContext,
  outputChannel: vscode.OutputChannel
) {
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "flow2code.decompileToFlow",
      (uri?: vscode.Uri) => decompileToFlow(uri, outputChannel)
    ),
    vscode.commands.registerCommand(
      "flow2code.decompileSelectionToFlow",
      () => decompileSelectionToFlow(outputChannel)
    ),
    vscode.commands.registerCommand(
      "flow2code.compileToTS",
      (uri?: vscode.Uri) => compileToTS(uri, outputChannel)
    ),
    vscode.commands.registerCommand(
      "flow2code.validateIR",
      (uri?: vscode.Uri) => validateIR(uri, outputChannel)
    ),
    vscode.commands.registerCommand(
      "flow2code.previewFlow",
      (uri?: vscode.Uri) => previewFlow(uri, context)
    )
  );
}

// ── Decompile Entire File ──

async function decompileToFlow(
  uri: vscode.Uri | undefined,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  // Determine source: from explorer context menu (uri) or active editor
  let code: string;
  let fileName: string;

  if (uri) {
    const content = await vscode.workspace.fs.readFile(uri);
    code = Buffer.from(content).toString("utf-8");
    fileName = path.basename(uri.fsPath);
  } else {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage("No active editor");
      return;
    }
    code = editor.document.getText();
    fileName = path.basename(editor.document.fileName);
  }

  if (!code.trim()) {
    vscode.window.showWarningMessage("File is empty");
    return;
  }

  await runDecompile(code, fileName, uri?.fsPath, outputChannel);
}

// ── Decompile Selection ──

async function decompileSelectionToFlow(
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage("No active editor");
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage("No code selected");
    return;
  }

  const code = editor.document.getText(selection);
  const fileName = path.basename(editor.document.fileName);

  await runDecompile(code, fileName, editor.document.fileName, outputChannel);
}

// ── Shared Decompile Logic ──

async function runDecompile(
  code: string,
  fileName: string,
  sourcePath: string | undefined,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  try {
    outputChannel.appendLine(`\n── Decompiling ${fileName} ──`);

    const result = decompile(code, { fileName });

    if (!result.success || !result.ir) {
      const errors = result.errors?.join("\n") ?? "Unknown error";
      outputChannel.appendLine(`❌ Decompile failed:\n${errors}`);
      vscode.window.showErrorMessage(
        `Decompilation failed: ${result.errors?.[0] ?? "Unknown error"}`
      );
      return;
    }

    const ir = result.ir;
    const confidence = Math.round((result.confidence ?? 0) * 100);

    outputChannel.appendLine(
      `✅ ${ir.nodes.length} nodes, ${ir.edges.length} edges (${confidence}% confidence)`
    );

    // Log audit hints
    if (result.audit?.length) {
      outputChannel.appendLine("Audit hints:");
      for (const hint of result.audit) {
        outputChannel.appendLine(
          `  [${hint.severity}] ${hint.message} (${hint.nodeId})`
        );
      }
    }

    // Determine output path
    const sourceDir = sourcePath
      ? path.dirname(sourcePath)
      : vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    const baseName = path.basename(
      fileName,
      path.extname(fileName)
    );
    const outputPath = path.join(sourceDir, `${baseName}.flow.json`);

    // Check if file exists
    const outputUri = vscode.Uri.file(outputPath);
    let shouldWrite = true;
    try {
      await vscode.workspace.fs.stat(outputUri);
      const overwrite = await vscode.window.showWarningMessage(
        `${baseName}.flow.json already exists. Overwrite?`,
        "Overwrite",
        "Cancel"
      );
      if (overwrite !== "Overwrite") shouldWrite = false;
    } catch {
      // File doesn't exist — ok to create
    }

    if (!shouldWrite) return;

    const json = JSON.stringify(ir, null, 2);
    await vscode.workspace.fs.writeFile(
      outputUri,
      Buffer.from(json, "utf-8")
    );

    // Open the generated file side-by-side
    const doc = await vscode.workspace.openTextDocument(outputUri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });

    vscode.window.showInformationMessage(
      `✅ Decompiled to Flow IR (${confidence}% confidence) — ${ir.nodes.length} nodes`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`❌ Decompile error: ${msg}`);
    vscode.window.showErrorMessage(`Decompile error: ${msg}`);
  }
}

// ── Compile Flow IR → TypeScript ──

async function compileToTS(
  uri: vscode.Uri | undefined,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!fileUri) {
    vscode.window.showWarningMessage("No .flow.json file selected");
    return;
  }

  try {
    outputChannel.appendLine(
      `\n── Compiling ${path.basename(fileUri.fsPath)} ──`
    );

    // Read & parse
    const content = await vscode.workspace.fs.readFile(fileUri);
    const ir = JSON.parse(Buffer.from(content).toString("utf-8")) as FlowIR;

    // Validate
    const validation = validateFlowIR(ir);
    if (!validation.valid) {
      const errSummary = validation.errors
        .slice(0, 3)
        .map((e) => `[${e.code}] ${e.message}`)
        .join("\n");
      const proceed = await vscode.window.showWarningMessage(
        `Flow IR has ${validation.errors.length} validation error(s):\n${errSummary}\n\nCompile anyway?`,
        "Compile Anyway",
        "Cancel"
      );
      if (proceed !== "Compile Anyway") return;
    }

    // Get platform from settings
    const config = vscode.workspace.getConfiguration("flow2code");
    const platform = config.get<string>("platform", "nextjs") as PlatformName;

    // Compile
    const workingIR = validation.migratedIR ?? ir;
    const result = compile(workingIR, { platform });

    if (!result.success || !result.code) {
      const errors = result.errors?.join("\n") ?? "Unknown error";
      outputChannel.appendLine(`❌ Compile failed:\n${errors}`);
      vscode.window.showErrorMessage(
        `Compilation failed: ${result.errors?.[0] ?? "Unknown error"}`
      );
      return;
    }

    // Determine output path
    const sourceDir = path.dirname(fileUri.fsPath);
    const baseName = path.basename(fileUri.fsPath).replace(/\.flow\.json$/, "");
    const outputPath = path.join(sourceDir, result.filePath ?? `${baseName}.ts`);

    // Write compiled file
    const outputUri = vscode.Uri.file(outputPath);
    await vscode.workspace.fs.writeFile(
      outputUri,
      Buffer.from(result.code, "utf-8")
    );

    // Open side-by-side
    const doc = await vscode.workspace.openTextDocument(outputUri);
    await vscode.window.showTextDocument(doc, {
      viewColumn: vscode.ViewColumn.Beside,
      preview: true,
    });

    outputChannel.appendLine(`✅ Compiled to ${outputPath}`);

    let msg = `✅ Compiled to ${path.basename(outputPath)}`;
    if (result.dependencies?.missing?.length) {
      msg += ` | ⚠️ Missing: ${result.dependencies.missing.join(", ")}`;
      outputChannel.appendLine(
        `⚠️ Missing packages: ${result.dependencies.missing.join(", ")}`
      );
      outputChannel.appendLine(
        `  Run: ${result.dependencies.installCommand ?? "npm install " + result.dependencies.missing.join(" ")}`
      );
    }
    vscode.window.showInformationMessage(msg);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    outputChannel.appendLine(`❌ Compile error: ${msg}`);
    vscode.window.showErrorMessage(`Compile error: ${msg}`);
  }
}

// ── Validate Flow IR ──

async function validateIR(
  uri: vscode.Uri | undefined,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!fileUri) {
    vscode.window.showWarningMessage("No .flow.json file selected");
    return;
  }

  try {
    const content = await vscode.workspace.fs.readFile(fileUri);
    const ir = JSON.parse(Buffer.from(content).toString("utf-8")) as FlowIR;

    const result = validateFlowIR(ir);

    if (result.valid) {
      vscode.window.showInformationMessage(
        `✅ Flow IR is valid (${ir.nodes.length} nodes, ${ir.edges.length} edges)`
      );
    } else {
      const errors = result.errors
        .map((e) => `[${e.code}] ${e.message}`)
        .join("\n");
      outputChannel.appendLine(
        `\n── Validation: ${path.basename(fileUri.fsPath)} ──\n${errors}`
      );
      outputChannel.show();
      vscode.window.showErrorMessage(
        `❌ ${result.errors.length} validation error(s) — see Output panel`
      );
    }
  } catch (err) {
    vscode.window.showErrorMessage(
      `Validate error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ── Preview Flow Graph ──

async function previewFlow(
  uri: vscode.Uri | undefined,
  context: vscode.ExtensionContext
): Promise<void> {
  const fileUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!fileUri) {
    vscode.window.showWarningMessage("No .flow.json file selected");
    return;
  }

  try {
    const content = await vscode.workspace.fs.readFile(fileUri);
    const ir = JSON.parse(Buffer.from(content).toString("utf-8")) as FlowIR;
    const fileName = path.basename(fileUri.fsPath);

    const panel = vscode.window.createWebviewPanel(
      "flow2code.preview",
      `Flow: ${ir.meta?.name ?? fileName}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    panel.webview.html = getPreviewHtml(ir, panel.webview, context);

    // Watch for file changes and update preview
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(
        vscode.Uri.file(path.dirname(fileUri.fsPath)),
        path.basename(fileUri.fsPath)
      )
    );

    watcher.onDidChange(async () => {
      try {
        const updated = await vscode.workspace.fs.readFile(fileUri);
        const updatedIR = JSON.parse(
          Buffer.from(updated).toString("utf-8")
        ) as FlowIR;
        panel.webview.html = getPreviewHtml(updatedIR, panel.webview, context);
      } catch {
        // Ignore parse errors during editing
      }
    });

    panel.onDidDispose(() => watcher.dispose());
  } catch (err) {
    vscode.window.showErrorMessage(
      `Preview error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
