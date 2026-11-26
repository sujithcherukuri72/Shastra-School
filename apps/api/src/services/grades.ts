/** CBSE-style 8-point grading on percentage. */
const BANDS: [number, string][] = [
  [91, 'A1'],
  [81, 'A2'],
  [71, 'B1'],
  [61, 'B2'],
  [51, 'C1'],
  [41, 'C2'],
  [33, 'D'],
  [0, 'E'],
];

export function gradeFor(pct: number | null | undefined): string | null {
  if (pct == null || Number.isNaN(pct)) return null;
  for (const [min, g] of BANDS) if (pct >= min) return g;
  return 'E';
}

/** SQL fragment computing the same grade from a percentage expression. */
export const gradeSql = (pctExpr: string) => `CASE
  WHEN ${pctExpr} IS NULL THEN NULL
  WHEN ${pctExpr} >= 91 THEN 'A1' WHEN ${pctExpr} >= 81 THEN 'A2'
  WHEN ${pctExpr} >= 71 THEN 'B1' WHEN ${pctExpr} >= 61 THEN 'B2'
  WHEN ${pctExpr} >= 51 THEN 'C1' WHEN ${pctExpr} >= 41 THEN 'C2'
  WHEN ${pctExpr} >= 33 THEN 'D' ELSE 'E' END`;
