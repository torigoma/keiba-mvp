import type { RaceBlock, RunnerParsed } from "./types";

const TRACKS = ["札幌","函館","福島","新潟","東京","中山","中京","京都","阪神","小倉"];

export type ParseStats = {
  detectedTracks: number;
  detectedRaces: number;
  detectedHeaders: number;
  detectedRunnerLines: number;
  ignoredLines: number;
};

export function normalize(s: string): string {
  return s
    .replaceAll("〜", "-")
    .replaceAll("–", "-")
    .replaceAll("―", "-")
    .replaceAll("—", "-")
    .replaceAll("　", " ");
}

function detectHeader(line: string): { trackName?: string; raceNo: number } | null {
  // 競馬場 + R
  const m1 = line.match(/(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)\s*([1-9]|1[0-2])R/);
  if (m1) {
    const track = m1[1];
    const raceNo = Number(m1[2]);
    if (TRACKS.includes(track) && raceNo >= 1 && raceNo <= 12) return { trackName: track, raceNo };
  }
  // Rのみ
  const m2 = line.match(/\b([1-9]|1[0-2])R\b/);
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
  // 人気（必須）
  const popM = line.match(/(\d{1,2})\s*人気/);
  if (!popM) return null;
  const winPopularity = Number(popM[1]);

  // 複勝レンジ（必須）
  const rangeM = line.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
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
  const idx = line.indexOf(`${winPopularity}人気`);
  if (idx > 0) {
    const left = line.slice(0, idx).trim();
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
  const lines = t.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);

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
  stats.detectedTracks = new Set(blocks.map(b => b.trackName).filter(Boolean) as string[]).size;

  return { blocks, stats };
}
