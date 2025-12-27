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
  const nfkc = s.normalize("NFKC");
  return nfkc
    .replaceAll("〜", "-")
    .replaceAll("–", "-")
    .replaceAll("―", "-")
    .replaceAll("—", "-")
    .replaceAll("　", " ");
}

function detectHeader(line: string): { trackName?: string; raceNo: number } | null {
  const m1 = line.match(
    /(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)\s*(?:第\s*)?([1-9]|1[0-2])\s*(R|レース|競走)/
  );
  if (m1) {
    const track = m1[1];
    const raceNo = Number(m1[2]);
    if (TRACKS.includes(track) && raceNo >= 1 && raceNo <= 12) return { trackName: track, raceNo };
  }

  const m2 = line.match(/(?:第\s*)?([1-9]|1[0-2])\s*(R|レース|競走)/);
  if (m2) {
    const raceNo = Number(m2[1]);
    if (raceNo >= 1 && raceNo <= 12) return { raceNo };
  }

  return null;
}

function isNoiseLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;
  if (t === "--") return true;
  if (t === "編集") return true;
  // 枠番/馬番行っぽい "1 1" など
  if (/^\d+\s+\d+$/.test(t)) return true;
  return false;
}

function looksLikeHorseNameLine(line: string): boolean {
  const t = line.trim();
  if (isNoiseLine(t)) return false;

  // 馬名行は基本：数字が入らない、性齢(牡/牝/セ)も入らない
  if (/[0-9]/.test(t)) return false;
  if (/[牡牝セ]/.test(t)) return false;

  // 「栗東」「美浦」などは馬名ではない
  if (t.includes("栗東") || t.includes("美浦")) return false;

  // ほどほどの長さ
  if (t.length < 2 || t.length > 30) return false;

  return true;
}

function parseOddsPopAtLineEnd(line: string): { winOdds: number; winPopularity: number; jockeyName?: string } | null {
  // 末尾が "... 28.8 7" の形を拾う（タブ区切りでもOK）
  const m = line.match(/(\d+(?:\.\d+)?)\s+(\d{1,2})\s*$/);
  if (!m) return null;

  const winOdds = Number(m[1]);
  const winPopularity = Number(m[2]);

  // おまけ：斤量(45-65くらい)の次のトークンを騎手として推定
  const parts = line.split(/\s+/).filter(Boolean);
  let jockeyName: string | undefined = undefined;
  for (let i = 0; i < parts.length - 1; i++) {
    const v = Number(parts[i]);
    if (!Number.isNaN(v) && v >= 45 && v <= 65) {
      jockeyName = parts[i + 1];
      break;
    }
  }

  return { winOdds, winPopularity, jockeyName };
}

function isLikelyJockeyName(token: string): boolean {
  const len = token.length;
  if (len < 2 || len > 6) return false; // Cデムーロ等を拾えるように少し緩める
  if (/\d/.test(token)) return false;
  return true;
}

function parseRunnerLineSingle(line: string): RunnerParsed | null {
  // 既存形式：人気 + 複勝レンジ
  const popM = line.match(/(\d{1,2})\s*(?:番)?人気/);

  let rangeM =
    line.match(/(?:複|複勝)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/) ||
    line.match(/(?:複|複勝)\s*[:：]?\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/) ||
    line.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);

  if (popM && rangeM) {
    const winPopularity = Number(popM[1]);
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

    const woM = line.match(/(?:単|単勝)\s*[:：]?\s*(\d+(?:\.\d+)?)/);
    if (woM) r.winOdds = Number(woM[1]);

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

  // 既存形式：馬名 オッズ (n番人気)
  const m = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*\(\s*(\d{1,2})\s*番人気\s*\)/);
  if (m) {
    const horseName = m[1].trim();
    const winOdds = Number(m[2]);
    const winPopularity = Number(m[3]);
    return { rawLine: line, horseName, winOdds, winPopularity };
  }

  return null;
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
  let pendingHorseName: string | null = null; // ★今回追加：馬名行を覚える

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
    pendingHorseName = null;
  };

  for (const line of lines) {
    // header
    const header = detectHeader(line);
    if (header) {
      flush();
      currentTrack = header.trackName;
      currentRaceNo = header.raceNo;
      stats.detectedHeaders += 1;
      continue;
    }

    if (isNoiseLine(line)) {
      continue;
    }

    // single-line parse
    const single = parseRunnerLineSingle(line);
    if (single) {
      if (currentRaceNo == null) currentRaceNo = 1; // ヘッダー無しでも1レース扱い
      currentRunners.push(single);
      stats.detectedRunnerLines += 1;
      pendingHorseName = null;
      continue;
    }

    // horse name line
    if (looksLikeHorseNameLine(line)) {
      pendingHorseName = line.trim();
      continue;
    }

    // table detail line: use pendingHorseName + "... odds pop"
    if (pendingHorseName) {
      const op = parseOddsPopAtLineEnd(line);
      if (op) {
        if (currentRaceNo == null) currentRaceNo = 1;
        const r: RunnerParsed = {
          rawLine: `${pendingHorseName} / ${line}`,
          horseName: pendingHorseName,
          jockeyName: op.jockeyName,
          winOdds: op.winOdds,
          winPopularity: op.winPopularity,
        };
        currentRunners.push(r);
        stats.detectedRunnerLines += 1;
        pendingHorseName = null;
        continue;
      }
    }

    stats.ignoredLines += 1;
  }

  flush();

  stats.detectedRaces = blocks.length;
  stats.detectedTracks = new Set(blocks.map((b) => b.trackName).filter(Boolean) as string[]).size;

  return { blocks, stats };
}
