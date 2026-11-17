import type { DailyPoint, Metrics } from "./types.ts";

export const ZERO: Metrics = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };

export function add(a: Metrics, b: Metrics): Metrics {
  return {
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    cost: a.cost + b.cost,
    conversions: a.conversions + b.conversions,
  };
}

export function sum(items: Metrics[]): Metrics {
  return items.reduce(add, ZERO);
}

export interface Derived {
  /** Доля кликов от показов, 0..1. */
  ctr: number | null;
  cpc: number | null;
  cpa: number | null;
  /** Доля конверсий от кликов, 0..1. */
  cr: number | null;
}

/** Производные метрики; null там, где знаменатель равен нулю и значение не определено. */
export function derive(m: Metrics): Derived {
  return {
    ctr: m.impressions > 0 ? m.clicks / m.impressions : null,
    cpc: m.clicks > 0 ? m.cost / m.clicks : null,
    cpa: m.conversions > 0 ? m.cost / m.conversions : null,
    cr: m.clicks > 0 ? m.conversions / m.clicks : null,
  };
}

/** Относительное изменение (0.1 = +10%); null, если сравнивать не с чем. */
export function change(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0) return null;
  return (current - previous) / previous;
}

/** Сумма метрик за дни, попадающие в интервал [from, to] включительно. */
export function sumRange(daily: DailyPoint[], from: string, to: string): Metrics {
  return sum(daily.filter((d) => d.date >= from && d.date <= to));
}

// --- даты (YYYY-MM-DD, арифметика в UTC, чтобы не зависеть от часового пояса сервера) ---

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Сегодняшняя дата по Москве — в этом поясе Директ по умолчанию считает статистику. */
export function todayMoscow(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow" }).format(now);
}

/**
 * Период из `days` полных дней, заканчивающийся вчера, и равный ему предыдущий.
 * Сегодняшний день не включается: он неполный и искажает сравнение.
 */
export function periods(days: number, today: string = todayMoscow()) {
  const to = addDays(today, -1);
  const from = addDays(to, -(days - 1));
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(days - 1));
  return { from, to, prevFrom, prevTo };
}
