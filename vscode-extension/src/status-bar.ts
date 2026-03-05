/**
 * Flow2Code Status Bar
 *
 * Shows flow info in the VS Code status bar when a .flow.json file is active.
 */

import * as vscode from "vscode";
import type { FlowIR } from "@/lib/ir/types";

export class FlowStatusBar {
  private statusBarItem: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100
    );
    this.statusBarItem.command = "flow2code.previewFlow";
    context.subscriptions.push(this.statusBarItem);

    // Update on active editor change
    context.subscriptions.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.update())
    );

    // Update on document changes
    context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (
          vscode.window.activeTextEditor?.document === e.document &&
          e.document.fileName.endsWith(".flow.json")
        ) {
          this.update();
        }
      })
    );

    // Initial update
    this.update();
  }

  private update(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !editor.document.fileName.endsWith(".flow.json")) {
      this.statusBarItem.hide();
      return;
    }

    try {
      const text = editor.document.getText();
      const ir = JSON.parse(text) as FlowIR;
      const name = ir.meta?.name ?? "Untitled";
      const nodes = ir.nodes?.length ?? 0;
      const edges = ir.edges?.length ?? 0;

      this.statusBarItem.text = `$(graph) ${name} (${nodes}N·${edges}E)`;
      this.statusBarItem.tooltip = `Flow2Code: ${name}\n${nodes} nodes, ${edges} edges\nClick to preview`;
      this.statusBarItem.show();
    } catch {
      this.statusBarItem.text = "$(graph) Flow2Code";
      this.statusBarItem.tooltip = "Flow2Code (invalid JSON)";
      this.statusBarItem.show();
    }
  }

  static register(context: vscode.ExtensionContext): FlowStatusBar {
    return new FlowStatusBar(context);
  }
}
