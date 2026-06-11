import type { QueryClient } from "@tanstack/react-query";

/**
 * Optimistic helpers for list queries (the app's standard cache shape: an array
 * of rows under a stable key like ["purchase_orders"]).
 *
 * Pattern in a mutation:
 *   onMutate: async (vars) => {
 *     await qc.cancelQueries({ queryKey: KEY });
 *     return { rollback: optimisticRemove<Row>(qc, KEY, (r) => r.id === vars.id) };
 *   },
 *   onError: (_e, _vars, ctx) => ctx?.rollback(),
 *   onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
 */

/** Apply an arbitrary update to a cached list and return a rollback fn. */
export function optimisticList<T>(
  qc: QueryClient,
  key: readonly unknown[],
  update: (cur: T[]) => T[],
): () => void {
  const previous = qc.getQueryData<T[]>(key);
  qc.setQueryData<T[]>(key, (cur) => update(cur ?? []));
  return () => qc.setQueryData<T[]>(key, previous);
}

/** Optimistically remove the rows matching `match`. */
export function optimisticRemove<T>(
  qc: QueryClient,
  key: readonly unknown[],
  match: (row: T) => boolean,
): () => void {
  return optimisticList<T>(qc, key, (cur) => cur.filter((r) => !match(r)));
}

/** Optimistically patch the rows matching `match`. */
export function optimisticPatch<T>(
  qc: QueryClient,
  key: readonly unknown[],
  match: (row: T) => boolean,
  patch: Partial<T>,
): () => void {
  return optimisticList<T>(qc, key, (cur) =>
    cur.map((r) => (match(r) ? { ...r, ...patch } : r)),
  );
}
