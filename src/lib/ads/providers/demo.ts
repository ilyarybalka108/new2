import { eachDay, sum, todayMoscow } from "../metrics.ts";
import { validatePlan } from "../plan.ts";
import type {
  Account,
  BreakdownLevel,
  BreakdownRow,
  CampaignStats,
  DailyPoint,
  EntityState,
  Metrics,
} from "../types.ts";
import type { AdsProvider } from "./provider.ts";

// Демо-кабинеты: правдоподобные, но выдуманные данные, чтобы интерфейс и правила
// можно было оценить до подключения настоящего API. Значения детерминированы:
// одна и та же кампания в один и тот же день всегда даёт одинаковые цифры.

interface DemoGroup {
  name: string;
  keywords: string[];
  /** Объявления кампаний, созданных в демо-режиме; у встроенных кампаний генерируются. */
  ads?: { title: string; text: string }[];
}

interface DemoCampaign {
  id: string;
  name: string;
  kind: string;
  state: EntityState;
  channels: "search" | "network" | "both";
  dailyBudget: number | null;
  weeklyBudget?: number;
  /** Стратегия показа; по умолчанию — ручная при дневном бюджете, иначе «максимум конверсий». */
  strategy?: string;
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
  groups: DemoGroup[];
  /** Нецелевые поисковые запросы: клики есть, конверсий нет. */
  junkQueries?: string[];
}

export const DEMO_ACCOUNTS: Account[] = [
  { id: "demo-clinic", name: "Стоматология «Улыбка»", platform: "yandex_direct", login: "demo-clinic" },
  { id: "demo-shop", name: "Интернет-магазин «ТеплоДом»", platform: "yandex_direct", login: "demo-shop" },
  { id: "demo-school", name: "Онлайн-школа «Код»", platform: "yandex_direct", login: "demo-school" },
];

const AD_TEXT: Record<string, string> = {
  "demo-clinic": "Опытные врачи, гарантия на работы. Рассрочка 0%. Запись онлайн за минуту.",
  "demo-shop": "Официальная гарантия. Доставка и монтаж. Подбор оборудования бесплатно.",
  "demo-school": "Практика с первого занятия. Наставник и помощь с трудоустройством.",
};

const base = { kind: "TEXT_CAMPAIGN", state: "active" as EntityState };

const CAMPAIGNS: Record<string, DemoCampaign[]> = {
  "demo-clinic": [
    // Спрос заметно больше бюджета: расход каждый день упирается в лимит.
    {
      ...base, id: "c101", name: "Поиск | Имплантация | Москва", channels: "search", dailyBudget: 6000,
      impressions: 1500, ctr: 0.082, cpc: 96, cr: 0.062,
      groups: [
        { name: "Имплантация под ключ", keywords: ["имплантация зубов под ключ", "имплантация зубов москва", "зубные импланты установка"] },
        { name: "Имплантация цены", keywords: ["имплантация зубов цена", "сколько стоит имплант зуба", "имплантация зубов недорого"] },
      ],
      junkQueries: ["имплантация зубов отзывы форум", "имплантация зубов по омс бесплатно", "курсы имплантации для стоматологов"],
    },
    {
      ...base, id: "c102", name: "Поиск | Брекеты и элайнеры", channels: "search", dailyBudget: 4500,
      impressions: 640, ctr: 0.068, cpc: 74, cr: 0.031,
      groups: [
        { name: "Брекеты", keywords: ["брекеты цена", "поставить брекеты москва", "брекеты взрослым"] },
        { name: "Элайнеры", keywords: ["элайнеры цена", "элайнеры для выравнивания зубов", "капы для выравнивания зубов"] },
      ],
      junkQueries: ["брекеты своими руками", "элайнеры отзывы отрицательные", "брекеты фото до и после"],
    },
    {
      ...base, id: "c103", name: "РСЯ | Ретаргетинг по сайту", channels: "network", dailyBudget: 2000,
      impressions: 10800, ctr: 0.0062, cpc: 21, cr: 0.019,
      groups: [
        { name: "Посетители сайта за 30 дней", keywords: ["стоматология", "лечение зубов"] },
        { name: "Начали запись и не закончили", keywords: ["запись к стоматологу"] },
      ],
    },
    // Клики идут, заявок нет.
    {
      ...base, id: "c104", name: "РСЯ | Широкие интересы", channels: "network", dailyBudget: 3000,
      impressions: 86000, ctr: 0.0031, cpc: 9, cr: 0,
      groups: [
        { name: "Интересы: здоровье", keywords: ["здоровье зубов", "красивая улыбка"] },
        { name: "Интересы: красота", keywords: ["отбеливание зубов", "виниры"] },
      ],
    },
  ],
  "demo-shop": [
    {
      ...base, id: "c201", name: "Поиск | Котлы | Горячий спрос", channels: "search", dailyBudget: 9000,
      impressions: 1290, ctr: 0.091, cpc: 58, cr: 0.034,
      groups: [
        { name: "Газовые котлы", keywords: ["купить газовый котел", "газовый котел цена", "котел газовый двухконтурный"] },
        { name: "Электрические котлы", keywords: ["купить электрический котел", "электрокотел для отопления дома", "электрический котел цена"] },
      ],
      junkQueries: ["котел отопления своими руками", "ремонт газового котла", "газовый котел инструкция скачать"],
    },
    {
      ...base, id: "c202", name: "Товарная кампания | Весь фид", kind: "UNIFIED_CAMPAIGN", channels: "both", dailyBudget: null, weeklyBudget: 38000,
      impressions: 26700, ctr: 0.011, cpc: 17, cr: 0.014,
      groups: [
        { name: "Котлы", keywords: ["котлы отопления"] },
        { name: "Радиаторы", keywords: ["радиаторы отопления"] },
        { name: "Тёплый пол", keywords: ["тёплый пол"] },
      ],
      junkQueries: ["радиатор отопления чертеж", "тёплый пол схема укладки"],
    },
    // Заявки есть, но в разы дороже остальных.
    {
      ...base, id: "c203", name: "РСЯ | Категории товаров", channels: "network", dailyBudget: 5000,
      impressions: 74000, ctr: 0.0044, cpc: 12, cr: 0.003,
      groups: [
        { name: "Отопление", keywords: ["отопление дома", "котлы и радиаторы"] },
        { name: "Водоснабжение", keywords: ["насосы для воды", "водонагреватели"] },
      ],
    },
    {
      ...base, id: "c204", name: "Поиск | Конкуренты", channels: "search", dailyBudget: 2500,
      impressions: 750, ctr: 0.052, cpc: 44, cr: 0.04, ctrDecay: true,
      groups: [
        { name: "Магазины отопления", keywords: ["магазин отопительного оборудования", "интернет магазин котлов", "купить котел с доставкой"] },
      ],
      junkQueries: ["магазин отопления каталог pdf", "теплодом отзывы сотрудников"],
    },
    {
      ...base, id: "c205", name: "Поиск | Сезонная распродажа", state: "paused", channels: "search", dailyBudget: 4000,
      impressions: 830, ctr: 0.074, cpc: 49, cr: 0.028, pausedDaysAgo: 18,
      groups: [{ name: "Распродажа", keywords: ["котлы распродажа", "скидки на котлы", "купить котел со скидкой"] }],
    },
  ],
  "demo-school": [
    {
      ...base, id: "c301", name: "Поиск | Курсы Python", channels: "search", dailyBudget: 7000,
      impressions: 930, ctr: 0.071, cpc: 83, cr: 0.065,
      groups: [
        { name: "Курсы Python", keywords: ["курсы python", "обучение python с нуля", "python онлайн курс"] },
        { name: "Профессия разработчик", keywords: ["курсы программирования", "стать программистом с нуля", "обучение программированию онлайн"] },
      ],
      junkQueries: ["python скачать бесплатно", "курсы python бесплатно ютуб", "python учебник pdf"],
    },
    {
      ...base, id: "c302", name: "РСЯ | Бесплатный вебинар", channels: "network", dailyBudget: 3500,
      impressions: 32000, ctr: 0.0058, cpc: 14, cr: 0.012,
      groups: [
        { name: "Вебинар: первые шаги", keywords: ["программирование для начинающих", "смена профессии"] },
        { name: "Вебинар: карьера", keywords: ["работа в it", "удалённая работа"] },
      ],
    },
    {
      ...base, id: "c303", name: "Поиск | Бренд", channels: "search", dailyBudget: 1200,
      impressions: 300, ctr: 0.24, cpc: 11, cr: 0.05,
      groups: [{ name: "Бренд", keywords: ["школа код", "код онлайн школа", "школа код курсы"] }],
      junkQueries: ["школа код вакансии"],
    },
  ],
};

const GOOD_PLACEMENTS = ["dzen.ru", "mail.ru", "avito.ru", "rbc.ru", "gismeteo.ru", "kp.ru", "sports.ru"];
/** Мобильные игры: много дешёвых случайных кликов и ни одной заявки. */
const JUNK_PLACEMENTS = ["com.puzzle.blocks.free", "com.runner.arcade.kids", "com.merge.farm.casual"];

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
  if (c.impressions === 0) return null;
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

// --- разбиение итогов кампании по объектам --------------------------------------

interface Part {
  /** Доля показов. */
  weight: number;
  ctr: number;
  cpc: number;
  cr: number;
}

/** Делит целое число пропорционально весам так, чтобы сумма частей равнялась целому. */
function allocate(total: number, weights: number[]): number[] {
  const all = weights.reduce((s, w) => s + w, 0);
  if (all <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / all);
  const out = exact.map(Math.floor);
  let rest = total - out.reduce((s, n) => s + n, 0);
  const order = exact.map((x, i) => [x - Math.floor(x), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest-- <= 0) break;
    out[i] += 1;
  }
  return out;
}

/** Раскладывает метрики по частям; суммы по частям сходятся с исходными. */
export function distribute(total: Metrics, parts: Part[]): Metrics[] {
  const impressions = allocate(total.impressions, parts.map((p) => p.weight));
  const clicks = allocate(total.clicks, parts.map((p) => p.weight * p.ctr));
  const costWeights = parts.map((p, i) => clicks[i] * p.cpc);
  const costAll = costWeights.reduce((s, w) => s + w, 0);
  const conversions = allocate(total.conversions, parts.map((p, i) => clicks[i] * p.cr));
  return parts.map((_, i) => ({
    impressions: impressions[i],
    clicks: clicks[i],
    cost: costAll > 0 ? Math.round(((total.cost * costWeights[i]) / costAll) * 100) / 100 : 0,
    conversions: conversions[i],
  }));
}

/** Стабильный для объекта разброс вокруг единицы. */
function jitter(key: string, spread = 0.25): number {
  return 1 - spread + rng(hash(key))() * spread * 2;
}

// --- состояние демо-режима ------------------------------------------------------

interface DemoState {
  /** Состояния и ставки, изменённые в демо: ключ — идентификатор объекта. */
  states: Map<string, EntityState>;
  budgets: Map<string, number>;
  bids: Map<string, number>;
  negatives: Map<string, string[]>;
  excluded: Map<string, string[]>;
  created: Map<string, DemoCampaign[]>;
  /** Объявления, добавленные в группы в демо-режиме: ключ — идентификатор группы. */
  extraAds: Map<string, { title: string; text: string }[]>;
  seq: number;
}

const freshState = (): DemoState => ({
  states: new Map(),
  budgets: new Map(),
  bids: new Map(),
  negatives: new Map(),
  excluded: new Map(),
  created: new Map(),
  extraAds: new Map(),
  seq: 900,
});

// Изменения, сделанные в демо-режиме, живут в памяти процесса до перезапуска.
const store = globalThis as typeof globalThis & { __adsDemo?: DemoState };

function demo(): DemoState {
  return (store.__adsDemo ??= freshState());
}

export function resetDemoState() {
  store.__adsDemo = freshState();
}

export function createDemoProvider(accountId: string, today: string = todayMoscow()): AdsProvider {
  const campaigns = () => [...(CAMPAIGNS[accountId] ?? []), ...(demo().created.get(accountId) ?? [])];

  function find(campaignId: string): DemoCampaign {
    const c = campaigns().find((x) => x.id === campaignId);
    if (!c) throw new Error(`Кампания ${campaignId} не найдена`);
    return c;
  }

  function periodTotal(c: DemoCampaign, from: string, to: string): Metrics {
    return sum(
      eachDay(from, to)
        .map((date) => dayStats(c, date, today))
        .filter((d): d is DailyPoint => d !== null),
    );
  }

  function groupTotals(c: DemoCampaign, total: Metrics): Metrics[] {
    return distribute(
      total,
      c.groups.map((g, i) => ({
        weight: jitter(`${c.id}g${i}w`, 0.35),
        ctr: jitter(`${c.id}g${i}ctr`),
        cpc: jitter(`${c.id}g${i}cpc`, 0.15),
        cr: jitter(`${c.id}g${i}cr`),
      })),
    );
  }

  /** Ручные ставки есть у поисковых кампаний с дневным бюджетом (ручная стратегия). */
  const manualBids = (c: DemoCampaign) => c.channels === "search" && c.dailyBudget !== null;

  function breakdown(c: DemoCampaign, level: BreakdownLevel, from: string, to: string): BreakdownRow[] {
    const total = periodTotal(c, from, to);
    const state = demo();

    if (level === "groups") {
      const totals = groupTotals(c, total);
      return c.groups.map((g, i) => ({ key: `${c.id}g${i}`, label: g.name, ...totals[i] }));
    }

    if (level === "ads") {
      const totals = groupTotals(c, total);
      return c.groups.flatMap((g, i) => {
        const own = g.ads ?? [
          { title: g.name, text: AD_TEXT[accountId] ?? "" },
          { title: `${g.name} — выгодно`, text: AD_TEXT[accountId] ?? "" },
        ];
        const ads = [...own, ...(state.extraAds.get(`${c.id}g${i}`) ?? [])];
        // В первой группе второе объявление заметно слабее по CTR — случай для правила.
        // Добавленные позже объявления (тестовые варианты) в демо заметно сильнее остальных.
        const parts = ads.map((_, j) => ({
          weight: j === 0 ? 0.55 : 0.45,
          ctr: j >= own.length ? 1.5 : j === 1 && i === 0 ? 0.4 : 1,
          cpc: 1,
          cr: 1,
        }));
        const split = distribute(totals[i], parts);
        return ads.map((ad, j) => {
          const key = `${c.id}g${i}a${j}`;
          return {
            key,
            label: ad.title,
            sublabel: ad.text,
            state: state.states.get(key) ?? (c.impressions === 0 ? ("inactive" as EntityState) : "active"),
            groupId: `${c.id}g${i}`,
            groupName: g.name,
            ...split[j],
          };
        });
      });
    }

    if (level === "keywords") {
      const totals = groupTotals(c, total);
      return c.groups.flatMap((g, i) => {
        const parts = g.keywords.map((_, j) => {
          // Последняя фраза первой группы поисковой кампании — дорогая и без заявок.
          const dead = c.channels === "search" && i === 0 && j === g.keywords.length - 1 && g.keywords.length >= 3;
          return {
            weight: jitter(`${c.id}g${i}k${j}w`, 0.3),
            ctr: jitter(`${c.id}g${i}k${j}ctr`),
            cpc: dead ? 1.35 : jitter(`${c.id}g${i}k${j}cpc`, 0.15),
            cr: dead ? 0 : jitter(`${c.id}g${i}k${j}cr`),
          };
        });
        const split = distribute(totals[i], parts);
        return g.keywords.map((keyword, j) => {
          const key = `${c.id}g${i}k${j}`;
          return {
            key,
            label: keyword,
            state: state.states.get(key) ?? (c.impressions === 0 ? ("inactive" as EntityState) : "active"),
            groupId: `${c.id}g${i}`,
            groupName: g.name,
            bid: manualBids(c) ? (state.bids.get(key) ?? Math.round(c.cpc * 1.3 * parts[j].cpc)) : null,
            ...split[j],
          };
        });
      });
    }

    // Кампания «поиск + сети» делит статистику между запросами и площадками пополам.
    const share = c.channels === "both" ? 0.5 : 1;
    const part: Metrics = {
      impressions: Math.round(total.impressions * share),
      clicks: Math.round(total.clicks * share),
      cost: Math.round(total.cost * share * 100) / 100,
      conversions: level === "queries" ? Math.ceil(total.conversions * share) : Math.floor(total.conversions * share),
    };

    if (level === "queries") {
      if (c.channels === "network") return [];
      const queries = c.groups.flatMap((g) =>
        g.keywords.flatMap((k) => [
          { text: k, group: g.name, junk: false, weight: 1 },
          { text: `${k} рядом`, group: g.name, junk: false, weight: 0.35 },
        ]),
      );
      for (const text of c.junkQueries ?? []) queries.push({ text, group: c.groups[0].name, junk: true, weight: 0.5 });
      const split = distribute(
        part,
        queries.map((q) => ({
          weight: q.weight * jitter(`${c.id}q${q.text}w`, 0.3),
          ctr: q.junk ? 1.2 : jitter(`${c.id}q${q.text}ctr`),
          cpc: jitter(`${c.id}q${q.text}cpc`, 0.15),
          cr: q.junk ? 0 : jitter(`${c.id}q${q.text}cr`),
        })),
      );
      return queries.map((q, i) => ({ key: q.text, label: q.text, groupName: q.group, ...split[i] }));
    }

    if (c.channels === "search") return [];
    const sites = [...GOOD_PLACEMENTS.map((s) => ({ site: s, junk: false })), ...JUNK_PLACEMENTS.map((s) => ({ site: s, junk: true }))];
    const split = distribute(
      part,
      sites.map((s) => ({
        weight: (s.junk ? 0.9 : 1) * jitter(`${c.id}p${s.site}w`, 0.4),
        ctr: s.junk ? 1.6 : jitter(`${c.id}p${s.site}ctr`),
        cpc: s.junk ? 0.8 : jitter(`${c.id}p${s.site}cpc`, 0.15),
        cr: s.junk ? 0 : jitter(`${c.id}p${s.site}cr`),
      })),
    );
    return sites.map((s, i) => ({ key: s.site, label: s.site, ...split[i] }));
  }

  return {
    async fetchCampaigns(from, to) {
      const state = demo();
      const result: CampaignStats[] = campaigns().map((c) => ({
        id: c.id,
        name: c.name,
        kind: c.kind,
        state: state.states.get(c.id) ?? c.state,
        dailyBudget: state.budgets.get(c.id) ?? c.dailyBudget,
        budgetEditable: c.dailyBudget !== null,
        strategy: c.strategy ?? (c.dailyBudget !== null ? "HIGHEST_POSITION" : "WB_MAXIMUM_CONVERSION_RATE"),
        weeklyBudget: c.weeklyBudget ?? null,
        daily: eachDay(from, to)
          .map((date) => dayStats(c, date, today))
          .filter((d): d is DailyPoint => d !== null),
      }));
      return { currency: "RUB", campaigns: result };
    },

    async fetchBreakdown(campaignId, level, from, to) {
      return breakdown(find(campaignId), level, from, to);
    },

    async fetchExclusions(campaignId) {
      find(campaignId);
      return {
        negativeKeywords: demo().negatives.get(campaignId) ?? [],
        excludedSites: demo().excluded.get(campaignId) ?? [],
      };
    },

    async setCampaignState(campaignId, state) {
      find(campaignId);
      demo().states.set(campaignId, state);
    },

    async setDailyBudget(campaignId, amount) {
      if (find(campaignId).dailyBudget === null) throw new Error("У кампании автостратегия: дневной бюджет не задаётся");
      demo().budgets.set(campaignId, amount);
    },

    async setAdState(adId, state) {
      demo().states.set(adId, state);
    },

    async setKeywordState(keywordId, state) {
      demo().states.set(keywordId, state);
    },

    async setKeywordBid(keywordId, amount) {
      demo().bids.set(keywordId, amount);
    },

    async addNegativeKeywords(campaignId, phrases) {
      find(campaignId);
      const current = demo().negatives.get(campaignId) ?? [];
      demo().negatives.set(campaignId, [...new Set([...current, ...phrases])]);
    },

    async excludePlacements(campaignId, sites) {
      find(campaignId);
      const current = demo().excluded.get(campaignId) ?? [];
      demo().excluded.set(campaignId, [...new Set([...current, ...sites])]);
    },

    async createCampaign(plan) {
      const issues = validatePlan(plan);
      if (issues.length) {
        return { ok: false, steps: [{ step: "Проверка", ok: false, detail: issues.map((i) => i.message).join("; ") }], adIds: [] };
      }
      const state = demo();
      const id = `c${++state.seq}`;
      const campaign: DemoCampaign = {
        id,
        name: plan.name,
        kind: "UNIFIED_CAMPAIGN",
        // Черновик: показов нет, пока объявления не прошли модерацию.
        state: "inactive",
        channels: plan.placement,
        dailyBudget: null,
        weeklyBudget: plan.weeklyBudget,
        strategy: { max_clicks: "WB_MAXIMUM_CLICKS", max_conversions: "WB_MAXIMUM_CONVERSION_RATE", average_cpa: "AVERAGE_CPA" }[plan.strategy],
        impressions: 0,
        ctr: 0,
        cpc: 0,
        cr: 0,
        groups: plan.groups.map((g) => ({ name: g.name, keywords: g.keywords, ads: g.ads.map((a) => ({ title: a.title, text: a.text })) })),
      };
      state.created.set(accountId, [...(state.created.get(accountId) ?? []), campaign]);
      if (plan.negativeKeywords.length) state.negatives.set(id, plan.negativeKeywords);
      const adIds = plan.groups.flatMap((g, i) => g.ads.map((_, j) => `${id}g${i}a${j}`));
      const keywords = plan.groups.reduce((n, g) => n + g.keywords.length, 0);
      return {
        ok: true,
        campaignId: id,
        steps: [
          { step: "Кампания", ok: true, detail: `создана, № ${id}` },
          { step: "Группы", ok: true, detail: `создано ${plan.groups.length}` },
          { step: "Фразы", ok: true, detail: `создано ${keywords}` },
          { step: "Объявления", ok: true, detail: `создано ${adIds.length}` },
        ],
        adIds,
      };
    },

    async uploadImage(name, data) {
      return `demo-${hash(`${name}:${data.length}`).toString(36)}`;
    },

    async uploadVideo(name, data) {
      const id = hash(`${name}:${data.length}`).toString(36);
      return { videoId: `demo-video-${id}`, creativeId: `demo-creative-${id}` };
    },

    async addAds(groupId, ads) {
      const campaign = campaigns().find((c) => groupId.startsWith(`${c.id}g`));
      const index = campaign ? Number(groupId.slice(campaign.id.length + 1)) : NaN;
      const group = campaign?.groups[index];
      if (!group) throw new Error(`Группа ${groupId} не найдена`);
      const state = demo();
      const extra = state.extraAds.get(groupId) ?? [];
      const offset = (group.ads?.length ?? 2) + extra.length;
      state.extraAds.set(groupId, [...extra, ...ads.map((ad) => ({ title: ad.title, text: ad.text }))]);
      return ads.map((_, j) => `${groupId}a${offset + j}`);
    },

    async sendToModeration() {
      // В демо-режиме модерации нет: объявления остаются черновиками.
    },
  };
}
