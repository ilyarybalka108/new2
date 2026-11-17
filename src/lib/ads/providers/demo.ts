import { eachDay, todayMoscow } from "../metrics.ts";
import type { AccountConfig, CampaignState, CampaignStats, DailyPoint } from "../types.ts";
import type { AdsProvider } from "./provider.ts";

// Демо-кабинеты: правдоподобные, но выдуманные данные, чтобы интерфейс и правила
// можно было оценить до подключения настоящего API. Значения детерминированы:
// одна и та же кампания в один и тот же день всегда даёт одинаковые цифры.

interface DemoCampaign {
  id: string;
  name: string;
  kind: string;
  state: CampaignState;
  dailyBudget: number | null;
  /** Средние показы в будний день. */
  impressions: number;
  ctr: number;
  cpc: number;
  /** Конверсия из клика в заявку. */
  cr: number;
  /** CTR плавно падает к сегодняшнему дню (имитация выгорания объявлений). */
  ctrDecay?: boolean;
  /** Кампания остановлена столько дней назад; после этого статистики нет. */
  pausedDaysAgo?: number;
}

export const DEMO_ACCOUNTS: AccountConfig[] = [
  { id: "demo-clinic", name: "Стоматология «Улыбка»", platform: "yandex_direct" },
  { id: "demo-shop", name: "Интернет-магазин «ТеплоДом»", platform: "yandex_direct" },
  { id: "demo-school", name: "Онлайн-школа «Код»", platform: "yandex_direct" },
];

const CAMPAIGNS: Record<string, DemoCampaign[]> = {
  "demo-clinic": [
    // Спрос заметно больше бюджета: расход каждый день упирается в лимит.
    { id: "c101", name: "Поиск | Имплантация | Москва", kind: "TEXT_CAMPAIGN", state: "active", dailyBudget: 6000, impressions: 1500, ctr: 0.082, cpc: 96, cr: 0.062 },
    { id: "c102", name: "Поиск | Брекеты и элайнеры", kind: "TEXT_CAMPAIGN", state: "active", dailyBudget: 4500, impressions: 640, ctr: 0.068, cpc: 74, cr: 0.031 },
    { id: "c103", name: "РСЯ | Ретаргетинг по сайту", kind: "TEXT_CAMPAIGN", state: "active", dailyBudget: 2000, impressions: 10800, ctr: 0.0062, cpc: 21, cr: 0.019 },
    // Клики идут, заявок нет.
    { id: "c104", name: "РСЯ | Широкие интересы", kind: "TEXT_CAMPAIGN", state: "active", dailyBudget: 3000, impressions: 86000, ctr: 0.0031, cpc: 9, cr: 0 },
  ],
  "demo-shop": [
    { id: "c201", name: "Поиск | Котлы | Горячий спрос", kind: "TEXT_CAMPAIGN", state: "active", dailyBudget: 9000, impressions: 1290, ctr: 0.091, cpc: 58, cr: 0.034 },
    { id: "c202", name: "Товарная кампания | Весь фид", kind: "UNIFIED_CAMPAIGN", state: "active", dailyBudget: null, impressions: 26700, ctr: 0.011, cpc: 17, cr: 0.014 },
    // Заявки есть, но в разы дороже остальных.
    { id: "c203", name: "РСЯ | Категории товаров", kind: "TEXT_CAMPAIGN", state: "active", dailyBudget: 5000, impressions: 74000, ctr: 0.0044, cpc: 12, cr: 0.003 },
    { id: "c204", name: "Поиск | Конкуренты", kind: "TEXT_CAMPAIGN", state: "active", dailyBudget: 2500, impressions: 750, ctr: 0.052, cpc: 44, cr: 0.04, ctrDecay: true },
    { id: "c205", name: "Поиск | Сезонная распродажа", kind: "TEXT_CAMPAIGN", state: "paused", dailyBudget: 4000, impressions: 830, ctr: 0.074, cpc: 49, cr: 0.028, pausedDaysAgo: 18 },
  ],
  "demo-school": [
    { id: "c301", name: "Поиск | Курсы Python", kind: "TEXT_CAMPAIGN", state: "active", dailyBudget: 7000, impressions: 930, ctr: 0.071, cpc: 83, cr: 0.065 },
    { id: "c302", name: "РСЯ | Бесплатный вебинар", kind: "TEXT_CAMPAIGN", state: "active", dailyBudget: 3500, impressions: 32000, ctr: 0.0058, cpc: 14, cr: 0.012 },
    { id: "c303", name: "Поиск | Бренд", kind: "TEXT_CAMPAIGN", state: "active", dailyBudget: 1200, impressions: 300, ctr: 0.24, cpc: 11, cr: 0.05 },
  ],
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Детерминированный генератор случайных чисел 0..1 (mulberry32). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function dayStats(c: DemoCampaign, date: string, today: string): DailyPoint | null {
  const daysAgo = daysBetween(date, today);
  if (c.pausedDaysAgo !== undefined && daysAgo < c.pausedDaysAgo) return null;

  const rand = rng(hash(`${c.id}:${date}`));
  const noise = () => 0.85 + rand() * 0.3;
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const weekend = weekday === 0 || weekday === 6 ? 0.72 : 1;

  let ctr = c.ctr * noise();
  if (c.ctrDecay) ctr *= daysAgo >= 20 ? 1 : 0.3 + 0.7 * (daysAgo / 20);

  const impressions = Math.round(c.impressions * weekend * noise());
  let clicks = Math.round(impressions * ctr);
  let cost = clicks * c.cpc * noise();
  if (c.dailyBudget !== null) {
    // Дневной бюджет — жёсткий потолок: при избытке спроса расход упирается в лимит.
    // Берётся исходный бюджет: изменение, сделанное сегодня, прошлую статистику не переписывает.
    const cap = c.dailyBudget * (0.97 + rand() * 0.03);
    if (cost > cap) {
      clicks = Math.round((clicks * cap) / cost);
      cost = cap;
    }
  }
  const expected = clicks * c.cr * noise();
  const conversions = Math.floor(expected) + (rand() < expected % 1 ? 1 : 0);
  return { date, impressions, clicks, cost: Math.round(cost * 100) / 100, conversions };
}

interface Override {
  state?: CampaignState;
  dailyBudget?: number;
}

// Изменения, сделанные в демо-режиме, живут в памяти процесса до перезапуска.
const store = globalThis as typeof globalThis & { __adsDemoOverrides?: Map<string, Override> };
const overrides = (store.__adsDemoOverrides ??= new Map<string, Override>());

export function resetDemoState() {
  overrides.clear();
}

export function createDemoProvider(accountId: string, today: string = todayMoscow()): AdsProvider {
  const campaigns = CAMPAIGNS[accountId] ?? [];

  function find(campaignId: string): DemoCampaign {
    const c = campaigns.find((x) => x.id === campaignId);
    if (!c) throw new Error(`Кампания ${campaignId} не найдена`);
    return c;
  }

  return {
    async fetchCampaigns(from, to) {
      const result: CampaignStats[] = campaigns.map((c) => {
        const o = overrides.get(c.id) ?? {};
        const daily = eachDay(from, to)
          .map((date) => dayStats(c, date, today))
          .filter((d): d is DailyPoint => d !== null);
        return {
          id: c.id,
          name: c.name,
          kind: c.kind,
          state: o.state ?? c.state,
          dailyBudget: o.dailyBudget ?? c.dailyBudget,
          budgetEditable: c.dailyBudget !== null,
          daily,
        };
      });
      return { currency: "RUB", campaigns: result };
    },

    async setCampaignState(campaignId, state) {
      find(campaignId);
      overrides.set(campaignId, { ...overrides.get(campaignId), state });
    },

    async setDailyBudget(campaignId, amount) {
      const c = find(campaignId);
      if (c.dailyBudget === null) throw new Error("У кампании автостратегия: дневной бюджет не задаётся");
      overrides.set(campaignId, { ...overrides.get(campaignId), dailyBudget: amount });
    },
  };
}
