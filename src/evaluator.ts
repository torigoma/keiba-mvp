import type { PickCard, RaceBlock, Rank } from "./types";

const MID_POP_MIN = 4;
const MID_POP_MAX = 8;

// 複勝下限の基準（本来の設計）
const A_FLOOR = 2.2;
const S_FLOOR = 3.0;

// ★相手強すぎ判定を現実的に：単勝3.5倍以下が2頭以上なら見送り
// （1番人気と2番人気がいるだけで見送らない）
const STRONG_ODDS = 3.5;

// 複勝レンジが無い貼り付けのため、単勝オッズから複勝下限を“推定”する（暫定）
function estimatePlaceLowFromWinOdds(winOdds?: number): number | null {
  if (winOdds == null || Number.isNaN(winOdds)) return null;
  const raw = 1.2 + winOdds * 0.25; // 例: 4.0→2.2 / 8.0→3.2
  const clamped = Math.max(1.2, Math.min(6.0, raw));
  return Math.round(clamped * 10) / 10;
}

function placeText(best: any, lo: number, estimated: boolean): string {
  if (!estimated && best.placeRangeRaw) return String(best.placeRangeRaw).replaceAll("-", "–");
  return `推定${lo.toFixed(1)}+`; // 推定だと分かる表示
}

export function evaluate(block: RaceBlock): PickCard {
  const runners = block.runners;

  // ★相手強すぎ（単勝3.5倍以下が2頭以上）
  const strongCount = runners.filter((r) => r.winOdds != null && r.winOdds <= STRONG_ODDS).length;
  if (strongCount >= 2) {
    return {
      rank: "C",
      trackName: block.trackName,
      raceNo: block.raceNo,
      horseName: "",
      placeRangeText: "",
      tags: [],
      reason: `相手強すぎ（単勝${STRONG_ODDS}倍以下が2頭以上）`,
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

  // 推奨：複勝下限（実値があれば実値、なければ推定）最大の1頭
  const scored = candidates
    .map((r) => {
      const estimated = r.placeLow == null;
      const lo = r.placeLow ?? estimatePlaceLowFromWinOdds(r.winOdds) ?? -1;
      return { r, lo, estimated };
    })
    .sort((a, b) => {
      if (a.lo !== b.lo) return b.lo - a.lo;
      return (a.r.winPopularity ?? 99) - (b.r.winPopularity ?? 99);
    });

  const best = scored[0].r;
  const lo = scored[0].lo;
  const estimated = scored[0].estimated;

  let rank: Rank = "B";
  if (lo >= S_FLOOR) rank = "S";
  else if (lo >= A_FLOOR) rank = "A";

  // タグ（最大3：中穴・妙味・相手弱め を優先）
  const tags: string[] = [];
  tags.push(`中穴(${best.winPopularity ?? "4–8"}人気)`);
  if (lo >= A_FLOOR) tags.push("妙味あり");
  if (strongCount <= 1) tags.push("相手弱め");
  if (tags.length < 3 && estimated) tags.push("要更新"); // 推定なので直前更新推奨

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
    tags: tags.slice(0, 3),
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
