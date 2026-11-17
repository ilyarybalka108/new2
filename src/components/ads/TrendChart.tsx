"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fmtCompact, fmtDay, fmtInt, fmtMoney } from "@/lib/ads/format";
import type { DailyPoint } from "@/lib/ads/types";

type MetricKey = "cost" | "clicks" | "conversions" | "cpa";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "cost", label: "Расход" },
  { key: "clicks", label: "Клики" },
  { key: "conversions", label: "Конверсии" },
  { key: "cpa", label: "CPA" },
];

const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 52 };

function valueOf(d: DailyPoint, key: MetricKey): number | null {
  if (key === "cpa") return d.conversions > 0 ? d.cost / d.conversions : null;
  return d[key];
}

/** Округляет максимум оси вверх до «круглого» числа и возвращает шаг делений. */
function niceScale(max: number): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 };
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  return { top: step * Math.ceil(max / step), step };
}

export default function TrendChart({ daily, currency }: { daily: DailyPoint[]; currency: string }) {
  const [metric, setMetric] = useState<MetricKey>("cost");
  const [asTable, setAsTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const [width, setWidth] = useState(800);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const isMoney = metric === "cost" || metric === "cpa";
  const format = (v: number | null) => (v === null ? "—" : isMoney ? fmtMoney(v, currency) : fmtInt(v));
  const label = METRICS.find((m) => m.key === metric)!.label;

  const geometry = useMemo(() => {
    const values = daily.map((d) => valueOf(d, metric));
    const { top, step } = niceScale(Math.max(0, ...values.map((v) => v ?? 0)));
    const plotW = width - PAD.left - PAD.right;
    const plotH = HEIGHT - PAD.top - PAD.bottom;
    const x = (i: number) => PAD.left + (daily.length > 1 ? (i / (daily.length - 1)) * plotW : plotW / 2);
    const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

    // Линия рвётся там, где значения нет (CPA в день без конверсий).
    let path = "";
    let pen = false;
    values.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      path += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });

    const ticks: number[] = [];
    for (let t = 0; t <= top + step / 2; t += step) ticks.push(t);
    const every = Math.max(1, Math.ceil(daily.length / Math.max(2, Math.floor(plotW / 80))));
    return { values, x, y, path, ticks, every, plotW };
  }, [daily, metric, width]);

  const { values, x, y, path, ticks, every, plotW } = geometry;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left - PAD.left) / plotW;
    setHover(Math.min(daily.length - 1, Math.max(0, Math.round(ratio * (daily.length - 1)))));
  }

  const hovered = hover !== null && hover < daily.length ? hover : null;

  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold">{label} по дням, все кабинеты</h2>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-line p-0.5" role="group" aria-label="Показатель">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={metric === m.key}
                onClick={() => setMetric(m.key)}
                className={`rounded-md px-2.5 py-1 text-sm ${
                  metric === m.key ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
            className="rounded-lg border border-line px-2.5 py-1.5 text-sm text-ink-2 hover:text-ink"
          >
            {asTable ? "График" : "Таблица"}
          </button>
        </div>
      </div>

      <div ref={wrap} className="relative mt-3">
        {asTable ? (
          <div className="max-h-60 overflow-y-auto">
            <table className="w-full text-sm tabular-nums">
              <thead className="sticky top-0 bg-surface text-left text-muted">
                <tr>
                  <th className="py-1.5 font-normal">День</th>
                  <th className="py-1.5 text-right font-normal">{label}</th>
                </tr>
              </thead>
              <tbody>
                {daily.map((d, i) => (
                  <tr key={d.date} className="border-t border-line">
                    <td className="py-1.5">{fmtDay(d.date)}</td>
                    <td className="py-1.5 text-right">{format(values[i])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <>
            <svg
              width={width}
              height={HEIGHT}
              role="img"
              aria-label={`${label} по дням. Точные значения — в табличном виде.`}
              onPointerMove={onMove}
              onPointerLeave={() => setHover(null)}
              className="block touch-none select-none"
            >
              {ticks.map((t) => (
                <g key={t}>
                  <line
                    x1={PAD.left}
                    x2={width - PAD.right}
                    y1={y(t)}
                    y2={y(t)}
                    stroke={t === 0 ? "var(--axis)" : "var(--grid)"}
                    strokeWidth={1}
                  />
                  <text x={PAD.left - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--muted)" className="tabular-nums">
                    {fmtCompact(t)}
                  </text>
                </g>
              ))}
              {daily.map((d, i) =>
                i % every === 0 ? (
                  <text
                    key={d.date}
                    x={x(i)}
                    y={HEIGHT - 8}
                    // Крайняя правая подпись выравнивается по краю, иначе её обрезает граница графика.
                    textAnchor={i === daily.length - 1 ? "end" : "middle"}
                    fontSize={11}
                    fill="var(--muted)"
                  >
                    {fmtDay(d.date)}
                  </text>
                ) : null,
              )}
              <path d={path} fill="none" stroke="var(--series)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {hovered !== null && (
                <g>
                  <line x1={x(hovered)} x2={x(hovered)} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="var(--axis)" strokeWidth={1} />
                  {values[hovered] !== null && (
                    <circle cx={x(hovered)} cy={y(values[hovered]!)} r={4.5} fill="var(--series)" stroke="var(--surface)" strokeWidth={2} />
                  )}
                </g>
              )}
            </svg>
            {hovered !== null && (
              <div
                className="pointer-events-none absolute top-1 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg"
                style={
                  x(hovered) > width / 2
                    ? { right: width - x(hovered) + 12 }
                    : { left: x(hovered) + 12 }
                }
              >
                <div className="font-semibold tabular-nums">{format(values[hovered])}</div>
                <div className="text-ink-2">
                  {label} · {fmtDay(daily[hovered].date)}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
