import type { PickCard, RaceBlock, Rank } from "./types";

const MID_POP_MIN = 4;
const MID_POP_MAX = 8;
const A_FLOOR = 2.2;
const S_FLOOR = 3.0;

// 複勝レンジが無いとき、単勝オッズから複勝下限を“推定”する（暫定）
// だいたい「単勝7.2倍くらい→複勝下限3.0」になるように調整
function estimatePlaceLowFromWinOdds(winOdds?: number): number | null {
  if (winOdds == null || Number.isNaN(winOdds)) return null;
  const raw = 1.2 + winOdds * 0.25; // 例: 4.0→2.2 / 8.0→3.2
  const clamped = Math.max(1.2, Math.min(6.0, raw));
  return Math.round(clamped * 10) / 10;
}

function placeText(best: any, lo: number, estimated: boolean): string {
  if (!estimated && best.placeRangeRaw) return String(best.placeRangeRaw).replaceAll("-", "–");
  // 推定表示（誤解防止）
  return `推定${lo.toFixed(1)}+`;
}

export function evaluate(block: RaceBlock): PickCard {
  const runners = block.runners;

  // 強敵：1〜2人気が2頭以上 → C
  const top12 = runners.filter((r) => r.winPopularity === 1 || r.winPopularity === 2).length;
  if (top12 >= 2) {
    return {
      rank: "C",
      trackName: block.trackName,
      raceNo: block.raceNo,
      horseName: "",
      placeRangeText: "",
      tags: [],
      reason: "相手強すぎ（1〜2番人気が2頭）",
    };
  }

  // 中穴（4〜8人気）
  const candidates = runners.filter((r) => {
    const p = r.winPopularity ?? 99;
    return p >= MID_POP_MIN && p <= MID_POP_MAX;
  });

  if (candidates.length === 0) {
    return {
      rank: "C",
      trackName: block.trackName,
      raceNo: block.raceNo,
      horseName: "",
      placeRangeText: "",
      tags: [],
      reason: "中穴候補なし（4〜8人気なし）",
    };
  }

  // 推奨：複勝下限（実値があれば実値、なければ推定）を最大にする
  const scored = candidates
    .map((r) => {
      const est = r.placeLow == null;
      const lo = r.placeLow ?? estimatePlaceLowFromWinOdds(r.winOdds) ?? -1;
      return { r, lo, est };
    })
    .sort((a, b) => {
      if (a.lo !== b.lo) return b.lo - a.lo;
      // 同率なら人気が良い方
      return (a.r.winPopularity ?? 99) - (b.r.winPopularity ?? 99);
    });

  const best = scored[0].r;
  const lo = scored[0].lo;
  const estimated = scored[0].est;

  // ランク判定（loは実値 or 推定）
  let rank: Rank = "B";
  if (lo >= S_FLOOR) rank = "S";
  else if (lo >= A_FLOOR) rank = "A";

  // タグ
  const tags: string[] = [];
  tags.push(`中穴(${best.winPopularity ?? "4–8"}人気)`);
  if (lo >= A_FLOOR) tags.push("妙味あり");
  if (top12 <= 1) tags.push("相手弱め");
  if (estimated) tags.push("要更新"); // 推定なので、直前更新を促す

  // 表示用（最大3）
  const shown = [];
  // 中穴は必ず
  shown.push(tags.find((t) => t.startsWith("中穴("))!);
  if (tags.includes("妙味あり")) shown.push("妙味あり");
  if (tags.includes("相手弱め")) shown.push("相手弱め");
  if (shown.length < 3 && tags.includes("要更新")) shown.push("要更新");

  return {
    rank,
    trackName: block.trackName,
    raceNo: block.raceNo,
    horseName: best.horseName ?? "（馬名不明）",
    jockeyName: best.jockeyName,
    winPopularity: best.winPopularity,
    winOdds: best.winOdds,
    placeRangeText: placeText(best, lo, estimated),
    placeLow: lo,
    tags: shown.slice(0, 3),
  };
}

export function evaluateAll(blocks: RaceBlock[]): PickCard[] {
  return blocks.map(evaluate);
}

export function recommendedSorted(cards: PickCard[]): PickCard[] {
  const key = (r: Rank) => (r === "S" ? 0 : r === "A" ? 1 : r === "B" ? 2 : 3);
  return cards
    .filter((c) => c.rank === "S" || c.rank === "A")
    .sort((a, b) => {
      const ka = key(a.rank), kb = key(b.rank);
      if (ka !== kb) return ka - kb;
      const loA = a.placeLow ?? -1;
      const loB = b.placeLow ?? -1;
      if (loA !== loB) return loB - loA;
      const ta = `${a.trackName ?? "不明"}${a.raceNo}`;
      const tb = `${b.trackName ?? "不明"}${b.raceNo}`;
      return ta.localeCompare(tb);
    });
}
