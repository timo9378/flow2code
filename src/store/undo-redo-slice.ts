/**
 * Zustand Undo/Redo Slice
 *
 * 獨立的歷史管理 slice，可與任何 Zustand store 組合使用。
 * 從 flow-store 中提取，職責單一化。
 *
 * @example
 * ```ts
 * import { createUndoRedoSlice, type UndoRedoSlice } from "@/store/undo-redo-slice";
 *
 * const useStore = create<MyState & UndoRedoSlice<Snapshot>>()((...a) => ({
 *   ...mySlice(...a),
 *   ...createUndoRedoSlice<Snapshot>(50)(...a),
 * }));
 * ```
 */

import type { StateCreator } from "zustand";

// ============================================================
// Types
// ============================================================

export interface UndoRedoSlice<TSnapshot> {
  /** Undo 歷史堆疊 */
  undoStack: TSnapshot[];
  /** Redo 歷史堆疊 */
  redoStack: TSnapshot[];

  /**
   * 將當前快照推入 undo 堆疊。
   * 呼叫者需提供 snapshot factory。
   */
  pushSnapshot: (snapshot: TSnapshot) => void;

  /**
   * 復原（Undo）— 從 undoStack pop 並將當前狀態 push 至 redoStack
   * @param currentSnapshot - 呼叫者提供的「當前」快照
   * @returns 前一個快照 (若存在)，或 null
   */
  undo: (currentSnapshot: TSnapshot) => TSnapshot | null;

  /**
   * 重做（Redo）— 從 redoStack pop 並將當前狀態 push 至 undoStack
   * @param currentSnapshot - 呼叫者提供的「當前」快照
   * @returns 下一個快照 (若存在)，或 null
   */
  redo: (currentSnapshot: TSnapshot) => TSnapshot | null;

  /** 是否可復原 */
  canUndo: () => boolean;
  /** 是否可重做 */
  canRedo: () => boolean;
  /** 清除所有歷史 */
  clearHistory: () => void;
}

// ============================================================
// Factory
// ============================================================

/**
 * 建立 Undo/Redo slice — 通用 Zustand slice factory
 *
 * @param maxHistory - 最大歷史記錄數 (預設 50)
 * @returns Zustand StateCreator slice
 */
export function createUndoRedoSlice<TSnapshot>(
  maxHistory = 50
): StateCreator<UndoRedoSlice<TSnapshot>, [], [], UndoRedoSlice<TSnapshot>> {
  return (set, get) => ({
    undoStack: [],
    redoStack: [],

    pushSnapshot: (snapshot: TSnapshot) => {
      const newStack = [...get().undoStack, snapshot];
      if (newStack.length > maxHistory) newStack.shift();
      set({ undoStack: newStack, redoStack: [] } as Partial<UndoRedoSlice<TSnapshot>>);
    },

    undo: (currentSnapshot: TSnapshot): TSnapshot | null => {
      const { undoStack } = get();
      if (undoStack.length === 0) return null;

      const prev = undoStack[undoStack.length - 1];
      set({
        undoStack: undoStack.slice(0, -1),
        redoStack: [...get().redoStack, currentSnapshot],
      } as Partial<UndoRedoSlice<TSnapshot>>);

      return prev;
    },

    redo: (currentSnapshot: TSnapshot): TSnapshot | null => {
      const { redoStack } = get();
      if (redoStack.length === 0) return null;

      const next = redoStack[redoStack.length - 1];
      set({
        redoStack: redoStack.slice(0, -1),
        undoStack: [...get().undoStack, currentSnapshot],
      } as Partial<UndoRedoSlice<TSnapshot>>);

      return next;
    },

    canUndo: () => get().undoStack.length > 0,
    canRedo: () => get().redoStack.length > 0,

    clearHistory: () => {
      set({ undoStack: [], redoStack: [] } as Partial<UndoRedoSlice<TSnapshot>>);
    },
  });
}
