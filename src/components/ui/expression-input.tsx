/**
 * ExpressionInput — Expression input with Monaco Editor + autocomplete
 *
 * Provides real-time autocomplete for flowState fields, methods, and built-in variables.
 * Uses Monaco Editor for syntax highlighting and inline diagnostics when available,
 * falls back to plain Textarea when Monaco cannot load.
 */

"use client";

import { useState, useRef, useCallback, useEffect, lazy, Suspense, type KeyboardEvent, type ChangeEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  useExpressionSuggestions,
  type ExpressionSuggestion,
} from "@/hooks/use-expression-suggestions";

// Lazy-load Monaco — falls back to textarea if it can't load
const MonacoEditor = lazy(() =>
  import("@monaco-editor/react").then((mod) => ({ default: mod.default }))
);

interface ExpressionInputProps {
  /** Node ID (for inferring upstream types) */
  nodeId: string | null;
  /** Field label */
  label: string;
  /** Current value */
  value: string;
  /** Callback when value changes */
  onChange: (value: string) => void;
  /** Placeholder */
  placeholder?: string;
  /** Error message */
  error?: string;
  /** Use Monaco Editor (default: true). Falls back to textarea on SSR or load failure. */
  useMonaco?: boolean;
}

interface PopupPosition {
  top: number;
  left: number;
}

export default function ExpressionInput({
  nodeId,
  label,
  value,
  onChange,
  placeholder,
  error,
  useMonaco: enableMonaco = true,
}: ExpressionInputProps) {
  const { getFiltered } = useExpressionSuggestions(nodeId);
  const [monacoFailed, setMonacoFailed] = useState(false);

  // Determine if we should render Monaco
  const showMonaco = enableMonaco && !monacoFailed && typeof window !== "undefined";

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filteredSuggestions, setFilteredSuggestions] = useState<ExpressionSuggestion[]>([]);
  const [popupPosition, setPopupPosition] = useState<PopupPosition>({ top: 0, left: 0 });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // ── Update suggestion list ──
  const updateSuggestions = useCallback(
    (inputValue: string, cursorPos?: number) => {
      const filtered = getFiltered(inputValue, cursorPos);
      setFilteredSuggestions(filtered);
      setSelectedIndex(0);
      setShowSuggestions(filtered.length > 0);
    },
    [getFiltered]
  );

  // ── Handle Input Change ──
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const newValue = e.target.value;
      onChange(newValue);
      updateSuggestions(newValue, e.target.selectionStart ?? undefined);
    },
    [onChange, updateSuggestions]
  );

  // ── Insert selected suggestion ──
  const insertSuggestion = useCallback(
    (suggestion: ExpressionSuggestion) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const pos = textarea.selectionStart;
      const beforeCursor = value.slice(0, pos);

      // Find the token to replace
      const tokenMatch = /[\w$.'[\]]*$/.exec(beforeCursor);
      const tokenStart = tokenMatch ? pos - tokenMatch[0].length : pos;

      const newValue =
        value.slice(0, tokenStart) + suggestion.insertText + value.slice(pos);
      onChange(newValue);
      setShowSuggestions(false);

      // Move cursor to end of inserted text
      requestAnimationFrame(() => {
        const newPos = tokenStart + suggestion.insertText.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      });
    },
    [value, onChange]
  );

  // ── Keyboard Navigation ──
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!showSuggestions || filteredSuggestions.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => (i + 1) % filteredSuggestions.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) =>
            i <= 0 ? filteredSuggestions.length - 1 : i - 1
          );
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          insertSuggestion(filteredSuggestions[selectedIndex]);
          break;
        case "Escape":
          e.preventDefault();
          setShowSuggestions(false);
          break;
      }
    },
    [showSuggestions, filteredSuggestions, selectedIndex, insertSuggestion]
  );

  // ── Calculate popup position ──
  useEffect(() => {
    if (!showSuggestions || !textareaRef.current) return;
    const textarea = textareaRef.current;
    const rect = textarea.getBoundingClientRect();
    setPopupPosition({
      top: rect.height + 2, // Below the textarea
      left: 0,
    });
  }, [showSuggestions]);

  // ── Close on outside click ──
  useEffect(() => {
    if (!showSuggestions) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popupRef.current &&
        !popupRef.current.contains(e.target as Node) &&
        textareaRef.current &&
        !textareaRef.current.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showSuggestions]);

  const kindIcon: Record<ExpressionSuggestion["kind"], string> = {
    variable: "𝑥",
    method: "ƒ",
    keyword: "$",
    snippet: "⟨⟩",
  };

  // ── Monaco Editor Mode ──
  if (showMonaco) {
    return (
      <div className="flex flex-col gap-1.5 relative">
        <Label className="text-[10px] uppercase tracking-wider">{label}</Label>
        <div
          className={`rounded-md border ${error ? "border-red-500" : "border-border"} overflow-hidden`}
          style={{ minHeight: 60 }}
        >
          <Suspense
            fallback={
              <Textarea
                value={String(value)}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="font-mono text-xs resize-y min-h-[60px]"
                autoComplete="off"
                spellCheck={false}
              />
            }
          >
            <MonacoEditorWrapper
              value={value}
              onChange={onChange}
              suggestions={getFiltered}
              onError={() => setMonacoFailed(true)}
            />
          </Suspense>
        </div>
        {error && <p className="text-[10px] text-red-400">{error}</p>}
      </div>
    );
  }

  // ── Fallback: Textarea Mode ──
  return (
    <div className="flex flex-col gap-1.5 relative">
      <Label className="text-[10px] uppercase tracking-wider">{label}</Label>
      <Textarea
        ref={textareaRef}
        value={String(value)}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          // Delay to allow click on suggestion
          setTimeout(() => setShowSuggestions(false), 150);
        }}
        onFocus={() => updateSuggestions(String(value))}
        placeholder={placeholder}
        className={`font-mono text-xs resize-y min-h-[60px] ${error ? "border-red-500" : ""}`}
        autoComplete="off"
        spellCheck={false}
      />

      {showSuggestions && filteredSuggestions.length > 0 && (
        <div
          ref={popupRef}
          className="absolute z-50 border border-border bg-popover rounded-md shadow-lg max-h-48 overflow-y-auto w-full"
          style={{
            top: popupPosition.top,
            left: popupPosition.left,
          }}
        >
          {filteredSuggestions.slice(0, 15).map((suggestion, index) => (
            <div
              key={suggestion.label}
              className={`flex items-center gap-2 px-2 py-1 cursor-pointer text-xs ${
                index === selectedIndex
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-accent/50"
              }`}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent textarea blur
                insertSuggestion(suggestion);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <span className="text-muted-foreground font-mono text-[10px] w-4 shrink-0 text-center">
                {kindIcon[suggestion.kind]}
              </span>
              <span className="font-mono text-xs truncate">{suggestion.label}</span>
              <span className="text-[10px] text-muted-foreground ml-auto truncate max-w-[120px]">
                {suggestion.description}
              </span>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-[10px] text-red-400">{error}</p>}
    </div>
  );
}

// ============================================================
// Monaco Editor Wrapper (lazy-loaded)
// ============================================================

interface MonacoEditorWrapperProps {
  value: string;
  onChange: (value: string) => void;
  suggestions: (input: string, cursor?: number) => ExpressionSuggestion[];
  onError: () => void;
}

function MonacoEditorWrapper({ value, onChange, suggestions, onError }: MonacoEditorWrapperProps) {
  const editorRef = useRef<unknown>(null);

  const handleMount = useCallback(
    (editor: unknown, monaco: unknown) => {
      editorRef.current = editor;
      try {
        const m = monaco as {
          languages: {
            typescript: {
              typescriptDefaults: {
                setDiagnosticsOptions: (opts: Record<string, boolean>) => void;
              };
            };
            registerCompletionItemProvider: (
              lang: string,
              provider: Record<string, unknown>
            ) => void;
          };
          Range: new (
            sl: number, sc: number, el: number, ec: number
          ) => unknown;
        };
        // Suppress type-checker noise for short expressions
        m.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
          noSemanticValidation: true,
          noSyntaxValidation: false,
        });
        // Register custom completion provider
        m.languages.registerCompletionItemProvider("typescript", {
          provideCompletionItems: (model: { getValueInRange: (r: unknown) => string }, position: { lineNumber: number; column: number }) => {
            const textUntilPosition = model.getValueInRange(
              new m.Range(1, 1, position.lineNumber, position.column)
            );
            const items = suggestions(textUntilPosition, textUntilPosition.length);
            return {
              suggestions: items.map((s) => ({
                label: s.label,
                kind: 5, // Field
                insertText: s.insertText,
                detail: s.description,
              })),
            };
          },
        });
      } catch {
        // Ignore — basic editing still works
      }
    },
    [suggestions]
  );

  return (
    <ErrorBoundaryMonaco onError={onError}>
      <MonacoEditor
        height="60px"
        language="typescript"
        theme="vs-dark"
        value={String(value)}
        onChange={(v) => onChange(v ?? "")}
        onMount={handleMount}
        options={{
          minimap: { enabled: false },
          lineNumbers: "off",
          scrollBeyondLastLine: false,
          fontSize: 12,
          fontFamily: "monospace",
          wordWrap: "on",
          glyphMargin: false,
          folding: false,
          renderLineHighlight: "none",
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          scrollbar: { vertical: "hidden", horizontal: "auto" },
          padding: { top: 4, bottom: 4 },
          tabSize: 2,
        }}
      />
    </ErrorBoundaryMonaco>
  );
}

// Simple error boundary for Monaco load failures
import { Component, type ReactNode, type ErrorInfo } from "react";

class ErrorBoundaryMonaco extends Component<
  { children: ReactNode; onError: () => void },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; onError: () => void }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onError();
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
