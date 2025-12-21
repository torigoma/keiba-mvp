import type { RaceBlock, RunnerParsed } from "./types";

const TRACKS = ["札幌", "函館", "福島", "新潟", "東京", "中山", "中京", "京都", "阪神", "小倉"];

export type ParseStats = {
  detectedTracks: number;
  detectedRaces: number;
  detectedHeaders: number;
  detectedRunnerLines: number;
  ignoredLines: number;
};

export function normalize(s: string): string {
  // 全角英数字などを半角に寄せる（７Ｒ→7R / 全角スペースなど）
  const nfkc = s.normalize("NFKC");

  return nfkc
    .replaceAll("〜", "-")
    .replaceAll("–", "-")
    .replaceAll("―", "-")
    .replaceAll("—", "-")
    .replaceAll("　", " ");
}

function detectHeader(line: string): { trackName?: string; raceNo: number } | null {
  // 競馬場 + レース番号（R / レース / 競走 に対応、"第7競走"も対応）
  // 例: "中山 7R", "中山 第7競走", "中山 7レース"
  const m1 = line.match(
    /(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)\s*(?:第\s*)?([1-9]|1[0-2])\s*(R|レース|競走)/
  );
  if (m1) {
    const track = m1[1];
    const raceNo = Number(m1[2]);
    if (TRACKS.includes(track) && raceNo >= 1 && raceNo <= 12) return { trackName: track, raceNo };
  }

  // レース番号のみ（R / レース / 競走）
  // 例: "7R", "第7競走", "7レース"
  const m2 = line.match(/(?:第\s*)?([1-9]|1[0-2])\s*(R|レース|競走)/);
  if (m2) {
    const raceNo = Number(m2[1]);
    if (raceNo >= 1 && raceNo <= 12) return { raceNo };
  }

  return null;
}

function isLikelyJockeyName(token: string): boolean {
  const len = token.length;
  if (len < 2 || len > 4) return false;
  if (/\d/.test(token)) return false;
  return true;
}

function parseRunnerLine(line: string): RunnerParsed | null {
  // 人気（必須）: "6人気", "6番人気" どちらもOK
  const popM = line.match(/(\d{1,2})\s*(?:番)?人気/);
  if (!popM) return null;
  const winPopularity = Number(popM[1]);

  // 複勝レンジ（必須）
  // まず "複勝 2.2-3.4" を優先
  let rangeM =
    line.match(/(?:複|複勝)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/) ||
    // フォールバック： "複勝 2.2 3.4"（スペース区切り）
    line.match(/(?:複|複勝)\s*[:：]?\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/) ||
    // 最後の手段：行内にある最初の "2.2-3.4"（複勝が省略されるサイト用）
    line.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);

  if (!rangeM) return null;

  const placeLow = Number(rangeM[1]);
  const placeHigh = Number(rangeM[2]);
  const placeRangeRaw = `${rangeM[1]}-${rangeM[2]}`;

  const r: RunnerParsed = {
    rawLine: line,
    winPopularity,
    placeLow,
    placeHigh,
    placeRangeRaw,
  };

  // 単勝オッズ（任意）
  const woM = line.match(/(?:単|単勝)\s*[:：]?\s*(\d+(?:\.\d+)?)/);
  if (woM) r.winOdds = Number(woM[1]);

  // 馬名/騎手（簡易推定）
  // 「人気」の左側を使って、末尾の日本語2〜4文字を騎手、1つ前を馬名
  const idx = line.indexOf(`${winPopularity}人気`);
  const idx2 = idx >= 0 ? idx : line.indexOf(`${winPopularity}番人気`);
  if (idx2 > 0) {
    const left = line.slice(0, idx2).trim();
    const tokens = left.split(/\s+/).filter(Boolean);
    const last = tokens[tokens.length - 1];
    if (last && isLikelyJockeyName(last)) {
      r.jockeyName = last;
      if (tokens.length >= 2) r.horseName = tokens[tokens.length - 2];
    }
  }

  return r;
}

export function parseAll(text: string): { blocks: RaceBlock[]; stats: ParseStats } {
  const t = normalize(text);
  const lines = t
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const blocks: RaceBlock[] = [];
  let currentTrack: string | undefined = undefined;
  let currentRaceNo: number | null = null;
  let currentRunners: RunnerParsed[] = [];

  const stats: ParseStats = {
    detectedTracks: 0,
    detectedRaces: 0,
    detectedHeaders: 0,
    detectedRunnerLines: 0,
    ignoredLines: 0,
  };

  const flush = () => {
    if (currentRaceNo != null && currentRunners.length > 0) {
      blocks.push({ trackName: currentTrack, raceNo: currentRaceNo, runners: currentRunners });
    }
    currentRunners = [];
  };

  for (const line of lines) {
    const header = detectHeader(line);
    if (header) {
      flush();
      currentTrack = header.trackName;
      currentRaceNo = header.raceNo;
      stats.detectedHeaders += 1;
      continue;
    }

    const runner = parseRunnerLine(line);
    if (runner) {
      currentRunners.push(runner);
      stats.detectedRunnerLines += 1;
    } else {
      stats.ignoredLines += 1;
    }
  }

  flush();

  stats.detectedRaces = blocks.length;
  stats.detectedTracks = new Set(blocks.map((b) => b.trackName).filter(Boolean) as string[]).size;

  return { blocks, stats };
}
