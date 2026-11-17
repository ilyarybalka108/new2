// Общие типы рекламного кабинета. Файл без рантайм-зависимостей:
// его импортируют и сервер, и клиентские компоненты.

export type Platform = "yandex_direct" | "vk_ads";

/** Состояние кампании, приведённое к единому виду для всех площадок. */
export type CampaignState =
  | "active" // идут показы
  | "paused" // остановлена владельцем
  | "inactive" // не показывается по иной причине: модерация, нет средств, нет активных объявлений
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
  state: CampaignState;
  /** Тип кампании в терминах площадки (например TEXT_CAMPAIGN). */
  kind: string | null;
  /** Дневной бюджет в валюте аккаунта; null — не задан (обычно автостратегия с недельным бюджетом). */
  dailyBudget: number | null;
  /** Можно ли менять дневной бюджет через API для этой кампании. */
  budgetEditable: boolean;
}

export interface CampaignStats extends Campaign {
  /** Статистика по дням за весь запрошенный интервал; дни без показов могут отсутствовать. */
  daily: DailyPoint[];
}

export interface AccountConfig {
  id: string;
  name: string;
  platform: Platform;
  /** Логин клиента: обязателен для агентского токена (заголовок Client-Login). */
  login?: string;
  /** Имя переменной окружения, в которой лежит OAuth-токен. Сам токен в конфиг не пишется. */
  tokenEnv?: string;
  /** Работать с песочницей API вместо боевого кабинета. */
  sandbox?: boolean;
}

export type ProposedAction =
  | { type: "pause" }
  | { type: "resume" }
  | { type: "set_budget"; amount: number };

export type Severity = "critical" | "warning" | "opportunity";

export interface Insight {
  id: string;
  severity: Severity;
  accountId: string;
  accountName: string;
  campaignId: string;
  campaignName: string;
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
  /** Разрешены ли изменяющие действия (пауза, бюджет). */
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

export interface ActionRequest {
  accountId: string;
  campaignId: string;
  action: ProposedAction;
}
