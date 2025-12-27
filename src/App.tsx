import { useEffect, useMemo, useState } from "react";
import "./App.css";
import { parseAll } from "./parser";
import { evaluateAll, recommendedSorted } from "./evaluator";
import { sample1, sample2, sample3 } from "./samples";
import type { PickCard } from "./types";

type Mode = "main" | "update";

export default function App() {
  const [input, setInput] = useState("");
  const [analyzed, setAnalyzed] = useState<{ cards: PickCard[]; statsText: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  // debug
  const [debugEnabled, setDebugEnabled] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setDebugEnabled(params.get("debug") === "1");
  }, []);

  // mode: main / update
  const [mode, setMode] = useState<Mode>("main");

  // update targets (snapshot so they don't disappear even if downgraded)
  const [updateTargets, setUpdateTargets] = useState<PickCard[]>([]);
  // per-card pasted text (keyed)
  const [updateInputs, setUpdateInputs] = useState<Record<string, string>>({});

  const recommended = useMemo(() => {
    if (!analyzed) return [];
    return recommendedSorted(analyzed.cards);
  }, [analyzed]);

  const top3 = recommended.slice(0, 3);

  // ★追加：内訳（S/A/B/Cの件数）
  const rankCounts = useMemo(() => {
    const c: Record<"S" | "A" | "B" | "C", number> = { S: 0, A: 0, B: 0, C: 0 };
    if (!analyzed) return c;
    for (const x of analyzed.cards) c[x.rank] += 1;
    return c;
  }, [analyzed]);

  function analyze(text: string) {
    const { blocks, stats } = parseAll(text);
    const cards = evaluateAll(blocks);
    const statsText = `検出: 競馬場${stats.detectedTracks} / レース${stats.detectedRaces} / ヘッダー${stats.detectedHeaders} / 馬行${stats.detectedRunnerLines} / 無視${stats.ignoredLines}`;
    setAnalyzed({ cards, statsText });
    setShowAll(false);
    setMode("main");
    setUpdateTargets([]);
    setUpdateInputs({});
  }

  function enterUpdateMode() {
    if (!analyzed) return;
    const targets = recommendedSorted(analyzed.cards);
    setUpdateTargets(targets);

    const init: Record<string, string> = {};
    for (const c of targets) init[getCardKey(c)] = "";
    setUpdateInputs(init);

    setMode("update");
  }

  function exitUpdateMode() {
    setMode("main");
  }

  function setUpdateText(card: PickCard, text: string) {
    const key = getCardKey(card);
    setUpdateInputs((prev) => ({ ...prev, [key]: text }));
  }

  function applyUpdate(card: PickCard) {
    if (!analyzed) return;

    const key = getCardKey(card);
    const pasted = updateInputs[key] ?? "";
    if (!pasted.trim()) {
      alert("貼り付けテキストが空です。");
      return;
    }

    const upd = extractOddsFromPastedText(pasted, card.horseName);

    if (upd.placeRangeRaw == null || upd.placeLow == null || upd.placeHigh == null) {
      alert("複勝レンジ（例: 2.2-3.4）が見つかりませんでした。馬名が含まれる行を貼るのがおすすめです。");
      return;
    }

    const nextRank = rankFromPlaceLow(upd.placeLow);

    const nextCard: PickCard = {
      ...card,
      rank: nextRank,
      placeRangeText: upd.placeRangeRaw.replaceAll("-", "–"),
      placeLow: upd.placeLow,
      winOdds: upd.winOdds ?? card.winOdds,
      tags: updateTags(card.tags, card.winPopularity, upd.placeLow),
    };

    setUpdateTargets((prev) => prev.map((c) => (getCardKey(c) === key ? nextCard : c)));

    const nextAnalyzedCards = analyzed.cards.map((c) => {
      if (getCardKey(c) === key) return nextCard;
      return c;
    });
    setAnalyzed({ ...analyzed, cards: nextAnalyzedCards });

    setUpdateInputs((prev) => ({ ...prev, [key]: "" }));
  }

  return (
    <div className="wrap">
      <header className="header">
        <h1>競馬MVP（方式A：まとめ貼り）</h1>
        <p className="sub">出馬表をまとめて貼る → 自動分割 → 推奨1頭 → S/Aだけ表示</p>
      </header>

      {/* Paste & Analyze */}
      <section className="card">
        <h2>出馬表を貼り付け（全Rまとめ）</h2>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="ここに複数Rぶんをまとめて貼り付け"
        />
        <div className="row">
          <button
            onClick={async () => {
              try {
                const t = await navigator.clipboard.readText();
                setInput(t);
              } catch {
                alert("クリップボード読み取りに失敗しました。手動で貼り付けてください。");
              }
            }}
          >
            貼り付け
          </button>

          <button className="primary" disabled={!input.trim()} onClick={() => analyze(input)}>
            解析する
          </button>

          <button
            onClick={() => {
              setInput("");
              setAnalyzed(null);
              setMode("main");
              setUpdateTargets([]);
              setUpdateInputs({});
            }}
          >
            クリア
          </button>

          {analyzed && recommended.length > 0 && mode === "main" && (
            <button className="primary" onClick={enterUpdateMode}>
              候補だけ更新（直前用）
            </button>
          )}

          {mode === "update" && <button onClick={exitUpdateMode}>← 戻る</button>}
        </div>

        {analyzed?.statsText && <div className="stats">{analyzed.statsText}</div>}

        {debugEnabled && (
          <details className="debug">
            <summary>Debug（サンプル注入）</summary>
            <div className="row">
              <button onClick={() => { setInput(sample1); analyze(sample1); }}>サンプル①</button>
              <button onClick={() => { setInput(sample2); analyze(sample2); }}>サンプル②</button>
              <button onClick={() => { setInput(sample3); analyze(sample3); }}>サンプル③</button>
            </div>
          </details>
        )}
      </section>

      {/* Main: Recommended list */}
      {mode === "main" && (
        <section className="card">
          <h2>おすすめ（S/A）</h2>

          {/* ★ここが変更点：解析失敗 と 見送り を分ける */}
          {analyzed && recommended.length === 0 && (
            analyzed.cards.length === 0 ? (
              <div className="empty">
                <div className="title">解析できませんでした</div>
                <div className="muted">
                  レース見出し（例：中山 7R / 7R）や、人気・オッズなどが貼り付けテキストに含まれているか確認してください。
                </div>
              </div>
            ) : (
              <div className="empty">
                <div className="title">S/A候補なし（今日は見送り）</div>
                <div className="muted">解析はできています。条件に合う候補が無かっただけです。</div>
                <div className="muted">内訳：S {rankCounts.S} / A {rankCounts.A} / B {rankCounts.B} / C {rankCounts.C}</div>
              </div>
            )
          )}

          {!analyzed && <div className="muted">まず貼り付けて「解析する」を押してね。</div>}

          {recommended.length > 0 && (
            <>
              {(showAll ? recommended : top3).map((c) => (
                <Pick key={getCardKey(c)} card={c} />
              ))}
              {!showAll && recommended.length > 3 && (
                <button className="link" onClick={() => setShowAll(true)}>
                  もっと見る（{recommended.length}件）
                </button>
              )}
            </>
          )}
        </section>
      )}

      {/* Update mode: update only targets */}
      {mode === "update" && (
        <section className="card">
          <h2>候補だけ更新（直前）</h2>
          <div className="muted" style={{ marginBottom: 10 }}>
            S/A候補だけ並べます。各カードに「そのレースのオッズ表」を貼って更新してください（馬名が含まれる行が理想）。
          </div>

          {updateTargets.length === 0 ? (
            <div className="muted">候補がありません。先に「解析する」を実行してください。</div>
          ) : (
            <div style={{ display: "grid", gap: 10 }}>
              {updateTargets.map((c) => {
                const key = getCardKey(c);
                return (
                  <div key={key} className="pick" style={{ gridTemplateColumns: "44px 1fr" }}>
                    <div className={`badge badge-${c.rank}`}>{c.rank}</div>
                    <div className="pick-body">
                      <div className="pick-head">
                        <div className="race">{`${c.trackName ?? "不明"} ${c.raceNo}R`}</div>
                        <div className="muted">現在：複勝 {c.placeRangeText}</div>
                      </div>

                      <div className="main">
                        ◎ {c.horseName}{c.jockeyName ? `（${c.jockeyName}）` : ""}
                      </div>

                      <div className="tags">
                        {c.tags.map((t) => (
                          <span className="tag" key={t}>{t}</span>
                        ))}
                      </div>

                      <textarea
                        value={updateInputs[key] ?? ""}
                        onChange={(e) => setUpdateText(c, e.target.value)}
                        placeholder="このレースのオッズ表（テキスト）を貼り付け"
                        style={{ width: "100%", minHeight: 120, marginTop: 10 }}
                      />

                      <div className="row">
                        <button className="primary" onClick={() => applyUpdate(c)}>
                          更新
                        </button>
                        <button onClick={() => setUpdateText(c, "")}>欄をクリア</button>

                        {c.rank === "S" && c.winOdds != null && (
                          <span className="muted">単勝🔥 {c.winOdds.toFixed(1)}</span>
                        )}
                      </div>

                      <div className="muted" style={{ marginTop: 6 }}>
                        更新後の判定：複勝下限 ≥ 3.0 でS、≥ 2.2でA、それ未満でB（候補落ち）
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Pick({ card }: { card: PickCard }) {
  const title = `${card.trackName ?? "不明"} ${card.raceNo}R`;

  return (
    <div className="pick">
      <div className={`badge badge-${card.rank}`}>{card.rank}</div>
      <div className="pick-body">
        <div className="pick-head">
          <div className="race">{title}</div>
          {card.rank === "C" && card.reason && <div className="muted">{card.reason}</div>}
        </div>

        {card.rank !== "C" && (
          <>
            <div className="main">
              ◎ {card.horseName}
              {card.jockeyName ? `（${card.jockeyName}）` : ""}
            </div>

            <div className="row small">
              <span>複勝 ✅ {card.placeRangeText}</span>
              {card.rank === "S" && card.winOdds != null && <span>単勝 🔥 {card.winOdds.toFixed(1)}</span>}
            </div>

            <div className="tags">
              {card.tags.map((t) => (
                <span className="tag" key={t}>{t}</span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function getCardKey(c: PickCard): string {
  return `${c.trackName ?? "不明"}_${c.raceNo}_${c.horseName}`;
}

function rankFromPlaceLow(placeLow: number): "S" | "A" | "B" {
  if (placeLow >= 3.0) return "S";
  if (placeLow >= 2.2) return "A";
  return "B";
}

function updateTags(prevTags: string[], winPopularity: number | undefined, placeLow: number): string[] {
  const tags = [...prevTags];

  const mid = winPopularity != null ? `中穴(${winPopularity}人気)` : "中穴(4–8人気)";
  const hasMid = tags.some((t) => t.startsWith("中穴("));
  if (!hasMid) tags.unshift(mid);
  else {
    for (let i = 0; i < tags.length; i++) {
      if (tags[i].startsWith("中穴(")) tags[i] = mid;
    }
  }

  const hasValue = tags.includes("妙味あり");
  if (placeLow >= 2.2) {
    if (!hasValue) tags.push("妙味あり");
  } else {
    const idx = tags.indexOf("妙味あり");
    if (idx >= 0) tags.splice(idx, 1);
  }

  const ordered: string[] = [];
  const midTag = tags.find((t) => t.startsWith("中穴("));
  if (midTag) ordered.push(midTag);
  if (tags.includes("妙味あり")) ordered.push("妙味あり");
  if (tags.includes("相手弱め")) ordered.push("相手弱め");

  return ordered.slice(0, 3);
}

function extractOddsFromPastedText(text: string, horseName: string): {
  placeLow?: number;
  placeHigh?: number;
  placeRangeRaw?: string;
  winOdds?: number;
} {
  const normalized = text
    .replaceAll("〜", "-")
    .replaceAll("–", "-")
    .replaceAll("―", "-")
    .replaceAll("—", "-")
    .replaceAll("　", " ");

  const lines = normalized.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const targetLine = lines.find((l) => l.includes(horseName)) ?? normalized;

  const m = targetLine.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  let placeLow: number | undefined;
  let placeHigh: number | undefined;
  let placeRangeRaw: string | undefined;
  if (m) {
    placeLow = Number(m[1]);
    placeHigh = Number(m[2]);
    placeRangeRaw = `${m[1]}-${m[2]}`;
  }

  const wo = targetLine.match(/(?:単|単勝)\s*[:：]?\s*(\d+(?:\.\d+)?)/);
  const winOdds = wo ? Number(wo[1]) : undefined;

  return { placeLow, placeHigh, placeRangeRaw, winOdds };
}
