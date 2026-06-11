/**
 * Tiny dependency-free fuzzy matcher for the command palette.
 * Returns a score (higher = better) when every query char appears in `text` in
 * order, or null when there's no subsequence match. Bonuses for consecutive
 * matches and word-start matches so "npo" ranks "New PO" above "Open … no …".
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();

  let score = 0;
  let ti = 0;
  let lastMatch = -1;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    const found = t.indexOf(ch, ti);
    if (found === -1) return null;
    score += 1;
    if (found === lastMatch + 1) score += 4; // consecutive run
    const prev = found > 0 ? t[found - 1] : " ";
    if (prev === " " || prev === "-" || prev === "/") score += 3; // word start
    if (found === 0) score += 2;
    lastMatch = found;
    ti = found + 1;
  }
  // prefer shorter targets (tighter match) and exact substrings
  score += Math.max(0, 12 - text.length / 4);
  if (t.includes(q)) score += 8;
  return score;
}
