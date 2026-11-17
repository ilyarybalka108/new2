// Общие типы рекламного кабинета. Файл без рантайм-зависимостей:
// его импортируют и сервер, и клиентские компоненты.

export type Platform = "yandex_direct" | "vk_ads";

/** Состояние объекта (кампании, объявления, фразы), приведённое к единому виду. */
export type EntityState =
  | "active" // идут показы
  | "paused" // остановлен владельцем
  | "inactive" // не показывается по иной причине: черновик, модерация, нет средств
  | "ended"
  | "archived"
  | "unknown";

export interface Metrics {
  impressions: number;
  clicks: number;
  /** Расход в валюте аккаунта, с НДС. */
  cost: number;
  conversions: number;
}

export interface DailyPoint extends Metrics {
  /** YYYY-MM-DD */
  date: string;
}

export interface Campaign {
  id: string;
  name: string;
  state: EntityState;
  /** Тип кампании в терминах площадки (например UNIFIED_CAMPAIGN). */
  kind: string | null;
  /** Дневной бюджет в валюте аккаунта; null — не задан (автостратегия с недельным бюджетом). */
  dailyBudget: number | null;
  /** Можно ли менять дневной бюджет через API для этой кампании. */
  budgetEditable: boolean;
  /** Тип стратегии показа, как его называет площадка. */
  strategy: string | null;
  /** Недельный бюджет автостратегии, если задан. */
  weeklyBudget: number | null;
}

export interface CampaignStats extends Campaign {
  /** Статистика по дням за весь запрошенный интервал; дни без показов могут отсутствовать. */
  daily: DailyPoint[];
}

/** Рекламный кабинет: клиент агентства или собственный аккаунт рекламодателя. */
export interface Account {
  /** Идентификатор в интерфейсе; для Директа совпадает с логином клиента. */
  id: string;
  name: string;
  platform: Platform;
  /** Логин клиента для заголовка Client-Login; пусто — собственный аккаунт владельца токена. */
  login?: string;
}

/** Настройки кабинета, которые задаёт человек: по ним считаются KPI и рекомендации. */
export interface AccountSettings {
  /** Целевая цена конверсии. Без неё кампании сравниваются со средним по кабинету. */
  targetCpa?: number;
  /** Идентификаторы целей Метрики, которые считаются конверсиями. Пусто — все цели. */
  goals?: string[];
  /** Модель атрибуции для конверсий. */
  attribution?: "AUTO" | "LC" | "LSCCD" | "FCCD";
}

export type BreakdownLevel = "groups" | "ads" | "keywords" | "queries" | "placements";

/** Строка детализации кампании: группа, объявление, фраза, поисковый запрос или площадка. */
export interface BreakdownRow extends Metrics {
  /** Идентификатор объекта; для запросов и площадок — сам текст. */
  key: string;
  label: string;
  sublabel?: string;
  /** Есть у объявлений и фраз. */
  state?: EntityState;
  groupId?: string;
  groupName?: string;
  /** Ставка на поиске для фразы; null — ставкой управляет стратегия. */
  bid?: number | null;
  /** Запрос уже покрыт минус-фразой / площадка уже исключена. */
  handled?: boolean;
}

export interface CampaignExclusions {
  negativeKeywords: string[];
  excludedSites: string[];
}

export type ProposedAction =
  | { type: "pause" | "resume"; target: "campaign" | "ad" | "keyword"; id: string }
  | { type: "set_budget"; amount: number }
  | { type: "set_bid"; keywordId: string; amount: number }
  | { type: "add_negatives"; phrases: string[] }
  | { type: "exclude_placements"; sites: string[] };

export type Severity = "critical" | "warning" | "opportunity";

export interface Insight {
  id: string;
  severity: Severity;
  accountId: string;
  accountName: string;
  campaignId: string;
  campaignName: string;
  /** О каком объекте внутри кампании речь (фраза, запрос, площадка, объявление). */
  subject?: string;
  title: string;
  detail: string;
  /** Что предлагается сделать; отсутствует, если нужно решение человека. */
  action?: ProposedAction;
}

export interface CampaignView extends Campaign {
  current: Metrics;
  previous: Metrics;
}

export interface AccountView {
  id: string;
  name: string;
  platform: Platform;
  currency: string;
  settings: AccountSettings;
  current: Metrics;
  previous: Metrics;
  campaigns: CampaignView[];
  /** Текст ошибки, если данные аккаунта получить не удалось. */
  error?: string;
}

export interface ActionLogEntry {
  id: string;
  at: string;
  accountName: string;
  campaignName: string;
  description: string;
  ok: boolean;
  error?: string;
}

export interface Overview {
  mode: "demo" | "live";
  /** Разрешены ли изменяющие действия (пауза, бюджет, создание кампаний). */
  writeEnabled: boolean;
  range: { from: string; to: string; days: number };
  currency: string;
  /** true, если в выборке аккаунты в разных валютах и общие суммы складывать нельзя. */
  mixedCurrency: boolean;
  totals: { current: Metrics; previous: Metrics };
  /** Сумма по всем аккаунтам за текущий период, по дням без пропусков. */
  daily: DailyPoint[];
  accounts: AccountView[];
  insights: Insight[];
  log: ActionLogEntry[];
}

export interface CampaignDetail {
  mode: "demo" | "live";
  writeEnabled: boolean;
  range: { from: string; to: string; days: number };
  account: { id: string; name: string; currency: string; settings: AccountSettings };
  campaign: CampaignView;
  daily: DailyPoint[];
  /** Цена конверсии, с которой сравниваются объекты: целевая или средняя по кабинету. */
  referenceCpa: number | null;
  referenceCpaSource: "target" | "account_average" | null;
  exclusions: CampaignExclusions;
  breakdowns: Record<BreakdownLevel, BreakdownRow[]>;
  /** Уровни, которые не удалось загрузить, с текстом ошибки. */
  breakdownErrors: Partial<Record<BreakdownLevel, string>>;
  insights: Insight[];
}

export interface ActionRequest {
  accountId: string;
  campaignId: string;
  action: ProposedAction;
  /** Название объекта для журнала (текст фразы, заголовок объявления). */
  label?: string;
}

// --- создание кампаний ----------------------------------------------------------

export interface PlanAd {
  title: string;
  title2?: string;
  text: string;
  href: string;
}

export interface PlanGroup {
  name: string;
  keywords: string[];
  ads: PlanAd[];
}

/** План новой поисковой/сетевой кампании: всё, что нужно, чтобы создать её через API. */
export interface CampaignPlan {
  accountId: string;
  name: string;
  /** Где показывать. */
  placement: "search" | "network" | "both";
  strategy: "max_clicks" | "max_conversions" | "average_cpa";
  /** Недельный бюджет в валюте аккаунта. */
  weeklyBudget: number;
  /** Цель Метрики: обязательна для стратегий по конверсиям. */
  goalId?: string;
  /** Средняя цена конверсии для стратегии average_cpa. */
  averageCpa?: number;
  /** Номер счётчика Метрики. */
  counterId?: string;
  /** Идентификаторы регионов показа по геобазе Яндекса. */
  regionIds: number[];
  negativeKeywords: string[];
  groups: PlanGroup[];
}

export interface PlanIssue {
  /** Путь к полю, например groups[0].ads[1].title. */
  path: string;
  message: string;
}

export interface CreateResult {
  ok: boolean;
  campaignId?: string;
  /** Что удалось создать и на каком шаге остановились. */
  steps: { step: string; ok: boolean; detail: string }[];
  /** Идентификаторы созданных объявлений — их можно отправить на модерацию. */
  adIds: string[];
}
