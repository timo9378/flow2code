/**
 * Flow2Code Custom Editor Provider
 *
 * Provides a read-only visual editor for .flow.json files.
 * Users can choose "Open With... > Flow2Code Visual Editor"
 * to see the flow graph instead of raw JSON.
 */

import * as vscode from "vscode";
import type { FlowIR } from "@/lib/ir/types";
import { getPreviewHtml } from "./webview/preview-html";

export class FlowEditorProvider implements vscode.CustomTextEditorProvider {
  private static readonly viewType = "flow2code.flowEditor";

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
    };

    // Initial render
    this.updateWebview(document, webviewPanel);

    // Update on document changes
    const changeSubscription = vscode.workspace.onDidChangeTextDocument(
      (e) => {
        if (e.document.uri.toString() === document.uri.toString()) {
          this.updateWebview(document, webviewPanel);
        }
      }
    );

    webviewPanel.onDidDispose(() => {
      changeSubscription.dispose();
    });
  }

  private updateWebview(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel
  ): void {
    try {
      const ir = JSON.parse(document.getText()) as FlowIR;
      panel.webview.html = getPreviewHtml(ir, panel.webview, this.context);
    } catch {
      panel.webview.html = `<!DOCTYPE html>
<html><body style="background:#1e1e1e;color:#ccc;font-family:sans-serif;padding:40px;">
  <h2>⚠️ Invalid Flow IR</h2>
  <p>The document could not be parsed as valid JSON.</p>
  <p style="opacity:0.6">Fix the JSON syntax and this view will auto-refresh.</p>
</body></html>`;
    }
  }

  static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new FlowEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(
      FlowEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    );
  }
}
