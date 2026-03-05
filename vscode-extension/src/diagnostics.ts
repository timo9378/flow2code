/**
 * Flow2Code Diagnostics Provider
 *
 * Validates .flow.json files and shows inline errors/warnings
 * using VS Code's built-in diagnostics system.
 */

import * as vscode from "vscode";
import { validateFlowIR } from "@/lib/ir/validator";
import type { FlowIR } from "@/lib/ir/types";

const DIAGNOSTIC_SOURCE = "Flow2Code";

export class FlowDiagnostics {
  private diagnosticCollection: vscode.DiagnosticCollection;
  private outputChannel: vscode.OutputChannel;

  constructor(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
  ) {
    this.diagnosticCollection =
      vscode.languages.createDiagnosticCollection("flow2code");
    this.outputChannel = outputChannel;

    context.subscriptions.push(this.diagnosticCollection);

    // Validate on open
    context.subscriptions.push(
      vscode.workspace.onDidOpenTextDocument((doc) => {
        if (this.isFlowJson(doc)) this.validateDocument(doc);
      })
    );

    // Validate on save
    context.subscriptions.push(
      vscode.workspace.onDidSaveTextDocument((doc) => {
        const config = vscode.workspace.getConfiguration("flow2code");
        if (config.get<boolean>("autoValidate", true) && this.isFlowJson(doc)) {
          this.validateDocument(doc);
        }

        // Auto-compile on save (if enabled)
        if (config.get<boolean>("compileOnSave", false) && this.isFlowJson(doc)) {
          vscode.commands.executeCommand("flow2code.compileToTS", doc.uri);
        }
      })
    );

    // Clear diagnostics when file is closed
    context.subscriptions.push(
      vscode.workspace.onDidCloseTextDocument((doc) => {
        if (this.isFlowJson(doc)) {
          this.diagnosticCollection.delete(doc.uri);
        }
      })
    );

    // Validate already-open documents
    for (const doc of vscode.workspace.textDocuments) {
      if (this.isFlowJson(doc)) this.validateDocument(doc);
    }
  }

  private isFlowJson(doc: vscode.TextDocument): boolean {
    return doc.fileName.endsWith(".flow.json");
  }

  private validateDocument(doc: vscode.TextDocument): void {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = doc.getText();

    // Check JSON parse
    let ir: FlowIR;
    try {
      ir = JSON.parse(text) as FlowIR;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid JSON";
      diagnostics.push(
        new vscode.Diagnostic(
          new vscode.Range(0, 0, 0, 1),
          `JSON parse error: ${msg}`,
          vscode.DiagnosticSeverity.Error
        )
      );
      this.diagnosticCollection.set(doc.uri, diagnostics);
      return;
    }

    // Validate FlowIR
    const result = validateFlowIR(ir);
    if (result.valid) {
      this.diagnosticCollection.set(doc.uri, []);
      return;
    }

    for (const error of result.errors) {
      // Try to locate the error in the JSON text
      const range = this.findRange(text, error);

      const severity =
        error.code === "ORPHAN_NODE"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Error;

      const diag = new vscode.Diagnostic(
        range,
        `[${error.code}] ${error.message}`,
        severity
      );
      diag.source = DIAGNOSTIC_SOURCE;
      diagnostics.push(diag);
    }

    this.diagnosticCollection.set(doc.uri, diagnostics);

    if (diagnostics.length > 0) {
      this.outputChannel.appendLine(
        `Validated ${doc.fileName}: ${diagnostics.length} issue(s)`
      );
    }
  }

  /**
   * Try to locate the validation error within the JSON text.
   * Looks for the relevant nodeId or edgeId string in the document.
   */
  private findRange(
    text: string,
    error: { nodeId?: string; edgeId?: string; message: string }
  ): vscode.Range {
    const searchId = error.nodeId ?? error.edgeId;
    if (searchId) {
      // Find the "id": "searchId" pattern in the JSON
      const pattern = `"id": "${searchId}"`;
      const idx = text.indexOf(pattern);
      if (idx !== -1) {
        const before = text.slice(0, idx);
        const line = before.split("\n").length - 1;
        const col = idx - before.lastIndexOf("\n") - 1;
        return new vscode.Range(line, col, line, col + pattern.length);
      }

      // Fallback: search for just the ID string
      const simpleIdx = text.indexOf(`"${searchId}"`);
      if (simpleIdx !== -1) {
        const before = text.slice(0, simpleIdx);
        const line = before.split("\n").length - 1;
        const col = simpleIdx - before.lastIndexOf("\n") - 1;
        return new vscode.Range(
          line,
          col,
          line,
          col + searchId.length + 2
        );
      }
    }

    // Default: first line
    return new vscode.Range(0, 0, 0, 1);
  }

  static register(
    context: vscode.ExtensionContext,
    outputChannel: vscode.OutputChannel
  ): FlowDiagnostics {
    return new FlowDiagnostics(context, outputChannel);
  }
}
