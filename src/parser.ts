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
  // 競馬場 + レース番号（R / レース / 競走）
  const m1 = line.match(
    /(札幌|函館|福島|新潟|東京|中山|中京|京都|阪神|小倉)\s*(?:第\s*)?([1-9]|1[0-2])\s*(R|レース|競走)/
  );
  if (m1) {
    const track = m1[1];
    const raceNo = Number(m1[2]);
    if (TRACKS.includes(track) && raceNo >= 1 && raceNo <= 12) return { trackName: track, raceNo };
  }

  // レース番号のみ（R / レース / 競走）
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
  // パターンA：人気 + 複勝レンジ（今までのMVP形式）
  const popM = line.match(/(\d{1,2})\s*(?:番)?人気/);

  // 複勝レンジ（a-b or 複勝 a b）
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

    // 単勝（任意）
    const woM = line.match(/(?:単|単勝)\s*[:：]?\s*(\d+(?:\.\d+)?)/);
    if (woM) r.winOdds = Number(woM[1]);

    // 馬名/騎手（簡易推定）
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

  // パターンB：馬名 単勝オッズ (n番人気)  ←あなたが貼った形式の中心
  // 例：エコロアルバ 4.9 (3番人気)
  const m = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*\(\s*(\d{1,2})\s*番人気\s*\)/);
  if (m) {
    const horseName = m[1].trim();
    const winOdds = Number(m[2]);
    const winPopularity = Number(m[3]);

    const r: RunnerParsed = {
      rawLine: line,
      horseName,
      winOdds,
      winPopularity,
      // 複勝レンジは無い（後段で推定する）
    };

    // 騎手名が同じ行にあるケースがあれば拾う（今回は省略可）
    return r;
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
      // ヘッダーが無い貼り付けでも「1レース」として扱えるようにする
      if (currentRaceNo == null) currentRaceNo = 1;
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
