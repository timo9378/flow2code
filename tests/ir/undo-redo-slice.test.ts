/**
 * Undo/Redo Slice Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { create } from "zustand";
import { createUndoRedoSlice, type UndoRedoSlice } from "../../src/store/undo-redo-slice";

// 簡單測試 snapshot 型別
type TestSnapshot = { value: number };

function createTestStore(maxHistory = 50) {
  return create<UndoRedoSlice<TestSnapshot>>(createUndoRedoSlice<TestSnapshot>(maxHistory));
}

describe("UndoRedoSlice", () => {
  let store: ReturnType<typeof createTestStore>;

  beforeEach(() => {
    store = createTestStore();
  });

  it("should start with empty stacks", () => {
    const state = store.getState();
    expect(state.undoStack).toHaveLength(0);
    expect(state.redoStack).toHaveLength(0);
    expect(state.canUndo()).toBe(false);
    expect(state.canRedo()).toBe(false);
  });

  it("should push snapshot to undo stack", () => {
    store.getState().pushSnapshot({ value: 1 });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().canUndo()).toBe(true);
  });

  it("should clear redo stack on push", () => {
    // Simulate: push → undo → push (redo should be cleared)
    store.getState().pushSnapshot({ value: 1 });
    store.getState().undo({ value: 2 });
    expect(store.getState().canRedo()).toBe(true);
    
    store.getState().pushSnapshot({ value: 3 });
    expect(store.getState().canRedo()).toBe(false);
    expect(store.getState().redoStack).toHaveLength(0);
  });

  it("should undo and return previous snapshot", () => {
    store.getState().pushSnapshot({ value: 10 });
    store.getState().pushSnapshot({ value: 20 });

    const result = store.getState().undo({ value: 30 });
    expect(result).toEqual({ value: 20 });
    expect(store.getState().undoStack).toHaveLength(1);
    expect(store.getState().redoStack).toHaveLength(1);
    expect(store.getState().redoStack[0]).toEqual({ value: 30 });
  });

  it("should return null on undo with empty stack", () => {
    const result = store.getState().undo({ value: 1 });
    expect(result).toBeNull();
  });

  it("should redo and return next snapshot", () => {
    store.getState().pushSnapshot({ value: 10 });
    store.getState().undo({ value: 20 });

    const result = store.getState().redo({ value: 30 });
    expect(result).toEqual({ value: 20 });
    expect(store.getState().redoStack).toHaveLength(0);
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it("should return null on redo with empty stack", () => {
    const result = store.getState().redo({ value: 1 });
    expect(result).toBeNull();
  });

  it("should respect maxHistory limit", () => {
    const limitedStore = createTestStore(3);

    for (let i = 1; i <= 5; i++) {
      limitedStore.getState().pushSnapshot({ value: i });
    }

    expect(limitedStore.getState().undoStack).toHaveLength(3);
    // 最老的（1, 2）被移除，保留 3, 4, 5
    expect(limitedStore.getState().undoStack[0]).toEqual({ value: 3 });
    expect(limitedStore.getState().undoStack[2]).toEqual({ value: 5 });
  });

  it("should clear all history", () => {
    store.getState().pushSnapshot({ value: 1 });
    store.getState().pushSnapshot({ value: 2 });
    store.getState().undo({ value: 3 });

    store.getState().clearHistory();
    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().redoStack).toHaveLength(0);
    expect(store.getState().canUndo()).toBe(false);
    expect(store.getState().canRedo()).toBe(false);
  });

  it("should support full undo→redo roundtrip", () => {
    store.getState().pushSnapshot({ value: 1 }); // undo:[1]
    store.getState().pushSnapshot({ value: 2 }); // undo:[1,2]

    // Undo: current=3 → returns 2
    const prev = store.getState().undo({ value: 3 });
    expect(prev).toEqual({ value: 2 });

    // Redo: current=2 → returns 3
    const next = store.getState().redo({ value: 2 });
    expect(next).toEqual({ value: 3 });
  });

  it("should support multiple consecutive undos", () => {
    store.getState().pushSnapshot({ value: 1 });
    store.getState().pushSnapshot({ value: 2 });
    store.getState().pushSnapshot({ value: 3 });

    // 3 undos
    const r1 = store.getState().undo({ value: 40 });
    expect(r1).toEqual({ value: 3 });

    const r2 = store.getState().undo({ value: 30 });
    expect(r2).toEqual({ value: 2 });

    const r3 = store.getState().undo({ value: 20 });
    expect(r3).toEqual({ value: 1 });

    const r4 = store.getState().undo({ value: 10 });
    expect(r4).toBeNull(); // stack empty

    // 3 items in redo stack
    expect(store.getState().redoStack).toHaveLength(3);
  });
});
