import { type AdsConfig, loadConfig } from "./config.ts";
import { analyzeAccount, analyzeCampaign, isCoveredByNegatives, referenceCpa } from "./insights.ts";
import { eachDay, periods, sum, sumRange, todayMoscow, ZERO } from "./metrics.ts";
import { validatePlan } from "./plan.ts";
import { createDemoProvider, DEMO_ACCOUNTS } from "./providers/demo.ts";
import type { AdsProvider } from "./providers/provider.ts";
import { createYandexDirectProvider, discoverAccounts } from "./providers/yandex-direct.ts";
import { appendLog, getSettings, readLog, saveSettings } from "./store.ts";
import type {
  Account,
  AccountSettings,
  AccountView,
  ActionLogEntry,
  ActionRequest,
  BreakdownLevel,
  BreakdownRow,
  CampaignDetail,
  CampaignPlan,
  CampaignStats,
  CreateResult,
  DailyPoint,
  Insight,
  Overview,
  ProposedAction,
} from "./types.ts";

export { loadConfig, type AdsConfig };

export const BREAKDOWN_LEVELS: BreakdownLevel[] = ["groups", "ads", "keywords", "queries", "placements"];

/** Ошибка с HTTP-статусом: неверный запрос, нет прав, не найдено. */
export class ActionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ActionError";
    this.status = status;
  }
}

// --- кеш ответов API --------------------------------------------------------------

const store = globalThis as typeof globalThis & { __adsCache?: Map<string, { at: number; data: Promise<unknown> }> };
const cache: Map<string, { at: number; data: Promise<unknown> }> = (store.__adsCache ??= new Map());

// Отчёты Директа расходуют баллы и строятся не мгновенно — не дёргаем API на каждое обновление страницы.
const DATA_TTL_MS = 5 * 60 * 1000;
const ACCOUNTS_TTL_MS = 30 * 60 * 1000;

/** В демо-режиме данные считаются мгновенно и должны сразу отражать изменения — кеш не нужен. */
function cached<T>(config: AdsConfig, key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  if (config.mode === "demo") return load();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data as Promise<T>;
  const data = Promise.resolve().then(load);
  cache.set(key, { at: Date.now(), data });
  data.catch(() => cache.delete(key));
  return data;
}

function invalidate(accountId: string) {
  for (const key of cache.keys()) if (key.startsWith(`data:${accountId}:`)) cache.delete(key);
}

export function clearCache() {
  cache.clear();
}

// --- кабинеты и доступ к площадке -----------------------------------------------

export function listAccounts(config: AdsConfig = loadConfig()): Promise<Account[]> {
  if (config.mode === "demo") return Promise.resolve(DEMO_ACCOUNTS);
  if (config.clientLogins) {
    return Promise.resolve(config.clientLogins.map((login) => ({ id: login, name: login, platform: "yandex_direct", login })));
  }
  return cached(config, "accounts", ACCOUNTS_TTL_MS, () => discoverAccounts({ token: config.token!, apiVersion: config.apiVersion }));
}

async function findAccount(config: AdsConfig, accountId: string): Promise<Account> {
  const account = (await listAccounts(config)).find((a) => a.id === accountId);
  if (!account) throw new ActionError("Кабинет не найден", 404);
  return account;
}

function providerFor(config: AdsConfig, account: Account, today?: string): AdsProvider {
  if (config.mode === "demo") return createDemoProvider(account.id, today);
  return createYandexDirectProvider({ token: config.token!, login: account.login, apiVersion: config.apiVersion });
}

interface Snapshot {
  currency: string;
  campaigns: CampaignStats[];
}

function fetchSnapshot(
  config: AdsConfig,
  account: Account,
  settings: AccountSettings,
  from: string,
  to: string,
  today?: string,
): Promise<Snapshot> {
  const stats = { goals: settings.goals, attribution: settings.attribution };
  return cached(config, `data:${account.id}:campaigns:${from}:${to}:${JSON.stringify(stats)}`, DATA_TTL_MS, () =>
    providerFor(config, account, today).fetchCampaigns(from, to, stats),
  );
}

// --- сводка -----------------------------------------------------------------------

interface Periods {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
}

export function buildAccountView(account: Account, settings: AccountSettings, snapshot: Snapshot, p: Periods): AccountView {
  const campaigns = snapshot.campaigns
    .map((c) => {
      const { daily, ...campaign } = c;
      return { ...campaign, current: sumRange(daily, p.from, p.to), previous: sumRange(daily, p.prevFrom, p.prevTo) };
    })
    .sort((a, b) => b.current.cost - a.current.cost);
  return {
    id: account.id,
    name: account.name,
    platform: account.platform,
    currency: snapshot.currency,
    settings,
    current: sum(campaigns.map((c) => c.current)),
    previous: sum(campaigns.map((c) => c.previous)),
    campaigns,
  };
}

export async function getOverview(
  days: number,
  config: AdsConfig = loadConfig(),
  today: string = todayMoscow(),
): Promise<Overview> {
  const p = periods(days, today);
  const all = await listAccounts(config);

  const results = await Promise.all(
    all.map(async (account) => {
      const settings = await getSettings(config.dataDir, account.id);
      try {
        return { account, settings, snapshot: await fetchSnapshot(config, account, settings, p.prevFrom, p.to, today) };
      } catch (e) {
        return { account, settings, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  const accounts: AccountView[] = [];
  const insights: Insight[] = [];
  const dailyTotals = new Map<string, DailyPoint>(eachDay(p.from, p.to).map((date) => [date, { date, ...ZERO }]));

  for (const r of results) {
    if (!("snapshot" in r) || !r.snapshot) {
      accounts.push({
        id: r.account.id,
        name: r.account.name,
        platform: r.account.platform,
        currency: "RUB",
        settings: r.settings,
        current: ZERO,
        previous: ZERO,
        campaigns: [],
        error: r.error,
      });
      continue;
    }
    const view = buildAccountView(r.account, r.settings, r.snapshot, p);
    accounts.push(view);

    const currentDaily = new Map<string, DailyPoint[]>();
    for (const c of r.snapshot.campaigns) {
      const points = c.daily.filter((d) => d.date >= p.from && d.date <= p.to);
      currentDaily.set(c.id, points);
      for (const d of points) {
        const t = dailyTotals.get(d.date)!;
        t.impressions += d.impressions;
        t.clicks += d.clicks;
        t.cost += d.cost;
        t.conversions += d.conversions;
      }
    }
    insights.push(...analyzeAccount({ account: view, daily: currentDaily, days }));
  }

  const order = { critical: 0, warning: 1, opportunity: 2 };
  insights.sort((a, b) => order[a.severity] - order[b.severity]);
  const currencies = new Set(accounts.filter((a) => !a.error).map((a) => a.currency));

  return {
    mode: config.mode,
    writeEnabled: config.writeEnabled,
    range: { from: p.from, to: p.to, days },
    currency: [...currencies][0] ?? "RUB",
    mixedCurrency: currencies.size > 1,
    totals: { current: sum(accounts.map((a) => a.current)), previous: sum(accounts.map((a) => a.previous)) },
    daily: [...dailyTotals.values()],
    accounts,
    insights,
    log: await readLog(config.dataDir),
  };
}

// --- одна кампания ----------------------------------------------------------------

/**
 * Детализация кампании. Уровни запрашиваются выборочно: отчёт по поисковым запросам
 * Директ строит только в офлайн-режиме, и ждать его вместе с остальным незачем.
 */
export async function getCampaignDetail(
  accountId: string,
  campaignId: string,
  days: number,
  levels: BreakdownLevel[] = BREAKDOWN_LEVELS,
  config: AdsConfig = loadConfig(),
  today: string = todayMoscow(),
): Promise<CampaignDetail> {
  const p = periods(days, today);
  const account = await findAccount(config, accountId);
  const settings = await getSettings(config.dataDir, account.id);
  const snapshot = await fetchSnapshot(config, account, settings, p.prevFrom, p.to, today);
  const view = buildAccountView(account, settings, snapshot, p);
  const campaign = view.campaigns.find((c) => c.id === campaignId);
  const stats = snapshot.campaigns.find((c) => c.id === campaignId);
  if (!campaign || !stats) throw new ActionError("Кампания не найдена", 404);

  const provider = providerFor(config, account, today);
  const statsOpts = { goals: settings.goals, attribution: settings.attribution };
  const key = (what: string) => `data:${account.id}:${campaignId}:${what}:${p.from}:${p.to}:${JSON.stringify(statsOpts)}`;

  const [exclusions, ...loaded] = await Promise.all([
    cached(config, key("exclusions"), DATA_TTL_MS, () => provider.fetchExclusions(campaignId)),
    ...levels.map((level) =>
      cached(config, key(level), DATA_TTL_MS, () => provider.fetchBreakdown(campaignId, level, p.from, p.to, statsOpts)).then(
        (rows) => ({ level, rows }),
        (e: unknown) => ({ level, error: e instanceof Error ? e.message : String(e) }),
      ),
    ),
  ]);

  const breakdowns: Record<BreakdownLevel, BreakdownRow[]> = { groups: [], ads: [], keywords: [], queries: [], placements: [] };
  const breakdownErrors: CampaignDetail["breakdownErrors"] = {};
  const excluded = new Set(exclusions.excludedSites.map((s) => s.toLowerCase()));
  for (const item of loaded) {
    if ("error" in item) {
      breakdownErrors[item.level] = item.error;
      continue;
    }
    breakdowns[item.level] = item.rows
      .map((row) => ({
        ...row,
        // Уже обработанные запросы и площадки помечаем, чтобы не предлагать их повторно.
        ...(item.level === "queries" ? { handled: isCoveredByNegatives(row.key, exclusions.negativeKeywords) } : {}),
        ...(item.level === "placements" ? { handled: excluded.has(row.key.toLowerCase()) } : {}),
      }))
      .sort((a, b) => b.cost - a.cost);
  }

  const ref = referenceCpa(view);
  const loadedLevels = Object.fromEntries(levels.filter((l) => !breakdownErrors[l]).map((l) => [l, breakdowns[l]]));

  return {
    mode: config.mode,
    writeEnabled: config.writeEnabled,
    range: { from: p.from, to: p.to, days },
    account: { id: account.id, name: account.name, currency: snapshot.currency, settings },
    campaign,
    daily: eachDay(p.from, p.to).map((date) => stats.daily.find((d) => d.date === date) ?? { date, ...ZERO }),
    referenceCpa: ref.value,
    referenceCpaSource: ref.source,
    exclusions,
    breakdowns,
    breakdownErrors,
    insights: analyzeCampaign({ account, campaign, referenceCpa: ref.value, breakdowns: loadedLevels, days }),
  };
}

// --- настройки кабинета ------------------------------------------------------------

export async function updateSettings(
  accountId: string,
  settings: AccountSettings,
  config: AdsConfig = loadConfig(),
): Promise<AccountSettings> {
  const account = await findAccount(config, accountId);
  const clean: AccountSettings = {
    ...(settings.targetCpa && settings.targetCpa > 0 ? { targetCpa: settings.targetCpa } : {}),
    ...(settings.goals?.length ? { goals: settings.goals } : {}),
    ...(settings.attribution ? { attribution: settings.attribution } : {}),
  };
  await saveSettings(config.dataDir, account.id, clean);
  invalidate(account.id);
  return clean;
}

// --- действия -----------------------------------------------------------------------

const money = (amount: number) => `${Math.round(amount).toLocaleString("ru-RU")} ₽`;

export function describeAction(action: ProposedAction, label?: string): string {
  const what = label ? ` «${label}»` : "";
  switch (action.type) {
    case "pause":
    case "resume": {
      const noun = action.target === "campaign" ? "Кампания" : action.target === "ad" ? `Объявление${what}` : `Фраза${what}`;
      const verb = action.type === "pause" ? "остановлен" : "запущен";
      return `${noun} ${verb}${action.target === "ad" ? "о" : "а"}`;
    }
    case "set_budget":
      return `Дневной бюджет изменён на ${money(action.amount)}`;
    case "set_bid":
      return `Ставка фразы${what} изменена на ${money(action.amount)}`;
    case "add_negatives":
      return `Добавлены минус-фразы: ${action.phrases.join(", ")}`;
    case "exclude_placements":
      return `Запрещены показы на площадках: ${action.sites.join(", ")}`;
  }
}

function requireWrite(config: AdsConfig) {
  if (!config.writeEnabled) {
    throw new ActionError("Кабинет работает в режиме «только чтение». Чтобы разрешить изменения, задайте ADS_ALLOW_WRITE=1.", 403);
  }
}

async function record(config: AdsConfig, entry: Omit<ActionLogEntry, "id" | "at" | "ok" | "error">, run: () => Promise<void>) {
  const result: ActionLogEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    ok: true,
  };
  try {
    await run();
  } catch (e) {
    result.ok = false;
    result.error = e instanceof Error ? e.message : String(e);
  }
  await appendLog(config.dataDir, result);
  return result;
}

/** Ищет кампанию в уже загруженных данных кабинета, чтобы не строить ради неё новый отчёт. */
async function findCampaign(config: AdsConfig, account: Account, campaignId: string): Promise<CampaignStats | undefined> {
  for (const [key, entry] of cache) {
    if (!key.startsWith(`data:${account.id}:campaigns:`)) continue;
    const snapshot = (await entry.data.catch(() => null)) as Snapshot | null;
    const found = snapshot?.campaigns.find((c) => c.id === campaignId);
    if (found) return found;
  }
  const p = periods(1);
  const settings = await getSettings(config.dataDir, account.id);
  const snapshot = await fetchSnapshot(config, account, settings, p.from, p.to);
  return snapshot.campaigns.find((c) => c.id === campaignId);
}

export async function applyAction(req: ActionRequest, config: AdsConfig = loadConfig()): Promise<ActionLogEntry> {
  requireWrite(config);
  const account = await findAccount(config, req.accountId);
  const campaign = await findCampaign(config, account, req.campaignId);
  if (!campaign) throw new ActionError("Кампания не найдена", 404);

  const { action } = req;
  if (action.type === "set_budget" && !campaign.budgetEditable) {
    throw new ActionError("У этой кампании дневной бюджет через API не меняется (автостратегия)", 400);
  }
  const provider = providerFor(config, account);
  const state = action.type === "pause" ? "paused" : "active";

  const entry = await record(
    config,
    { accountName: account.name, campaignName: campaign.name, description: describeAction(action, req.label) },
    () => {
      switch (action.type) {
        case "pause":
        case "resume":
          if (action.target === "campaign") return provider.setCampaignState(campaign.id, state);
          if (action.target === "ad") return provider.setAdState(action.id, state);
          return provider.setKeywordState(action.id, state);
        case "set_budget":
          return provider.setDailyBudget(campaign.id, action.amount);
        case "set_bid":
          return provider.setKeywordBid(action.keywordId, action.amount);
        case "add_negatives":
          return provider.addNegativeKeywords(campaign.id, action.phrases);
        case "exclude_placements":
          return provider.excludePlacements(campaign.id, action.sites);
      }
    },
  );
  invalidate(account.id);
  return entry;
}

// --- создание кампаний --------------------------------------------------------------

/** Создаёт кампанию по плану. Объявления остаются черновиками: расход начнётся только после модерации. */
export async function createCampaign(plan: CampaignPlan, config: AdsConfig = loadConfig()): Promise<CreateResult> {
  requireWrite(config);
  const issues = validatePlan(plan);
  if (issues.length) {
    throw new ActionError(`План не прошёл проверку: ${issues.map((i) => i.message).join("; ")}`, 400);
  }
  const account = await findAccount(config, plan.accountId);
  let result: CreateResult = { ok: false, steps: [], adIds: [] };
  await record(config, { accountName: account.name, campaignName: plan.name, description: "Создана кампания (черновик)" }, async () => {
    result = await providerFor(config, account).createCampaign(plan);
    if (!result.ok) {
      const failed = result.steps.find((s) => !s.ok);
      throw new Error(failed ? `${failed.step}: ${failed.detail}` : "Кампания создана не полностью");
    }
  });
  invalidate(account.id);
  return result;
}

export async function sendToModeration(
  accountId: string,
  campaignName: string,
  adIds: string[],
  config: AdsConfig = loadConfig(),
): Promise<ActionLogEntry> {
  requireWrite(config);
  const account = await findAccount(config, accountId);
  const entry = await record(
    config,
    { accountName: account.name, campaignName, description: `Объявления отправлены на модерацию: ${adIds.length} шт.` },
    () => providerFor(config, account).sendToModeration(adIds),
  );
  invalidate(account.id);
  return entry;
}
