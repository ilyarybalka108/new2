import type {
  AccountSettings,
  BreakdownLevel,
  BreakdownRow,
  CampaignExclusions,
  CampaignPlan,
  CampaignStats,
  CreateResult,
  PlanAd,
} from "../types.ts";

/** Какие конверсии считать: цели и модель атрибуции из настроек кабинета. */
export type StatsOptions = Pick<AccountSettings, "goals" | "attribution">;

/**
 * Единый контракт рекламной площадки для одного кабинета. Всё, что выше (сводка, правила,
 * интерфейс, командная строка), работает только через него — новая площадка
 * (VK Реклама) добавляется одной реализацией.
 */
export interface AdsProvider {
  /** Кампании кабинета и их статистика по дням за интервал [from, to] включительно. */
  fetchCampaigns(from: string, to: string, opts?: StatsOptions): Promise<{ currency: string; campaigns: CampaignStats[] }>;

  /** Детализация одной кампании: группы, объявления, фразы, поисковые запросы или площадки. */
  fetchBreakdown(
    campaignId: string,
    level: BreakdownLevel,
    from: string,
    to: string,
    opts?: StatsOptions,
  ): Promise<BreakdownRow[]>;

  /** Минус-фразы и исключённые площадки кампании. */
  fetchExclusions(campaignId: string): Promise<CampaignExclusions>;

  setCampaignState(campaignId: string, state: "active" | "paused"): Promise<void>;
  /** Дневной бюджет в валюте аккаунта. */
  setDailyBudget(campaignId: string, amount: number): Promise<void>;
  setAdState(adId: string, state: "active" | "paused"): Promise<void>;
  setKeywordState(keywordId: string, state: "active" | "paused"): Promise<void>;
  /** Ставка на поиске в валюте аккаунта. */
  setKeywordBid(keywordId: string, amount: number): Promise<void>;
  /** Добавляет минус-фразы к уже существующим на уровне кампании. */
  addNegativeKeywords(campaignId: string, phrases: string[]): Promise<void>;
  /** Добавляет площадки к уже исключённым на уровне кампании. */
  excludePlacements(campaignId: string, sites: string[]): Promise<void>;

  /** Создаёт кампанию с группами, фразами и объявлениями. Объявления остаются черновиками. */
  createCampaign(plan: CampaignPlan): Promise<CreateResult>;
  /** Загружает изображение на площадку; возвращает идентификатор, который указывается в объявлении. */
  uploadImage(name: string, data: Buffer): Promise<string>;
  /** Загружает ролик на площадку и создаёт из него видеодополнение для объявлений. */
  uploadVideo(name: string, data: Buffer): Promise<{ videoId: string; creativeId: string }>;
  /** Добавляет текстовые объявления в существующую группу; возвращает их идентификаторы. */
  addAds(groupId: string, ads: PlanAd[]): Promise<string[]>;
  /** Отправляет объявления на модерацию — после неё начинаются показы и расход. */
  sendToModeration(adIds: string[]): Promise<void>;
}
