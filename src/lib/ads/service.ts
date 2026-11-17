import { analyzeAccount } from "./insights.ts";
import { eachDay, periods, sum, sumRange, todayMoscow, ZERO } from "./metrics.ts";
import { createDemoProvider, DEMO_ACCOUNTS } from "./providers/demo.ts";
import type { AdsProvider } from "./providers/provider.ts";
import { createYandexDirectProvider } from "./providers/yandex-direct.ts";
import type {
  AccountConfig,
  AccountView,
  ActionLogEntry,
  ActionRequest,
  CampaignStats,
  DailyPoint,
  Insight,
  Overview,
  ProposedAction,
} from "./types.ts";

// --- конфигурация -----------------------------------------------------------

export interface AdsConfig {
  mode: "demo" | "live";
  accounts: AccountConfig[];
  writeEnabled: boolean;
}

/**
 * Кабинеты описываются переменной ADS_ACCOUNTS (JSON-массив). Токены в неё не пишутся:
 * у каждого кабинета указывается tokenEnv — имя переменной с токеном.
 * Без ADS_ACCOUNTS кабинет работает на демо-данных.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AdsConfig {
  const raw = env.ADS_ACCOUNTS?.trim();
  if (!raw) return { mode: "demo", accounts: DEMO_ACCOUNTS, writeEnabled: true };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("ADS_ACCOUNTS: не удалось разобрать JSON");
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("ADS_ACCOUNTS: ожидается непустой массив кабинетов");
  }
  const seen = new Set<string>();
  const accounts = parsed.map((item, i): AccountConfig => {
    const a = item as Partial<AccountConfig>;
    if (!a.id || !a.name) throw new Error(`ADS_ACCOUNTS[${i}]: нужны поля id и name`);
    if (seen.has(a.id)) throw new Error(`ADS_ACCOUNTS: повторяется id «${a.id}»`);
    seen.add(a.id);
    const platform = a.platform ?? "yandex_direct";
    if (platform !== "yandex_direct") {
      throw new Error(`ADS_ACCOUNTS[${i}]: площадка «${platform}» пока не поддерживается`);
    }
    if (!a.tokenEnv) throw new Error(`ADS_ACCOUNTS[${i}]: укажите tokenEnv — имя переменной с токеном`);
    return { id: a.id, name: a.name, platform, login: a.login, tokenEnv: a.tokenEnv, sandbox: a.sandbox };
  });
  // Изменения в боевых кабинетах выключены, пока их явно не разрешили.
  return { mode: "live", accounts, writeEnabled: env.ADS_ALLOW_WRITE === "1" };
}

function providerFor(config: AdsConfig, account: AccountConfig, today?: string): AdsProvider {
  if (config.mode === "demo") return createDemoProvider(account.id, today);
  const token = process.env[account.tokenEnv!];
  if (!token) throw new Error(`Не задана переменная ${account.tokenEnv} с токеном`);
  return createYandexDirectProvider({ token, login: account.login, sandbox: account.sandbox });
}

// --- состояние процесса: кеш ответов API и журнал действий -------------------

interface Snapshot {
  currency: string;
  campaigns: CampaignStats[];
}

const store = globalThis as typeof globalThis & {
  __adsCache?: Map<string, { at: number; data: Promise<Snapshot> }>;
  __adsLog?: ActionLogEntry[];
};
const cache: Map<string, { at: number; data: Promise<Snapshot> }> = (store.__adsCache ??= new Map());
const log: ActionLogEntry[] = (store.__adsLog ??= []);

// Отчёты Директа расходуют баллы и строятся не мгновенно — не дёргаем API на каждое обновление страницы.
const CACHE_TTL_MS = 5 * 60 * 1000;

function fetchSnapshot(
  config: AdsConfig,
  account: AccountConfig,
  from: string,
  to: string,
  today?: string,
): Promise<Snapshot> {
  if (config.mode === "demo") return providerFor(config, account, today).fetchCampaigns(from, to);
  const key = `${account.id}:${from}:${to}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.data;
  const data = Promise.resolve().then(() => providerFor(config, account).fetchCampaigns(from, to));
  cache.set(key, { at: Date.now(), data });
  data.catch(() => cache.delete(key));
  return data;
}

function invalidate(accountId: string) {
  for (const key of cache.keys()) if (key.startsWith(`${accountId}:`)) cache.delete(key);
}

// --- сводка -----------------------------------------------------------------

export function buildAccountView(
  account: AccountConfig,
  snapshot: Snapshot,
  p: { from: string; to: string; prevFrom: string; prevTo: string },
): AccountView {
  const campaigns = snapshot.campaigns
    .map((c) => {
      const { daily, ...campaign } = c;
      return {
        ...campaign,
        current: sumRange(daily, p.from, p.to),
        previous: sumRange(daily, p.prevFrom, p.prevTo),
      };
    })
    .sort((a, b) => b.current.cost - a.current.cost);
  return {
    id: account.id,
    name: account.name,
    platform: account.platform,
    currency: snapshot.currency,
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

  const results = await Promise.all(
    config.accounts.map(async (account) => {
      try {
        return { account, snapshot: await fetchSnapshot(config, account, p.prevFrom, p.to, today) };
      } catch (e) {
        return { account, error: e instanceof Error ? e.message : String(e) };
      }
    }),
  );

  const accounts: AccountView[] = [];
  const insights: Insight[] = [];
  const dailyTotals = new Map<string, DailyPoint>(
    eachDay(p.from, p.to).map((date) => [date, { date, ...ZERO }]),
  );

  for (const r of results) {
    if (!("snapshot" in r) || !r.snapshot) {
      accounts.push({
        id: r.account.id,
        name: r.account.name,
        platform: r.account.platform,
        currency: "RUB",
        current: ZERO,
        previous: ZERO,
        campaigns: [],
        error: r.error,
      });
      continue;
    }
    const view = buildAccountView(r.account, r.snapshot, p);
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
    totals: {
      current: sum(accounts.map((a) => a.current)),
      previous: sum(accounts.map((a) => a.previous)),
    },
    daily: [...dailyTotals.values()],
    accounts,
    insights,
    log: log.slice(0, 20),
  };
}

// --- действия ---------------------------------------------------------------

/** Ищет кампанию в уже загруженных данных кабинета, чтобы не строить ради неё новый отчёт. */
async function findCampaign(config: AdsConfig, account: AccountConfig, campaignId: string) {
  for (const [key, entry] of cache) {
    if (!key.startsWith(`${account.id}:`)) continue;
    const found = (await entry.data.catch(() => null))?.campaigns.find((c) => c.id === campaignId);
    if (found) return found;
  }
  const p = periods(1);
  const snapshot = await fetchSnapshot(config, account, p.from, p.to);
  return snapshot.campaigns.find((c) => c.id === campaignId);
}

export function describeAction(action: ProposedAction): string {
  switch (action.type) {
    case "pause":
      return "Кампания остановлена";
    case "resume":
      return "Кампания запущена";
    case "set_budget":
      return `Дневной бюджет изменён на ${Math.round(action.amount).toLocaleString("ru-RU")} ₽`;
  }
}

export class ActionError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ActionError";
    this.status = status;
  }
}

export async function applyAction(req: ActionRequest, config: AdsConfig = loadConfig()): Promise<ActionLogEntry> {
  if (!config.writeEnabled) {
    throw new ActionError("Кабинет работает в режиме «только чтение». Чтобы разрешить изменения, задайте ADS_ALLOW_WRITE=1.", 403);
  }
  const account = config.accounts.find((a) => a.id === req.accountId);
  if (!account) throw new ActionError("Кабинет не найден", 404);

  const provider = providerFor(config, account);
  const campaign = await findCampaign(config, account, req.campaignId);
  if (!campaign) throw new ActionError("Кампания не найдена", 404);
  if (req.action.type === "set_budget" && !campaign.budgetEditable) {
    throw new ActionError("У этой кампании дневной бюджет через API не меняется (автостратегия)", 400);
  }

  const entry: ActionLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    accountName: account.name,
    campaignName: campaign.name,
    description: describeAction(req.action),
    ok: true,
  };
  try {
    if (req.action.type === "set_budget") await provider.setDailyBudget(campaign.id, req.action.amount);
    else await provider.setCampaignState(campaign.id, req.action.type === "pause" ? "paused" : "active");
  } catch (e) {
    entry.ok = false;
    entry.error = e instanceof Error ? e.message : String(e);
  }
  invalidate(account.id);
  log.unshift(entry);
  log.length = Math.min(log.length, 200);
  return entry;
}
