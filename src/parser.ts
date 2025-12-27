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
  const nfkc = s.normalize("NFKC"); // 全角→半角寄せ
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
  if (t.includes("勝負服")) return true;
  if (t.startsWith("父：") || t.startsWith("母：")) return true;
  if (t.includes("ノーザンファーム") || t.includes("ファーム") || t.includes("牧場")) return true;
  if (t.includes("栗東") || t.includes("美浦")) return true;
  if (t.includes("ブリンカー") || t.includes("着用")) return true;

  // 枠番/馬番の行っぽい "1 1" など
  if (/^\d+\s+\d+$/.test(t)) return true;

  return false;
}

function detectFrameStart(line: string): boolean {
  // "枠1白 1" みたいな開始
  return /^枠\d/.test(line.trim());
}

function looksLikeHorseName(line: string): boolean {
  const t = line.trim();
  if (isNoiseLine(t)) return false;
  if (/[0-9]/.test(t)) return false;        // 馬名は数字が入りにくい
  if (/[牡牝セ]/.test(t)) return false;     // 性齢行を除外
  if (t.includes("kg") || t.includes("万円") || t.includes("年")) return false;
  if (t.length < 2 || t.length > 25) return false;
  return true;
}

function parseOddsOnly(line: string): number | null {
  // "314.4" / "4" / "4.0" など（数字だけの行）
  const t = line.trim();
  if (/^\d+(?:\.\d+)?$/.test(t)) return Number(t);
  return null;
}

function parsePopularityLine(line: string): number | null {
  // "(14番人気)" / "14番人気" / " 14番人気 " など、行内に含まれていれば拾う
  const t = line.trim();
  const m = t.match(/(\d{1,2})\s*番人気/);
  return m ? Number(m[1]) : null;
}

function parseRunnerLineSingle(line: string): RunnerParsed | null {
  // 1行完結：馬名 4.9 (3番人気)
  const m = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*\(\s*(\d{1,2})\s*番人気\s*\)/);
  if (m) {
    return {
      rawLine: line,
      horseName: m[1].trim(),
      winOdds: Number(m[2]),
      winPopularity: Number(m[3]),
    };
  }

  // 1行完結：人気 + 複勝レンジ（昔の形式）
  const popM = line.match(/(\d{1,2})\s*(?:番)?人気/);
  let rangeM =
    line.match(/(?:複|複勝)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/) ||
    line.match(/(?:複|複勝)\s*[:：]?\s*(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/) ||
    line.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);

  if (popM && rangeM) {
    return {
      rawLine: line,
      winPopularity: Number(popM[1]),
      placeLow: Number(rangeM[1]),
      placeHigh: Number(rangeM[2]),
      placeRangeRaw: `${rangeM[1]}-${rangeM[2]}`,
    };
  }

  return null;
}

export function parseAll(text: string): { blocks: RaceBlock[]; stats: ParseStats } {
  const t = normalize(text);
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);

  const blocks: RaceBlock[] = [];
  let currentTrack: string | undefined = undefined;
  let currentRaceNo: number | null = null;
  let currentRunners: RunnerParsed[] = [];

  // 枠形式の状態
  let frameMode = false;
  let frameHorse: string | null = null;
  let frameOdds: number | null = null;
  let framePop: number | null = null;

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
    frameMode = false;
    frameHorse = null;
    frameOdds = null;
    framePop = null;
  };

  const pushRunner = (r: RunnerParsed) => {
    if (currentRaceNo == null) currentRaceNo = 1; // ヘッダー無しは不明1R扱い
    currentRunners.push(r);
    stats.detectedRunnerLines += 1;
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

    // 枠ブロック開始
    if (detectFrameStart(line)) {
      frameMode = true;
      frameHorse = null;
      frameOdds = null;
      framePop = null;
      continue;
    }

    if (isNoiseLine(line)) continue;

    // まず1行完結を優先
    const single = parseRunnerLineSingle(line);
    if (single) {
      pushRunner(single);
      continue;
    }

    // 枠形式の読み取り
    if (frameMode) {
      if (!frameHorse && looksLikeHorseName(line)) {
        frameHorse = line.trim();
        continue;
      }
      if (frameOdds == null) {
        const o = parseOddsOnly(line);
        if (o != null) { frameOdds = o; continue; }
      }
      if (framePop == null) {
        const p = parsePopularityLine(line);
        if (p != null) { framePop = p; }
      }

      if (frameHorse && frameOdds != null && framePop != null) {
        pushRunner({
          rawLine: `${frameHorse} / odds:${frameOdds} pop:${framePop}`,
          horseName: frameHorse,
          winOdds: frameOdds,
          winPopularity: framePop,
        });
        // ここでブロック終了：過去成績の「○番人気」に釣られないため
        frameMode = false;
        frameHorse = null;
        frameOdds = null;
        framePop = null;
      }
      continue;
    }

    stats.ignoredLines += 1;
  }

  flush();

  stats.detectedRaces = blocks.length;
  stats.detectedTracks = new Set(blocks.map((b) => b.trackName).filter(Boolean) as string[]).size;

  return { blocks, stats };
}
