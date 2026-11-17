import type { CampaignStats } from "../types.ts";

/**
 * Единый контракт рекламной площадки. Всё, что выше (сводка, правила, интерфейс),
 * работает только через него — новая площадка (VK Реклама) добавляется одной реализацией.
 */
export interface AdsProvider {
  /** Кампании аккаунта и их статистика по дням за интервал [from, to] включительно. */
  fetchCampaigns(from: string, to: string): Promise<{ currency: string; campaigns: CampaignStats[] }>;
  setCampaignState(campaignId: string, state: "active" | "paused"): Promise<void>;
  /** Дневной бюджет в валюте аккаунта. */
  setDailyBudget(campaignId: string, amount: number): Promise<void>;
}
