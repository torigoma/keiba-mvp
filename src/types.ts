export type Rank = "S" | "A" | "B" | "C";

export type RunnerParsed = {
  rawLine: string;
  horseName?: string;
  jockeyName?: string;
  winPopularity?: number; // 必須扱い
  winOdds?: number;       // 任意
  placeLow?: number;      // 必須扱い
  placeHigh?: number;
  placeRangeRaw?: string; // "2.2-3.4"
};

export type RaceBlock = {
  trackName?: string; // "中山"など。無ければundefined
  raceNo: number;     // 1..12
  runners: RunnerParsed[];
};

export type PickCard = {
  rank: Rank;
  trackName?: string;
  raceNo: number;
  horseName: string;
  jockeyName?: string;
  winPopularity?: number;
  winOdds?: number;
  placeRangeText: string;
  placeLow?: number;
  tags: string[];
  reason?: string; // Cの理由
};
