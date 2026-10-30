"use client";

import { useState } from "react";
import type { GroundedRecommendation } from "@/lib/types";

const DOMAIN_LABEL: Record<GroundedRecommendation["domain"], string> = { music: "Музыка", film: "Кино", book: "Книга" };
const AS_DOMAIN: Record<GroundedRecommendation["domain"], string> = { music: "музыкой", film: "фильмом", book: "книгой" };
const DEPTH_LABEL: Record<GroundedRecommendation["depth"], string> = { entry: "вход", deep: "глубже", obscure: "редкость" };
const CONNECTION_LABEL: Record<GroundedRecommendation["connections"][number]["type"], string> = {
  label: "лейбл",
  producer: "продюсер",
  musician: "музыканты",
  scene: "сцена",
  era: "эпоха",
  mood: "настроение",
  theme: "тема",
  adaptation: "экранизация",
  influence: "влияние",
  style: "стиль",
};

function VerificationBadge({ rec }: { rec: GroundedRecommendation }) {
  switch (rec.verification) {
    case "verified":
      return (
        <a
          href={rec.canonical?.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 rounded-full border border-ok/40 bg-ok/10 px-2 py-0.5 text-xs text-ok hover:bg-ok/20"
          title={`Найдено в ${rec.canonical?.source}`}
        >
          ✓ проверено · {rec.canonical?.source}
        </a>
      );
    case "not_found":
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-bad/40 bg-bad/10 px-2 py-0.5 text-xs text-bad" title="В открытых каталогах не найдено. Возможна ошибка модели.">
          ! не найдено в каталоге
        </span>
      );
    case "unavailable":
      return <span className="inline-flex rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-xs text-warn">каталог недоступен</span>;
    default:
      return <span className="inline-flex rounded-full border border-line px-2 py-0.5 text-xs text-muted">без проверки</span>;
  }
}

export default function RecCard({ rec, index }: { rec: GroundedRecommendation; index: number }) {
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const year = rec.canonical?.year ?? rec.year;

  return (
    <article className="flex flex-col gap-3 rounded-2xl border border-line bg-panel p-5 transition hover:border-accent/40">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted">
            <span>{DOMAIN_LABEL[rec.domain]}</span>
            <span aria-hidden>·</span>
            <span className={rec.depth === "obscure" ? "text-accent" : ""}>{DEPTH_LABEL[rec.depth]}</span>
            <span aria-hidden>·</span>
            <span title="Уверенность модели">{Math.round(rec.confidence * 100)}%</span>
          </div>
          <h3 className="mt-1 font-serif text-xl leading-tight text-fg">
            {rec.title}
            {year ? <span className="text-muted"> ({year})</span> : null}
          </h3>
          {rec.title_ru && rec.title_ru !== rec.title ? <div className="text-sm text-muted">{rec.title_ru}</div> : null}
          <div className="mt-0.5 text-sm text-accent-2">{rec.creator}</div>
        </div>
        <span className="font-mono text-xs text-muted">#{index + 1}</span>
      </header>

      {rec.bridge ? (
        <div className="rounded-xl border border-accent-2/30 bg-accent-2/10 p-3">
          <div className="text-[11px] uppercase tracking-wide text-accent-2">
            Если бы это было {AS_DOMAIN[rec.domain]} →
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {rec.bridge.from_items.map((it) => (
              <span key={it} className="rounded-md bg-bg/60 px-2 py-0.5 text-xs text-fg">
                {it}
              </span>
            ))}
          </div>
          <p className="mt-2 text-sm leading-relaxed text-fg/90">{rec.bridge.analogy}</p>
        </div>
      ) : null}

      <p className="text-[15px] leading-relaxed text-fg/90">{rec.why}</p>

      <ul className="flex flex-wrap gap-1.5">
        {rec.connections.map((c, i) => (
          <li key={i} className="rounded-md border border-line bg-panel-2 px-2 py-1 text-xs text-fg/80">
            <span className="text-muted">{CONNECTION_LABEL[c.type]}: </span>
            {c.text}
          </li>
        ))}
      </ul>

      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <VerificationBadge rec={rec} />
          {rec.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="text-xs text-muted underline-offset-2 hover:text-fg hover:underline">
              {l.label} ↗
            </a>
          ))}
        </div>
        <div className="flex items-center gap-1" aria-label="Оценка рекомендации">
          <button
            type="button"
            onClick={() => setVote(vote === "up" ? null : "up")}
            className={`rounded-md px-2 py-1 text-sm ${vote === "up" ? "bg-ok/20 text-ok" : "text-muted hover:bg-panel-2"}`}
            title="В точку"
          >
            👍
          </button>
          <button
            type="button"
            onClick={() => setVote(vote === "down" ? null : "down")}
            className={`rounded-md px-2 py-1 text-sm ${vote === "down" ? "bg-bad/20 text-bad" : "text-muted hover:bg-panel-2"}`}
            title="Мимо"
          >
            👎
          </button>
        </div>
      </footer>
    </article>
  );
}
