"use client";

import { useMemo, useState } from "react";
import { importFile, parseFreeText } from "@/lib/parsers";
import type { ApiResult, Domain } from "@/lib/types";
import ProfileView from "./ProfileView";
import RecCard from "./RecCard";

const DOMAINS: { key: Domain; label: string; placeholder: string }[] = [
  { key: "music", label: "Музыка", placeholder: "Boards of Canada — Music Has the Right to Children\nBurial — Untrue\nGrouper" },
  { key: "film", label: "Кино", placeholder: "Сталкер (1979)\nLost Highway\nTwin Peaks: Fire Walk with Me" },
  { key: "book", label: "Книги", placeholder: "Пелевин — Чапаев и Пустота\nМураками — Хроники Заводной Птицы\nЛем — Солярис" },
];

const EXAMPLE: Record<Domain, string> = {
  music: "Boards of Canada — Music Has the Right to Children\nBurial — Untrue\nGrouper — Ruins\nPortishead — Third",
  film: "Сталкер (1979)\nLost Highway (1997)\nTwin Peaks: Fire Walk with Me (1992)",
  book: "Виктор Пелевин — Чапаев и Пустота\nХаруки Мураками — Хроники Заводной Птицы\nСтанислав Лем — Солярис",
};

export default function TasteApp() {
  const [text, setText] = useState<Record<Domain, string>>({ music: "", film: "", book: "" });
  const [imports, setImports] = useState<{ domain: Domain; source: string; items: string[]; name: string }[]>([]);
  const [want, setWant] = useState<Domain[]>(["music", "film", "book"]);
  const [depth, setDepth] = useState<"balanced" | "digger">("digger");
  const [from, setFrom] = useState<Domain | "all">("all");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResult | null>(null);

  const lists = useMemo(() => {
    const out: Record<Domain, string[]> = { music: [], film: [], book: [] };
    for (const d of DOMAINS) out[d.key].push(...parseFreeText(text[d.key]));
    for (const imp of imports) out[imp.domain].push(...imp.items);
    for (const k of Object.keys(out) as Domain[]) out[k] = [...new Set(out[k])];
    return out;
  }, [text, imports]);
  const total = lists.music.length + lists.film.length + lists.book.length;

  async function onFiles(files: FileList | null) {
    if (!files) return;
    const added: typeof imports = [];
    for (const f of Array.from(files)) {
      const content = await f.text();
      const res = importFile(f.name, content);
      if (res) added.push({ ...res, name: f.name });
      else setError(`Не удалось распознать файл ${f.name}. Поддержка: Letterboxd, Goodreads, Last.fm (CSV), Spotify (JSON).`);
    }
    if (added.length) {
      setError(null);
      setImports((prev) => [...prev, ...added]);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/recommend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...lists, want, depth, from, note: note || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Ошибка ${res.status}`);
      setResult(data as ApiResult);
      setTimeout(() => document.getElementById("result")?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  }

  const grouped = useMemo(() => {
    if (!result) return [];
    return (["music", "film", "book"] as Domain[])
      .map((d) => ({ domain: d, items: result.recommendations.filter((r) => r.domain === d) }))
      .filter((g) => g.items.length);
  }, [result]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <header className="mb-10">
        <div className="text-xs uppercase tracking-[0.2em] text-accent">TasteDigger · MVP</div>
        <h1 className="mt-2 font-serif text-4xl leading-tight sm:text-5xl">
          Если бы эта музыка была фильмом, <span className="text-muted">то каким?</span>
        </h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-muted">
          Укажите музыку, кино и книги, которые вас цепляют. Сервис переведёт вкус из одного домена в другой и покажет мост к каждой находке:
          от каких именно ваших позиций она построена и что переносится — текстура, темп, эпоха, настроение. Внутри домена копает глубже:
          лейблы, продюсеры, сцены. Каждая рекомендация проверяется по открытым каталогам.
        </p>
      </header>

      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {DOMAINS.map((d) => (
              <label key={d.key} className="flex flex-col gap-2 rounded-2xl border border-line bg-panel p-4">
                <span className="flex items-baseline justify-between text-sm">
                  <span className="font-medium">{d.label}</span>
                  <span className="font-mono text-xs text-muted">{lists[d.key].length}</span>
                </span>
                <textarea
                  value={text[d.key]}
                  onChange={(e) => setText({ ...text, [d.key]: e.target.value })}
                  placeholder={d.placeholder}
                  rows={8}
                  className="w-full resize-y rounded-lg border border-line bg-bg px-3 py-2 text-sm leading-relaxed placeholder:text-muted/60 focus:border-accent focus:outline-none"
                />
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line bg-panel/50 p-4 text-sm">
            <label className="cursor-pointer rounded-lg border border-line bg-panel-2 px-3 py-1.5 hover:border-accent/50">
              Импорт файла
              <input type="file" multiple accept=".csv,.json,text/csv,application/json" className="hidden" onChange={(e) => onFiles(e.target.files)} />
            </label>
            <span className="text-muted">Letterboxd, Goodreads, Last.fm (CSV), Spotify (JSON из выгрузки данных)</span>
            {imports.map((imp, i) => (
              <span key={i} className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs text-accent">
                {imp.source}: {imp.items.length}
                <button type="button" className="text-muted hover:text-fg" onClick={() => setImports(imports.filter((_, j) => j !== i))} aria-label="Убрать импорт">
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              className="ml-auto text-xs text-muted underline-offset-2 hover:text-fg hover:underline"
              onClick={() => setText(EXAMPLE)}
            >
              Заполнить примером
            </button>
          </div>
        </div>

        <aside className="flex flex-col gap-4 rounded-2xl border border-line bg-panel p-5">
          <fieldset>
            <legend className="text-xs uppercase tracking-wide text-muted">Отталкиваться от</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {[{ key: "all" as const, label: "Всего списка" }, ...DOMAINS.map((d) => ({ key: d.key, label: d.label }))].map((o) => {
                const on = from === o.key;
                const disabled = o.key !== "all" && lists[o.key].length === 0;
                return (
                  <button
                    key={o.key}
                    type="button"
                    disabled={disabled}
                    onClick={() => setFrom(o.key)}
                    className={`rounded-lg border px-3 py-1.5 text-sm disabled:opacity-30 ${on ? "border-accent-2 bg-accent-2/15 text-accent-2" : "border-line text-muted hover:text-fg"}`}
                  >
                    {o.label}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {from === "all"
                ? "Профиль строится по всему, мосты между доменами — от конкретных позиций."
                : `Вопрос: «если бы ${from === "music" ? "эта музыка была" : from === "film" ? "это кино было" : "эти книги были"} ${want
                    .filter((w) => w !== from)
                    .map((w) => (w === "film" ? "фильмом" : w === "book" ? "книгой" : "музыкой"))
                    .join(" или ") || "…"}, то чем?»`}
            </p>
          </fieldset>

          <fieldset>
            <legend className="text-xs uppercase tracking-wide text-muted">Что рекомендовать</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {DOMAINS.map((d) => {
                const on = want.includes(d.key);
                return (
                  <button
                    key={d.key}
                    type="button"
                    onClick={() => setWant(on ? want.filter((w) => w !== d.key) : [...want, d.key])}
                    className={`rounded-lg border px-3 py-1.5 text-sm ${on ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-fg"}`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs uppercase tracking-wide text-muted">Глубина</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(
                [
                  ["balanced", "Сбалансированно", "известное + глубже"],
                  ["digger", "Диггер", "редкости, малые лейблы"],
                ] as const
              ).map(([k, label, hint]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setDepth(k)}
                  className={`rounded-lg border px-3 py-2 text-left ${depth === k ? "border-accent bg-accent/15" : "border-line hover:border-line/80"}`}
                >
                  <div className={`text-sm ${depth === k ? "text-accent" : ""}`}>{label}</div>
                  <div className="text-xs text-muted">{hint}</div>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-muted">Уточнение (необязательно)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="например: без джаза, нужно для долгой дороги"
              className="rounded-lg border border-line bg-bg px-3 py-2 text-sm placeholder:text-muted/60 focus:border-accent focus:outline-none"
            />
          </label>

          <button
            type="submit"
            disabled={loading || total < 3 || want.length === 0}
            className="mt-auto rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-bg transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {loading ? "Копаю…" : total < 3 ? `Нужно ещё ${3 - total} позиции` : "Построить профиль и рекомендации"}
          </button>
          <p className="text-xs leading-relaxed text-muted">
            Запрос занимает 30–90 секунд: модель думает, потом каждая находка сверяется с MusicBrainz, Open Library и базой фильмов.
          </p>
        </aside>
      </form>

      {error ? <div className="mt-6 rounded-xl border border-bad/40 bg-bad/10 p-4 text-sm text-bad">{error}</div> : null}

      {loading ? (
        <div className="mt-10 space-y-4" aria-live="polite">
          <div className="h-40 animate-pulse rounded-2xl bg-panel" />
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-56 animate-pulse rounded-2xl bg-panel" />
            ))}
          </div>
        </div>
      ) : null}

      {result ? (
        <section id="result" className="mt-12 space-y-8">
          {result.warnings.map((w) => (
            <div key={w} className="rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm text-warn">
              {w}
            </div>
          ))}
          <ProfileView profile={result.profile} />
          {grouped.map((g) => (
            <div key={g.domain}>
              <h2 className="mb-4 font-serif text-2xl">
                {DOMAINS.find((d) => d.key === g.domain)?.label}
                <span className="ml-2 font-sans text-sm text-muted">{g.items.length}</span>
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                {g.items.map((r, i) => (
                  <RecCard key={`${r.domain}-${r.title}-${r.creator}`} rec={r} index={i} />
                ))}
              </div>
            </div>
          ))}
          <footer className="text-xs text-muted">
            {result.mode === "live" ? `Модель: ${result.model}. ` : "Демо-режим. "}
            Входных позиций: музыка {result.input_summary.music}, кино {result.input_summary.film}, книги {result.input_summary.book}.
          </footer>
        </section>
      ) : null}
    </div>
  );
}
