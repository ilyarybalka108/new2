import { todayMoscow } from "../metrics.ts";
import type {
  Account,
  BreakdownLevel,
  BreakdownRow,
  CampaignPlan,
  CampaignStats,
  CreateResult,
  DailyPoint,
  EntityState,
  Metrics,
} from "../types.ts";
import type { AdsProvider, StatsOptions } from "./provider.ts";

// Клиент API Яндекс Директа (JSON). Структуры запросов сверены с официальным справочником
// (yandex.ru/dev/direct/doc). На боевом кабинете клиент ещё не запускался: первый запуск
// с настоящим токеном нужно делать в режиме «только чтение».

const HOST = "https://api.direct.yandex.com";
const MICROS = 1_000_000;
const REPORT_MAX_WAIT_MS = 180_000;
/** API допускает не более пяти одновременных запросов от одного рекламодателя. */
const MAX_PARALLEL = 4;

export class DirectApiError extends Error {
  readonly code: number | null;
  readonly requestId: string | null;

  constructor(message: string, code: number | null = null, requestId: string | null = null) {
    super(message);
    this.name = "DirectApiError";
    this.code = code;
    this.requestId = requestId;
  }
}

export interface DirectOptions {
  token: string;
  /** Логин клиента агентства (заголовок Client-Login). Пусто — собственный аккаунт. */
  login?: string;
  /**
   * Версия API для кампаний, групп, объявлений и фраз. Единые перфоманс-кампании
   * доступны только по адресу v501; v5 оставлена для совместимости.
   */
  apiVersion?: "v5" | "v501";
  fetchImpl?: typeof fetch;
  /** Подменяется в тестах, чтобы не ждать по-настоящему. */
  sleep?: (ms: number) => Promise<void>;
}

interface ActionResult {
  Id?: number;
  Errors?: { Code: number; Message: string; Details?: string }[];
}

type Json = Record<string, unknown>;

const STATE_MAP: Record<string, EntityState> = {
  ON: "active",
  SUSPENDED: "paused",
  OFF: "inactive",
  OFF_BY_MONITORING: "inactive",
  ENDED: "ended",
  ARCHIVED: "archived",
};

export function mapState(state: string | undefined): EntityState {
  return (state && STATE_MAP[state]) || "unknown";
}

/**
 * Разбор TSV-отчёта Директа: первая строка — названия колонок, дальше данные.
 * Отсутствующее значение Директ пишет как «--».
 */
export function parseReportTsv(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row: Record<string, string> = {};
    header.forEach((name, i) => (row[name] = cells[i] ?? ""));
    return row;
  });
}

function num(value: string | undefined): number {
  if (!value || value === "--") return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Метрики строки отчёта. Если в запросе заданы цели, вместо колонки Conversions
 * приходят колонки вида Conversions_<цель>_<модель> — складываем их все.
 */
export function rowMetrics(row: Record<string, string>): Metrics {
  let conversions = 0;
  for (const [name, value] of Object.entries(row)) {
    if (name === "Conversions" || name.startsWith("Conversions_")) conversions += num(value);
  }
  return { impressions: num(row.Impressions), clicks: num(row.Clicks), cost: num(row.Cost), conversions };
}

/** Группирует строки отчёта «день × кампания» в статистику по кампаниям. */
export function groupReportRows(rows: Record<string, string>[]): Map<string, DailyPoint[]> {
  const byCampaign = new Map<string, DailyPoint[]>();
  for (const row of rows) {
    const id = row.CampaignId;
    if (!id) continue;
    const list = byCampaign.get(id) ?? [];
    list.push({ date: row.Date, ...rowMetrics(row) });
    byCampaign.set(id, list);
  }
  for (const list of byCampaign.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return byCampaign;
}

/** Складывает строки отчёта по ключу: один запрос или площадка могут прийти несколькими строками. */
function aggregate(rows: Record<string, string>[], keyField: string): Map<string, Metrics & { row: Record<string, string> }> {
  const out = new Map<string, Metrics & { row: Record<string, string> }>();
  for (const row of rows) {
    const key = row[keyField];
    if (!key || key === "--") continue;
    const m = rowMetrics(row);
    const prev = out.get(key);
    if (prev) {
      prev.impressions += m.impressions;
      prev.clicks += m.clicks;
      prev.cost += m.cost;
      prev.conversions += m.conversions;
    } else {
      out.set(key, { ...m, row });
    }
  }
  return out;
}

/** Только метрики, без служебных полей; нули — если по объекту не было показов. */
function pick(m: Metrics | undefined): Metrics {
  return {
    impressions: m?.impressions ?? 0,
    clicks: m?.clicks ?? 0,
    cost: m?.cost ?? 0,
    conversions: m?.conversions ?? 0,
  };
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const toMicros = (amount: number) => Math.round(amount * MICROS);

/** Ищет недельный бюджет в структуре стратегии, как бы ни называлась вложенная стратегия. */
function findWeeklyLimit(strategy: unknown): number | null {
  if (!strategy || typeof strategy !== "object") return null;
  for (const value of Object.values(strategy as Json)) {
    if (value && typeof value === "object") {
      const limit = (value as Json).WeeklySpendLimit;
      if (typeof limit === "number" && limit > 0) return limit / MICROS;
    }
  }
  return null;
}

/** Структура BiddingStrategy для единой перфоманс-кампании по плану. */
export function buildBiddingStrategy(plan: Pick<CampaignPlan, "strategy" | "weeklyBudget" | "goalId" | "averageCpa" | "placement">) {
  const WeeklySpendLimit = toMicros(plan.weeklyBudget);
  const GoalId = Number(plan.goalId);
  const core =
    plan.strategy === "max_clicks"
      ? { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit } }
      : plan.strategy === "max_conversions"
        ? { BiddingStrategyType: "WB_MAXIMUM_CONVERSION_RATE", WbMaximumConversionRate: { WeeklySpendLimit, GoalId } }
        : {
            BiddingStrategyType: "AVERAGE_CPA",
            AverageCpa: { AverageCpa: toMicros(plan.averageCpa ?? 0), GoalId, WeeklySpendLimit },
          };
  const off = { BiddingStrategyType: "SERVING_OFF" };
  if (plan.placement === "search") return { Search: core, Network: off };
  if (plan.placement === "network") return { Search: off, Network: core };
  // NETWORK_DEFAULT — показы в сетях идут по стратегии, заданной для поиска.
  return { Search: core, Network: { BiddingStrategyType: "NETWORK_DEFAULT" } };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Низкоуровневый клиент: авторизация, ограничение параллельности, отчёты. */
export function createDirectClient(opts: DirectOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const version = opts.apiVersion ?? "v501";

  let running = 0;
  const waiting: (() => void)[] = [];
  async function limited<T>(task: () => Promise<T>): Promise<T> {
    if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
    running += 1;
    try {
      return await task();
    } finally {
      running -= 1;
      waiting.shift()?.();
    }
  }

  function headers(extra: Record<string, string> = {}, withLogin = true): Record<string, string> {
    return {
      Authorization: `Bearer ${opts.token}`,
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
      ...(withLogin && opts.login ? { "Client-Login": opts.login } : {}),
      ...extra,
    };
  }

  function toError(body: unknown, status: number): DirectApiError {
    const e = (body as { error?: Json } | null)?.error;
    if (!e) return new DirectApiError(`API Директа ответил HTTP ${status}`);
    const text = [e.error_string, e.error_detail].filter(Boolean).join(": ");
    return new DirectApiError(
      `${text || "Ошибка API Директа"} (код ${e.error_code})`,
      Number(e.error_code) || null,
      (e.request_id as string) ?? null,
    );
  }

  /** Вызов метода сервиса. `withLogin: false` — для сервисов, где Client-Login указывать нельзя. */
  function call<T>(service: string, method: string, params: unknown, callOpts: { withLogin?: boolean; version?: string } = {}): Promise<T> {
    return limited(async () => {
      const res = await doFetch(`${HOST}/json/${callOpts.version ?? version}/${service}`, {
        method: "POST",
        headers: headers({}, callOpts.withLogin ?? true),
        body: JSON.stringify({ method, params }),
      });
      const body = (await res.json().catch(() => null)) as { result?: T; error?: unknown } | null;
      if (!res.ok || !body || body.error || body.result === undefined) throw toError(body, res.status);
      return body.result;
    });
  }

  /** Постранично читает все объекты метода get. */
  async function getAll<T>(service: string, params: Json, key: string): Promise<T[]> {
    const out: T[] = [];
    const limit = 10_000;
    for (let offset = 0; ; offset += limit) {
      const result = await call<Json>(service, "get", { ...params, Page: { Limit: limit, Offset: offset } });
      out.push(...((result[key] as T[] | undefined) ?? []));
      if (result.LimitedBy === undefined) return out;
    }
  }

  interface ReportSpec {
    type: string;
    fields: string[];
    from: string;
    to: string;
    filter?: { Field: string; Operator: string; Values: string[] }[];
    /** Оставить только самые затратные строки. */
    topByCost?: number;
    stats?: StatsOptions;
  }

  function report(spec: ReportSpec): Promise<Record<string, string>[]> {
    const params: Json = {
      SelectionCriteria: { DateFrom: spec.from, DateTo: spec.to, ...(spec.filter ? { Filter: spec.filter } : {}) },
      ...(spec.stats?.goals?.length ? { Goals: spec.stats.goals } : {}),
      ...(spec.stats?.attribution ? { AttributionModels: [spec.stats.attribution] } : {}),
      FieldNames: spec.fields,
      ...(spec.topByCost ? { Page: { Limit: spec.topByCost }, OrderBy: [{ Field: "Cost", SortOrder: "DESCENDING" }] } : {}),
      ReportType: spec.type,
      DateRangeType: "CUSTOM_DATE",
      Format: "TSV",
      IncludeVAT: "YES",
    };
    // В офлайн-режиме имя однозначно определяет отчёт: одно имя с другими параметрами — ошибка API.
    params.ReportName = `cabinet_${spec.type}_${hash(JSON.stringify(params))}`;
    const body = JSON.stringify({ params });

    return limited(async () => {
      const started = Date.now();
      for (;;) {
        const res = await doFetch(`${HOST}/json/v5/reports`, {
          method: "POST",
          headers: headers({
            processingMode: "auto",
            returnMoneyInMicros: "false",
            skipReportHeader: "true",
            skipReportSummary: "true",
          }),
          body,
        });
        if (res.status === 200) return parseReportTsv(await res.text());
        // 201 — отчёт поставлен в очередь, 202 — ещё формируется: повторяем тот же запрос.
        if (res.status === 201 || res.status === 202) {
          if (Date.now() - started > REPORT_MAX_WAIT_MS) {
            throw new DirectApiError("Отчёт Директа формируется слишком долго, попробуйте позже");
          }
          const retryIn = Number(res.headers.get("retryIn")) || 5;
          await sleep(Math.min(retryIn, 30) * 1000);
          continue;
        }
        throw toError(await res.json().catch(() => null), res.status);
      }
    });
  }

  return { call, getAll, report, version };
}

/**
 * Список кабинетов, доступных владельцу токена. Для агентства — его клиенты;
 * если токен не агентский, единственный кабинет — собственный аккаунт.
 */
export async function discoverAccounts(opts: Omit<DirectOptions, "login">): Promise<Account[]> {
  const client = createDirectClient(opts);
  try {
    // В запросах к AgencyClients заголовок Client-Login указывать нельзя.
    const out: Account[] = [];
    const limit = 2000;
    for (let offset = 0; ; offset += limit) {
      const result = await client.call<{ Clients?: { Login: string; ClientInfo?: string }[]; LimitedBy?: number }>(
        "agencyclients",
        "get",
        { SelectionCriteria: { Archived: "NO" }, FieldNames: ["Login", "ClientInfo"], Page: { Limit: limit, Offset: offset } },
        { withLogin: false, version: "v5" },
      );
      for (const c of result.Clients ?? []) {
        out.push({ id: c.Login, name: c.ClientInfo?.trim() || c.Login, platform: "yandex_direct", login: c.Login });
      }
      if (result.LimitedBy === undefined) break;
    }
    if (out.length > 0) return out;
  } catch (e) {
    if (!(e instanceof DirectApiError)) throw e;
    // Не агентство или нет доступа к сервису — пробуем как обычного рекламодателя.
  }
  const own = await client.call<{ Clients?: { Login: string; ClientInfo?: string }[] }>(
    "clients",
    "get",
    { FieldNames: ["Login", "ClientInfo"] },
    { withLogin: false, version: "v5" },
  );
  const me = own.Clients?.[0];
  if (!me) throw new DirectApiError("Не удалось определить аккаунт владельца токена");
  return [{ id: me.Login, name: me.ClientInfo?.trim() || me.Login, platform: "yandex_direct" }];
}

interface ApiCampaign {
  Id: number;
  Name: string;
  State?: string;
  Type?: string;
  Currency?: string;
  DailyBudget?: { Amount: number; Mode: string } | null;
  NegativeKeywords?: { Items?: string[] } | null;
  ExcludedSites?: { Items?: string[] } | null;
  TextCampaign?: { BiddingStrategy?: Json };
  UnifiedCampaign?: { BiddingStrategy?: Json };
}

const METRIC_FIELDS = ["Impressions", "Clicks", "Cost", "Conversions"];

export function createYandexDirectProvider(opts: DirectOptions): AdsProvider {
  const client = createDirectClient(opts);
  const { call, getAll, report } = client;

  function campaignRequest(extra: Json): Json {
    return {
      ...extra,
      TextCampaignFieldNames: ["BiddingStrategy"],
      // Поля единой перфоманс-кампании есть только в v501.
      ...(client.version === "v501" ? { UnifiedCampaignFieldNames: ["BiddingStrategy"] } : {}),
    };
  }

  const campaignFilter = (campaignId: string) => [{ Field: "CampaignId", Operator: "EQUALS", Values: [campaignId] }];

  function assertOk(results: ActionResult[] | undefined, what: string) {
    const failed = results?.find((r) => r.Errors?.length);
    if (failed) {
      const e = failed.Errors![0];
      throw new DirectApiError(`${what}: ${[e.Message, e.Details].filter(Boolean).join(": ")} (код ${e.Code})`, e.Code);
    }
  }

  async function groupNames(campaignId: string): Promise<Map<string, string>> {
    const groups = await getAll<{ Id: number; Name: string }>(
      "adgroups",
      { SelectionCriteria: { CampaignIds: [Number(campaignId)] }, FieldNames: ["Id", "Name"] },
      "AdGroups",
    );
    return new Map(groups.map((g) => [String(g.Id), g.Name]));
  }

  /** Дописывает значения к списку на уровне кампании (минус-фразы, исключённые площадки). */
  async function appendToCampaignList(campaignId: string, field: "NegativeKeywords" | "ExcludedSites", items: string[]) {
    const [current] = await getAll<ApiCampaign>(
      "campaigns",
      { SelectionCriteria: { Ids: [Number(campaignId)] }, FieldNames: ["Id", field] },
      "Campaigns",
    );
    if (!current) throw new DirectApiError("Кампания не найдена");
    const existing = current[field]?.Items ?? [];
    const known = new Set(existing.map((x) => x.toLowerCase()));
    const merged = [...existing, ...items.filter((x) => !known.has(x.toLowerCase()))];
    const result = await call<{ UpdateResults?: ActionResult[] }>("campaigns", "update", {
      Campaigns: [{ Id: Number(campaignId), [field]: { Items: merged } }],
    });
    assertOk(result.UpdateResults, "Не удалось обновить кампанию");
  }

  async function switchState(service: string, id: string, state: "active" | "paused", what: string) {
    const method = state === "paused" ? "suspend" : "resume";
    const result = await call<{ SuspendResults?: ActionResult[]; ResumeResults?: ActionResult[] }>(service, method, {
      SelectionCriteria: { Ids: [Number(id)] },
    });
    assertOk(result.SuspendResults ?? result.ResumeResults, what);
  }

  return {
    async fetchCampaigns(from, to, stats) {
      const [campaigns, rows] = await Promise.all([
        getAll<ApiCampaign>(
          "campaigns",
          campaignRequest({
            SelectionCriteria: { States: ["ON", "OFF", "SUSPENDED", "ENDED"] },
            FieldNames: ["Id", "Name", "State", "Type", "Currency", "DailyBudget"],
          }),
          "Campaigns",
        ),
        report({ type: "CAMPAIGN_PERFORMANCE_REPORT", fields: ["Date", "CampaignId", ...METRIC_FIELDS], from, to, stats }),
      ]);
      const byCampaign = groupReportRows(rows);
      const result: CampaignStats[] = campaigns.map((c) => {
        const strategy = c.UnifiedCampaign?.BiddingStrategy ?? c.TextCampaign?.BiddingStrategy;
        const search = strategy?.Search as Json | undefined;
        const network = strategy?.Network as Json | undefined;
        const searchType = search?.BiddingStrategyType as string | undefined;
        return {
          id: String(c.Id),
          name: c.Name,
          state: mapState(c.State),
          kind: c.Type ?? null,
          dailyBudget: c.DailyBudget ? c.DailyBudget.Amount / MICROS : null,
          // Дневной бюджет в Директе доступен только при ручной стратегии. Чтобы не слать
          // заведомо ошибочные запросы, меняем его лишь там, где он уже задан.
          budgetEditable: Boolean(c.DailyBudget),
          strategy: (searchType && searchType !== "SERVING_OFF" ? searchType : (network?.BiddingStrategyType as string)) ?? null,
          weeklyBudget: findWeeklyLimit(search) ?? findWeeklyLimit(network),
          daily: byCampaign.get(String(c.Id)) ?? [],
        };
      });
      return { currency: campaigns.find((c) => c.Currency)?.Currency ?? "RUB", campaigns: result };
    },

    async fetchBreakdown(campaignId, level: BreakdownLevel, from, to, stats): Promise<BreakdownRow[]> {
      const id = Number(campaignId);
      const filter = campaignFilter(campaignId);

      if (level === "groups") {
        const [groups, rows] = await Promise.all([
          groupNames(campaignId),
          report({ type: "ADGROUP_PERFORMANCE_REPORT", fields: ["AdGroupId", ...METRIC_FIELDS], from, to, filter, stats }),
        ]);
        const byId = aggregate(rows, "AdGroupId");
        return [...groups].map(([key, label]) => ({ key, label, ...pick(byId.get(key)) }));
      }

      if (level === "ads") {
        const [groups, ads, rows] = await Promise.all([
          groupNames(campaignId),
          getAll<{ Id: number; AdGroupId: number; State?: string; Type?: string; TextAd?: { Title?: string; Title2?: string; Text?: string } }>(
            "ads",
            {
              SelectionCriteria: { CampaignIds: [id], States: ["ON", "OFF", "SUSPENDED", "OFF_BY_MONITORING"] },
              FieldNames: ["Id", "AdGroupId", "State", "Type"],
              TextAdFieldNames: ["Title", "Title2", "Text"],
            },
            "Ads",
          ),
          report({ type: "AD_PERFORMANCE_REPORT", fields: ["AdId", ...METRIC_FIELDS], from, to, filter, stats }),
        ]);
        const byId = aggregate(rows, "AdId");
        return ads.map((ad) => {
          const key = String(ad.Id);
          const groupId = String(ad.AdGroupId);
          return {
            key,
            label: ad.TextAd?.Title ? [ad.TextAd.Title, ad.TextAd.Title2].filter(Boolean).join(" — ") : `${ad.Type ?? "Объявление"} №${key}`,
            sublabel: ad.TextAd?.Text,
            state: mapState(ad.State),
            groupId,
            groupName: groups.get(groupId),
            ...pick(byId.get(key)),
          };
        });
      }

      if (level === "keywords") {
        const [groups, keywords, rows] = await Promise.all([
          groupNames(campaignId),
          getAll<{ Id: number; Keyword: string; AdGroupId: number; State?: string; Bid?: number }>(
            "keywords",
            { SelectionCriteria: { CampaignIds: [id] }, FieldNames: ["Id", "Keyword", "AdGroupId", "State", "Bid"] },
            "Keywords",
          ),
          report({ type: "CRITERIA_PERFORMANCE_REPORT", fields: ["CriterionId", ...METRIC_FIELDS], from, to, filter, stats }),
        ]);
        const byId = aggregate(rows, "CriterionId");
        return keywords.map((k) => {
          const key = String(k.Id);
          const groupId = String(k.AdGroupId);
          return {
            key,
            label: k.Keyword === "---autotargeting" ? "Автотаргетинг" : k.Keyword,
            state: mapState(k.State),
            groupId,
            groupName: groups.get(groupId),
            bid: k.Bid ? k.Bid / MICROS : null,
            ...pick(byId.get(key)),
          };
        });
      }

      if (level === "queries") {
        // Отчёт по поисковым запросам формируется только в офлайн-режиме и может занять минуты.
        const rows = await report({
          type: "SEARCH_QUERY_PERFORMANCE_REPORT",
          fields: ["Query", "AdGroupName", ...METRIC_FIELDS],
          from,
          to,
          filter,
          topByCost: 1000,
          stats,
        });
        return [...aggregate(rows, "Query")].map(([key, m]) => ({ key, label: key, groupName: m.row.AdGroupName, ...pick(m) }));
      }

      const rows = await report({
        type: "CAMPAIGN_PERFORMANCE_REPORT",
        fields: ["Placement", ...METRIC_FIELDS],
        from,
        to,
        filter: [...filter, { Field: "AdNetworkType", Operator: "EQUALS", Values: ["AD_NETWORK"] }],
        topByCost: 1000,
        stats,
      });
      return [...aggregate(rows, "Placement")].map(([key, m]) => ({ key, label: key, ...pick(m) }));
    },

    async fetchExclusions(campaignId) {
      const [c] = await getAll<ApiCampaign>(
        "campaigns",
        { SelectionCriteria: { Ids: [Number(campaignId)] }, FieldNames: ["Id", "NegativeKeywords", "ExcludedSites"] },
        "Campaigns",
      );
      return { negativeKeywords: c?.NegativeKeywords?.Items ?? [], excludedSites: c?.ExcludedSites?.Items ?? [] };
    },

    setCampaignState: (campaignId, state) =>
      switchState("campaigns", campaignId, state, state === "paused" ? "Не удалось остановить кампанию" : "Не удалось запустить кампанию"),

    async setDailyBudget(campaignId, amount) {
      // Mode — обязательное поле; сохраняем текущий режим кампании.
      const [current] = await getAll<ApiCampaign>(
        "campaigns",
        { SelectionCriteria: { Ids: [Number(campaignId)] }, FieldNames: ["Id", "DailyBudget"] },
        "Campaigns",
      );
      const mode = current?.DailyBudget?.Mode ?? "STANDARD";
      const result = await call<{ UpdateResults?: ActionResult[] }>("campaigns", "update", {
        Campaigns: [{ Id: Number(campaignId), DailyBudget: { Amount: toMicros(amount), Mode: mode } }],
      });
      assertOk(result.UpdateResults, "Не удалось изменить бюджет");
    },

    setAdState: (adId, state) =>
      switchState("ads", adId, state, state === "paused" ? "Не удалось остановить объявление" : "Не удалось запустить объявление"),

    setKeywordState: (keywordId, state) =>
      switchState("keywords", keywordId, state, state === "paused" ? "Не удалось остановить фразу" : "Не удалось запустить фразу"),

    async setKeywordBid(keywordId, amount) {
      const result = await call<{ SetResults?: ActionResult[] }>("keywordbids", "set", {
        KeywordBids: [{ KeywordId: Number(keywordId), SearchBid: toMicros(amount) }],
      });
      assertOk(result.SetResults, "Не удалось изменить ставку");
    },

    addNegativeKeywords: (campaignId, phrases) => appendToCampaignList(campaignId, "NegativeKeywords", phrases),
    excludePlacements: (campaignId, sites) => appendToCampaignList(campaignId, "ExcludedSites", sites),

    async createCampaign(plan): Promise<CreateResult> {
      // Единая перфоманс-кампания создаётся только по адресу v501.
      const v = { version: "v501" };
      const steps: CreateResult["steps"] = [];
      const adIds: string[] = [];
      const describe = (results: ActionResult[] | undefined, total: number) => {
        const errors = (results ?? []).flatMap((r) => r.Errors ?? []);
        const created = (results ?? []).filter((r) => r.Id).length;
        const detail = errors.length
          ? `создано ${created} из ${total}; ${errors.map((e) => [e.Message, e.Details].filter(Boolean).join(": ")).join("; ")}`
          : `создано ${created}`;
        return { ok: errors.length === 0 && created === total, detail };
      };
      const fail = (step: string, e: unknown, campaignId?: string): CreateResult => {
        steps.push({ step, ok: false, detail: e instanceof Error ? e.message : String(e) });
        return { ok: false, campaignId, steps, adIds };
      };

      let campaignId: string;
      try {
        const result = await call<{ AddResults?: ActionResult[] }>(
          "campaigns",
          "add",
          {
            Campaigns: [
              {
                Name: plan.name,
                StartDate: todayMoscow(),
                ...(plan.negativeKeywords.length ? { NegativeKeywords: { Items: plan.negativeKeywords } } : {}),
                UnifiedCampaign: {
                  BiddingStrategy: buildBiddingStrategy(plan),
                  ...(plan.counterId ? { CounterIds: { Items: [Number(plan.counterId)] } } : {}),
                },
              },
            ],
          },
          v,
        );
        assertOk(result.AddResults, "Кампания не создана");
        const id = result.AddResults?.[0]?.Id;
        if (!id) throw new DirectApiError("API не вернул идентификатор кампании");
        campaignId = String(id);
        steps.push({ step: "Кампания", ok: true, detail: `создана, № ${campaignId}` });
      } catch (e) {
        return fail("Кампания", e);
      }

      let groupIds: (number | undefined)[];
      try {
        const result = await call<{ AddResults?: ActionResult[] }>(
          "adgroups",
          "add",
          {
            AdGroups: plan.groups.map((g) => ({
              Name: g.name,
              CampaignId: Number(campaignId),
              RegionIds: plan.regionIds,
              UnifiedAdGroup: { OfferRetargeting: "NO" },
            })),
          },
          v,
        );
        groupIds = (result.AddResults ?? []).map((r) => r.Id);
        steps.push({ step: "Группы", ...describe(result.AddResults, plan.groups.length) });
      } catch (e) {
        return fail("Группы", e, campaignId);
      }

      const keywords = plan.groups.flatMap((g, i) => (groupIds[i] ? g.keywords.map((Keyword) => ({ Keyword, AdGroupId: groupIds[i] })) : []));
      const ads = plan.groups.flatMap((g, i) =>
        groupIds[i]
          ? g.ads.map((ad) => ({
              AdGroupId: groupIds[i],
              TextAd: { Title: ad.title, ...(ad.title2 ? { Title2: ad.title2 } : {}), Text: ad.text, Href: ad.href, Mobile: "NO" },
            }))
          : [],
      );

      try {
        const results: ActionResult[] = [];
        for (const part of chunk(keywords, 1000)) {
          results.push(...((await call<{ AddResults?: ActionResult[] }>("keywords", "add", { Keywords: part }, v)).AddResults ?? []));
        }
        steps.push({ step: "Фразы", ...describe(results, keywords.length) });
      } catch (e) {
        return fail("Фразы", e, campaignId);
      }

      try {
        const results: ActionResult[] = [];
        for (const part of chunk(ads, 1000)) {
          results.push(...((await call<{ AddResults?: ActionResult[] }>("ads", "add", { Ads: part }, v)).AddResults ?? []));
        }
        adIds.push(...results.filter((r) => r.Id).map((r) => String(r.Id)));
        steps.push({ step: "Объявления", ...describe(results, ads.length) });
      } catch (e) {
        return fail("Объявления", e, campaignId);
      }

      return { ok: steps.every((s) => s.ok), campaignId, steps, adIds };
    },

    async sendToModeration(adIds) {
      for (const part of chunk(adIds, 1000)) {
        const result = await call<{ ModerateResults?: ActionResult[] }>("ads", "moderate", {
          SelectionCriteria: { Ids: part.map(Number) },
        });
        assertOk(result.ModerateResults, "Не удалось отправить на модерацию");
      }
    },
  };
}
