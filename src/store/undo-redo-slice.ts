/**
 * Zustand Undo/Redo Slice
 *
 * Independent history management slice, composable with any Zustand store.
 * Extracted from flow-store for single responsibility.
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
  /** Undo history stack */
  undoStack: TSnapshot[];
  /** Redo history stack */
  redoStack: TSnapshot[];

  /**
   * Push the current snapshot onto the undo stack.
   * Caller provides the snapshot factory.
   */
  pushSnapshot: (snapshot: TSnapshot) => void;

  /**
   * Undo — Pop from undoStack and push current state to redoStack
   * @param currentSnapshot - Caller-provided "current" snapshot
   * @returns Previous snapshot (if exists), or null
   */
  undo: (currentSnapshot: TSnapshot) => TSnapshot | null;

  /**
   * Redo — Pop from redoStack and push current state to undoStack
   * @param currentSnapshot - Caller-provided "current" snapshot
   * @returns Next snapshot (if exists), or null
   */
  redo: (currentSnapshot: TSnapshot) => TSnapshot | null;

  /** Whether undo is available */
  canUndo: () => boolean;
  /** Whether redo is available */
  canRedo: () => boolean;
  /** Clear all history */
  clearHistory: () => void;
}

// ============================================================
// Factory
// ============================================================

/**
 * Create Undo/Redo slice — generic Zustand slice factory
 *
 * @param maxHistory - Maximum history entries (default: 50)
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
