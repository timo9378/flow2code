/**
 * ExpressionInput — 帶有自動補全功能的表達式輸入框
 *
 * 用於替代 ConfigPanel 中的純 Textarea，
 * 提供 flowState 欄位、方法、內建變數的即時補全。
 */

"use client";

import { useState, useRef, useCallback, useEffect, type KeyboardEvent, type ChangeEvent } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  useExpressionSuggestions,
  type ExpressionSuggestion,
} from "@/hooks/use-expression-suggestions";

interface ExpressionInputProps {
  /** 節點 ID（用於推斷上游型別） */
  nodeId: string | null;
  /** 欄位標籤 */
  label: string;
  /** 當前值 */
  value: string;
  /** 值變更時回調 */
  onChange: (value: string) => void;
  /** Placeholder */
  placeholder?: string;
  /** 錯誤訊息 */
  error?: string;
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
}: ExpressionInputProps) {
  const { getFiltered } = useExpressionSuggestions(nodeId);

  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [filteredSuggestions, setFilteredSuggestions] = useState<ExpressionSuggestion[]>([]);
  const [popupPosition, setPopupPosition] = useState<PopupPosition>({ top: 0, left: 0 });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // ── 更新建議列表 ──
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

  // ── 插入選定的建議 ──
  const insertSuggestion = useCallback(
    (suggestion: ExpressionSuggestion) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const pos = textarea.selectionStart;
      const beforeCursor = value.slice(0, pos);

      // 找到要替換的 token
      const tokenMatch = /[\w$.'[\]]*$/.exec(beforeCursor);
      const tokenStart = tokenMatch ? pos - tokenMatch[0].length : pos;

      const newValue =
        value.slice(0, tokenStart) + suggestion.insertText + value.slice(pos);
      onChange(newValue);
      setShowSuggestions(false);

      // 將游標移到插入文字的末尾
      requestAnimationFrame(() => {
        const newPos = tokenStart + suggestion.insertText.length;
        textarea.setSelectionRange(newPos, newPos);
        textarea.focus();
      });
    },
    [value, onChange]
  );

  // ── 鍵盤導航 ──
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

  // ── 計算彈出位置 ──
  useEffect(() => {
    if (!showSuggestions || !textareaRef.current) return;
    const textarea = textareaRef.current;
    const rect = textarea.getBoundingClientRect();
    setPopupPosition({
      top: rect.height + 2, // 在 textarea 下方
      left: 0,
    });
  }, [showSuggestions]);

  // ── 點擊外部關閉 ──
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
