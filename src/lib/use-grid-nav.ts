"use client";

import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";

/**
 * Spreadsheet keyboard navigation for the repeating data grids (PO colour breakdown,
 * program-card design rows, fabric-receipt lines).
 *
 *   Tab          → next cell across the row (native; nothing to implement)
 *   Enter        → same column, one row DOWN
 *   Shift+Enter  → same column, one row UP
 *   Enter on the last row → appends a row and lands in it, when `onAppendRow` is given
 *
 * These grids are typed in bulk from a paper card, so the down-column path has to be the
 * fast one — Excel semantics, because that is what operators are coming from.
 *
 * ⚠️ Intercepting Enter is REQUIRED, not a nicety. Every one of these grids lives inside a
 * <form>, and a single-line input in a form submits it on Enter — so without this, Enter
 * mid-grid fires the form's primary action on a half-filled row.
 *
 * Focus moves by element id rather than a ref array: rows are added and removed freely, so
 * a positional ref list goes stale exactly when it is needed. Pass the same `cellId` to the
 * inputs' `id` and to this hook.
 */
export function useGridNav<F extends string>({
  cellId,
  rowCount,
  onAppendRow,
}: {
  /** Must produce the SAME id string that the input at (field, row) carries. */
  cellId: (field: F, row: number) => string;
  rowCount: number;
  /** Omit on fixed-size grids — Enter on the last row then simply stays put. */
  onAppendRow?: () => void;
}) {
  /** A row can't be focused until React has rendered it, so the target waits here. */
  const pendingFocus = useRef<{ field: F; row: number } | null>(null);

  const focusCell = (field: F, row: number) => {
    const el = document.getElementById(cellId(field, row));
    if (el instanceof HTMLInputElement) {
      el.focus();
      el.select();
    }
  };

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    pendingFocus.current = null;
    focusCell(target.field, target.row);
    // Runs when a row is appended; focusCell/cellId are stable for the caller's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowCount]);

  const onCellKeyDown =
    (field: F, i: number) => (e: ReactKeyboardEvent<HTMLInputElement>) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      if (e.shiftKey) {
        if (i > 0) focusCell(field, i - 1);
        return;
      }
      if (i < rowCount - 1) {
        focusCell(field, i + 1);
        return;
      }
      if (!onAppendRow) return;
      onAppendRow();
      pendingFocus.current = { field, row: i + 1 };
    };

  return { onCellKeyDown, focusCell };
}

/** The hint shown under a grid so the shortcuts are discoverable. */
export const GRID_NAV_HINT = "Tab moves across · Enter moves down";
export const GRID_NAV_HINT_GROWS = "Tab moves across · Enter moves down · Enter on the last row adds one";
