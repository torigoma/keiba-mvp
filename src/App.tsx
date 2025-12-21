import { useMemo, useState } from "react";
import "./App.css";
import { parseAll } from "./parser";
import { evaluateAll, recommendedSorted } from "./evaluator";
import { sample1, sample2, sample3 } from "./samples";
import type { PickCard } from "./types";


export default function App() {
  const [input, setInput] = useState("");
  const [analyzed, setAnalyzed] = useState<{ cards: PickCard[]; statsText: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const recommended = useMemo(() => {
    if (!analyzed) return [];
    return recommendedSorted(analyzed.cards);
  }, [analyzed]);

  const top3 = recommended.slice(0, 3);

  function analyze(text: string) {
    const { blocks, stats } = parseAll(text);
    const cards = evaluateAll(blocks);
    const statsText = `検出: 競馬場${stats.detectedTracks} / レース${stats.detectedRaces} / ヘッダー${stats.detectedHeaders} / 馬行${stats.detectedRunnerLines} / 無視${stats.ignoredLines}`;
    setAnalyzed({ cards, statsText });
    setShowAll(false);
  }

  return (
    <div className="wrap">
      <header className="header">
        <h1>競馬MVP（方式A：まとめ貼り）</h1>
        <p className="sub">出馬表をまとめて貼る → 自動分割 → 推奨1頭 → S/Aだけ表示</p>
      </header>

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
                // iPhone Safari等は失敗することがあるので、手貼りでOK
                alert("クリップボード読み取りに失敗しました。手動で貼り付けてください。");
              }
            }}
          >
            貼り付け
          </button>
          <button className="primary" disabled={!input.trim()} onClick={() => analyze(input)}>
            解析する
          </button>
          <button onClick={() => { setInput(""); setAnalyzed(null); }}>
            クリア
          </button>
        </div>

        {analyzed?.statsText && <div className="stats">{analyzed.statsText}</div>}

        <details className="debug">
          <summary>Debug（サンプル注入）</summary>
          <div className="row">
            <button onClick={() => { setInput(sample1); analyze(sample1); }}>サンプル①</button>
            <button onClick={() => { setInput(sample2); analyze(sample2); }}>サンプル②</button>
            <button onClick={() => { setInput(sample3); analyze(sample3); }}>サンプル③</button>
          </div>
        </details>
      </section>

      <section className="card">
        <h2>おすすめ（S/A）</h2>

        {analyzed && recommended.length === 0 && (
          <div className="empty">
            <div className="title">おすすめが作れませんでした</div>
            <div className="muted">レース見出し（例：中山 7R / 7R）が貼り付けテキストに含まれているか確認してください。</div>
          </div>
        )}

        {!analyzed && <div className="muted">まず貼り付けて「解析する」を押してね。</div>}

        {recommended.length > 0 && (
          <>
            {(showAll ? recommended : top3).map((c) => (
              <Pick key={`${c.trackName ?? "不明"}-${c.raceNo}-${c.rank}-${c.horseName}`} card={c} />
            ))}
            {!showAll && recommended.length > 3 && (
              <button className="link" onClick={() => setShowAll(true)}>
                もっと見る（{recommended.length}件）
              </button>
            )}
          </>
        )}
      </section>
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
