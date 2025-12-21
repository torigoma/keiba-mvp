import type { PickCard, RaceBlock, Rank } from "./types";


const MID_POP_MIN = 4;
const MID_POP_MAX = 8;
const A_FLOOR = 2.2;
const S_FLOOR = 3.0;

export function evaluate(block: RaceBlock): PickCard {
  const runners = block.runners;

  // 強敵：1〜2人気が2頭以上 → C
  const top12 = runners.filter(r => r.winPopularity === 1 || r.winPopularity === 2).length;
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
  const candidates = runners.filter(r => {
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

  // 推奨：複勝下限最大、同率なら人気が良い方
  const best = [...candidates].sort((a, b) => {
    const loA = a.placeLow ?? -1;
    const loB = b.placeLow ?? -1;
    if (loA !== loB) return loB - loA;
    return (a.winPopularity ?? 99) - (b.winPopularity ?? 99);
  })[0];

  const lo = best.placeLow ?? 0;
  const placeRangeText = (best.placeRangeRaw ?? "").replaceAll("-", "–") || `${lo}`;

  let rank: Rank = "B";
  if (lo >= S_FLOOR) rank = "S";
  else if (lo >= A_FLOOR) rank = "A";

  const tags: string[] = [];
  tags.push(`中穴(${best.winPopularity ?? "4–8"}人気)`);
  if (lo >= A_FLOOR) tags.push("妙味あり");
  if (top12 <= 1) tags.push("相手弱め");

  return {
    rank,
    trackName: block.trackName,
    raceNo: block.raceNo,
    horseName: best.horseName ?? "（馬名不明）",
    jockeyName: best.jockeyName,
    winPopularity: best.winPopularity,
    winOdds: best.winOdds,
    placeRangeText,
    placeLow: best.placeLow,
    tags: tags.slice(0, 3),
  };
}

export function evaluateAll(blocks: RaceBlock[]): PickCard[] {
  return blocks.map(evaluate);
}

export function recommendedSorted(cards: PickCard[]): PickCard[] {
  const key = (r: Rank) => (r === "S" ? 0 : r === "A" ? 1 : r === "B" ? 2 : 3);
  return cards
    .filter(c => c.rank === "S" || c.rank === "A")
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
