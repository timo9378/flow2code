/**
 * Flow2Code VSCode Extension — Entry Point
 *
 * Features:
 *   - Right-click TS/JS → "Decompile to Flow IR"
 *   - Right-click .flow.json → "Compile to TypeScript"
 *   - Flow preview webview (DAG visualization)
 *   - Auto-validation diagnostics on save
 *   - FlowIR status bar info
 *   - Custom editor for .flow.json (visual preview)
 */

import * as vscode from "vscode";
import { registerCommands } from "./commands";
import { FlowDiagnostics } from "./diagnostics";
import { FlowStatusBar } from "./status-bar";
import { FlowEditorProvider } from "./flow-editor-provider";

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Flow2Code");
  outputChannel.appendLine("Flow2Code extension activated");

  registerCommands(context, outputChannel);
  FlowDiagnostics.register(context, outputChannel);
  FlowStatusBar.register(context);
  FlowEditorProvider.register(context);

  outputChannel.appendLine("All providers registered");
}

export function deactivate() {
  // Cleanup handled by disposables registered in context.subscriptions
}
