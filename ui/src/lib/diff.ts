/* So khớp từ (LCS) để tô màu khác biệt giữa câu gốc (ref) và câu nhận dạng (hyp). */
export interface DiffTok {
  text: string;
  op: "same" | "del" | "ins";
}

export function tokenize(s: string): string[] {
  return (s || "").trim().split(/\s+/).filter(Boolean);
}

function norm(w: string): string {
  return w.toLowerCase().replace(/[.,!?;:"'“”()…]/g, "");
}

export function wordDiff(ref: string, hyp: string): DiffTok[] {
  const a = tokenize(ref);
  const b = tokenize(hyp);
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = norm(a[i]) === norm(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffTok[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (norm(a[i]) === norm(b[j])) {
      out.push({ text: b[j], op: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ text: a[i++], op: "del" });
    } else {
      out.push({ text: b[j++], op: "ins" });
    }
  }
  while (i < n) out.push({ text: a[i++], op: "del" });
  while (j < m) out.push({ text: b[j++], op: "ins" });
  return out;
}
