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

  // 枠番/馬番みたいな "1 1" など
  if (/^\d+\s+\d+$/.test(t)) return true;

  return false;
}

function detectFrameStart(line: string): boolean {
  // "枠1白 1" みたいなブロック開始
  return /^枠\d/.test(line.trim());
}

function looksLikeHorseNameLine(line: string): boolean {
  const t = line.trim();
  if (isNoiseLine(t)) return false;

  // 数字/斤量/万円/日付っぽいのは除外
  if (/[0-9]/.test(t)) return false;
  if (t.includes("kg") || t.includes("万円") || t.includes("年")) return false;

  // 性齢（牡/牝/セ）が入ってたら馬名ではない
  if (/[牡牝セ]/.test(t)) return false;

  // 長すぎるのは除外
  if (t.length < 2 || t.length > 25) return false;

  return true;
}

function parseOddsOnlyLine(line: string): number | null {
  // オッズ行は "30.9" のように小数のみ（:を含むタイム等は除外できる）
  const t = line.trim();
  if (/^\d+\.\d+$/.test(t)) return Number(t);
  return null;
}

function parsePopularityOnlyLine(line: string): number | null {
  // "(9番人気)" / "9番人気"
  const t = line.trim();
  const m = t.match(/^\(?\s*(\d{1,2})\s*番人気\s*\)?$/);
  if (!m) return null;
  return Number(m[1]);
}

function parseOddsPopAtLineEnd(line: string): { winOdds: number; winPopularity: number; jockeyName?: string } | null {
  // 末尾が "... 28.8 7" 形式（タブ区切りでもOK）
  const m = line.match(/(\d+(?:\.\d+)?)\s+(\d{1,2})\s*$/);
  if (!m) return null;

  const winOdds = Number(m[1]);
  const winPopularity = Number(m[2]);

  // 斤量(45-65くらい)の次トークンを騎手っぽく拾う（おまけ）
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

function parseRunnerLineSingle(line: string): RunnerParsed | null {
  // ① 馬名 オッズ (n番人気)
  const m = line.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*\(\s*(\d{1,2})\s*番人気\s*\)/);
  if (m) {
    const horseName = m[1].trim();
    const winOdds = Number(m[2]);
    const winPopularity = Number(m[3]);
    return { rawLine: line, horseName, winOdds, winPopularity };
  }

  // ② 人気 + 複勝レンジ（以前の形式）
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

    const r: RunnerParsed = { rawLine: line, winPopularity, placeLow, placeHigh, placeRangeRaw };

    const woM = line.match(/(?:単|単勝)\s*[:：]?\s*(\d+(?:\.\d+)?)/);
    if (woM) r.winOdds = Number(woM[1]);

    return r;
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

  // 旧「馬名→次行で末尾に odds pop」形式用
  let pendingHorseName: string | null = null;

  // ★新「枠…→馬名→オッズ→(人気)」形式用
  let cardActive = false;
  let cardHorseName: string | null = null;
  let cardWinOdds: number | null = null;
  let cardWinPop: number | null = null;

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
    cardActive = false;
    cardHorseName = null;
    cardWinOdds = null;
    cardWinPop = null;
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

    // 新形式：枠ブロック開始
    if (detectFrameStart(line)) {
      cardActive = true;
      cardHorseName = null;
      cardWinOdds = null;
      cardWinPop = null;
      pendingHorseName = null;
      continue;
    }

    if (isNoiseLine(line)) continue;

    // ★枠ブロック中なら、馬名→オッズ→人気 を拾う
    if (cardActive) {
      if (!cardHorseName && looksLikeHorseNameLine(line)) {
        cardHorseName = line.trim();
        continue;
      }

      if (cardWinOdds == null) {
        const o = parseOddsOnlyLine(line);
        if (o != null) {
          cardWinOdds = o;
          // まだ人気が来るまで待つ
          continue;
        }
      }

      if (cardWinPop == null) {
        const p = parsePopularityOnlyLine(line);
        if (p != null) {
          cardWinPop = p;
          // ここで揃ったら確定
        }
      }

      if (cardHorseName && cardWinOdds != null && cardWinPop != null) {
        pushRunner({
          rawLine: `${cardHorseName} / odds:${cardWinOdds} pop:${cardWinPop}`,
          horseName: cardHorseName,
          winOdds: cardWinOdds,
          winPopularity: cardWinPop,
        });
        cardActive = false; // 次の枠まで無視（過去成績の人気行に釣られない）
        cardHorseName = null;
        cardWinOdds = null;
        cardWinPop = null;
      }
      continue;
    }

    // 1行で完結する形式
    const single = parseRunnerLineSingle(line);
    if (single) {
      pushRunner(single);
      pendingHorseName = null;
      continue;
    }

    // 旧形式：馬名行→次の行の末尾に "odds pop"
    if (pendingHorseName) {
      const op = parseOddsPopAtLineEnd(line);
      if (op) {
        pushRunner({
          rawLine: `${pendingHorseName} / ${line}`,
          horseName: pendingHorseName,
          jockeyName: op.jockeyName,
          winOdds: op.winOdds,
          winPopularity: op.winPopularity,
        });
        pendingHorseName = null;
        continue;
      }
    }

    if (looksLikeHorseNameLine(line)) {
      pendingHorseName = line.trim();
      continue;
    }

    stats.ignoredLines += 1;
  }

  flush();

  stats.detectedRaces = blocks.length;
  stats.detectedTracks = new Set(blocks.map((b) => b.trackName).filter(Boolean) as string[]).size;

  return { blocks, stats };
}
