"use client";

import Link from "next/link";
import { useState } from "react";
import { fmtDateTime } from "@/lib/ads/format";
import type { CreativeRecord, CreativeSpec } from "@/lib/ads/types";
import { Notice, useData } from "./shared";

interface FormatInfo {
  key: string;
  label: string;
  width: number;
  height: number;
  use: "text_ad" | "image_ad";
}

interface Library {
  formats: FormatInfo[];
  creatives: CreativeRecord[];
}

interface AccountsResponse {
  mode: "demo" | "live";
  writeEnabled: boolean;
  accounts: { id: string; name: string }[];
}

const field = "mt-1 block w-full rounded-lg border border-line bg-page px-3 py-2 text-base";
const fileUrl = (id: string, format: string) => `/api/ads/creatives/file?id=${id}&format=${format}`;

/** Высота превью в галерее; ширина следует из пропорций формата. */
const PREVIEW_HEIGHT = 150;

function CreativeCard({ creative, formats, canUpload, onUploaded }: { creative: CreativeRecord; formats: FormatInfo[]; canUpload: boolean; onUploaded: (message: { ok: boolean; text: string }) => void }) {
  const [busy, setBusy] = useState<string | null>(null);

  async function upload(format: string) {
    setBusy(format);
    try {
      const res = await fetch("/api/ads/creatives/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: creative.id, format }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Не удалось загрузить");
      onUploaded({ ok: true, text: `Изображение загружено на площадку: ${format}` });
    } catch (e) {
      onUploaded({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="min-w-0 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h3 className="font-semibold">{creative.spec.headline}</h3>
        <span className="text-sm text-muted">
          {creative.accountName} · {fmtDateTime(creative.createdAt)}
        </span>
      </div>
      {creative.note && <p className="mt-1 text-sm text-ink-2">{creative.note}</p>}
      <ul className="mt-3 flex gap-3 overflow-x-auto pb-2">
        {creative.formats.map((key) => {
          const format = formats.find((f) => f.key === key);
          if (!format) return null;
          const strip = format.width / format.height >= 3;
          const height = strip ? 60 : PREVIEW_HEIGHT;
          const uploaded = creative.uploads[key];
          return (
            <li key={key} className="shrink-0 text-xs">
              <a href={fileUrl(creative.id, key)} target="_blank" rel="noreferrer">
                {/* Превью отдаёт собственный маршрут кабинета, оптимизация картинок Next здесь не нужна. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl(creative.id, key)}
                  alt={`${creative.spec.headline}, ${format.label}`}
                  width={Math.round((format.width / format.height) * height)}
                  height={height}
                  loading="lazy"
                  className="rounded-md border border-line"
                />
              </a>
              <div className="mt-1 text-ink-2">
                {format.label} · {Math.round((creative.bytes[key] ?? 0) / 1024)} КБ
              </div>
              {format.use === "text_ad" &&
                (uploaded ? (
                  <div className="text-muted">на площадке</div>
                ) : (
                  <button type="button" disabled={!canUpload || busy !== null} onClick={() => upload(key)} className="text-accent hover:underline disabled:opacity-40">
                    {busy === key ? "Загружаю…" : "Загрузить на площадку"}
                  </button>
                ))}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

export default function Creatives() {
  const [reload, setReload] = useState(0);
  const { data, error } = useData<Library>("/api/ads/creatives", reload);
  const { data: accounts } = useData<AccountsResponse>("/api/ads/accounts", 0);

  const [accountId, setAccountId] = useState("");
  const [headline, setHeadline] = useState("");
  const [subline, setSubline] = useState("");
  const [cta, setCta] = useState("");
  const [badge, setBadge] = useState("");
  const [brand, setBrand] = useState("");
  const [color, setColor] = useState("#1c5cab");
  const [style, setStyle] = useState<CreativeSpec["style"]>("solid");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const account = accountId || accounts?.accounts[0]?.id || "";
  const valid = Boolean(account && headline.trim() && brand.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    setNotice(null);
    const spec: CreativeSpec = {
      headline: headline.trim(),
      brand: brand.trim(),
      color,
      style,
      ...(subline.trim() ? { subline: subline.trim() } : {}),
      ...(cta.trim() ? { cta: cta.trim() } : {}),
      ...(badge.trim() ? { badge: badge.trim() } : {}),
    };
    try {
      const res = await fetch("/api/ads/creatives", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account, spec, note: note.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Креатив не создан");
      setNotice({ ok: true, text: `Креатив отрисован в ${body.formats.length} форматах` });
      setReload((n) => n + 1);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/" className="text-sm text-accent hover:underline">
        ← Все кабинеты
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">Креативы</h1>
      <p className="mt-1 text-sm text-ink-2">
        Статичные баннеры под форматы Директа: картинки для объявлений (1:1 и 16:9) и графические объявления шести размеров.
      </p>
      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-line bg-surface p-3 text-sm text-bad">
          Не удалось загрузить библиотеку: {error}
        </p>
      )}
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <form onSubmit={submit} className="mt-5 grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-2 sm:p-5">
        <h2 className="text-base font-semibold sm:col-span-2">Новый креатив</h2>
        <label className="block text-sm">
          <span className="text-ink-2">Кабинет</span>
          <select value={account} onChange={(e) => setAccountId(e.target.value)} className={field}>
            {(accounts?.accounts ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Бренд</span>
          <input value={brand} onChange={(e) => setBrand(e.target.value)} className={field} />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-ink-2">Главный оффер</span>
          <input value={headline} onChange={(e) => setHeadline(e.target.value)} className={field} placeholder="Имплантация зубов под ключ" />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-ink-2">Подзаголовок</span>
          <input value={subline} onChange={(e) => setSubline(e.target.value)} className={field} />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Текст кнопки</span>
          <input value={cta} onChange={(e) => setCta(e.target.value)} className={field} />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Плашка с ценой или скидкой</span>
          <input value={badge} onChange={(e) => setBadge(e.target.value)} className={field} placeholder="от 25 000 ₽" />
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Цветовое решение</span>
          <select value={style} onChange={(e) => setStyle(e.target.value as CreativeSpec["style"])} className={field}>
            <option value="solid">Заливка фирменным цветом</option>
            <option value="light">Светлый фон</option>
            <option value="dark">Тёмный фон</option>
          </select>
        </label>
        <label className="block text-sm">
          <span className="text-ink-2">Фирменный цвет</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="mt-1 block h-[42px] w-full rounded-lg border border-line bg-page px-1" />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-ink-2">Зачем этот креатив — гипотеза или задача</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={field} />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy || !valid} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-page disabled:opacity-50">
            {busy ? "Рисую…" : "Отрисовать во всех форматах"}
          </button>
        </div>
      </form>

      <h2 className="mt-8 text-base font-semibold">Библиотека{data ? ` · ${data.creatives.length}` : ""}</h2>
      {data && data.creatives.length === 0 && <p className="mt-2 text-sm text-ink-2">Креативов пока нет.</p>}
      <ul className="mt-3 grid grid-cols-1 gap-3">
        {data?.creatives.map((creative) => (
          <CreativeCard
            key={creative.id}
            creative={creative}
            formats={data.formats}
            canUpload={Boolean(accounts?.writeEnabled)}
            onUploaded={(message) => {
              setNotice(message);
              setReload((n) => n + 1);
            }}
          />
        ))}
      </ul>
    </main>
  );
}
