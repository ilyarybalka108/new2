import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { changeHistory, computePacing, DEFAULT_POLICY, judge, permissionFor, runDaily, startAdTest, zScore } from "../src/lib/ads/autopilot.ts";
import { loadConfig } from "../src/lib/ads/config.ts";
import { createCreative, listCreatives, readCreativeFile, uploadCreative } from "../src/lib/ads/creative-library.ts";
import { fitText, FORMATS, pngSize, readableOn, renderCreative, shade, textWidth } from "../src/lib/ads/creatives.ts";
import { isCoveredByNegatives } from "../src/lib/ads/insights.ts";
import { change, derive, eachDay, periods, sumRange } from "../src/lib/ads/metrics.ts";
import { countedWords, validatePlan } from "../src/lib/ads/plan.ts";
import { distribute, resetDemoState } from "../src/lib/ads/providers/demo.ts";
import {
  buildBiddingStrategy,
  createYandexDirectProvider,
  DirectApiError,
  discoverAccounts,
  groupReportRows,
  mapState,
  parseReportTsv,
  rowMetrics,
} from "../src/lib/ads/providers/yandex-direct.ts";
import {
  ActionError,
  applyAction,
  clearCache,
  createCampaign,
  getCampaignDetail,
  getOverview,
  updateSettings,
} from "../src/lib/ads/service.ts";
import { resetStore } from "../src/lib/ads/store.ts";
import type { CampaignPlan } from "../src/lib/ads/types.ts";

const DEMO = loadConfig({ ADS_DATA_DIR: "memory" });
const TODAY = "2026-11-17";

function reset() {
  resetDemoState();
  resetStore();
  clearCache();
}

// --- метрики ------------------------------------------------------------------

test("derive: неопределённые метрики равны null, а не 0 или Infinity", () => {
  assert.deepEqual(derive({ impressions: 0, clicks: 0, cost: 0, conversions: 0 }), { ctr: null, cpc: null, cpa: null, cr: null });
  const d = derive({ impressions: 1000, clicks: 50, cost: 2500, conversions: 5 });
  assert.deepEqual(d, { ctr: 0.05, cpc: 50, cpa: 500, cr: 0.1 });
});

test("change, periods, sumRange", () => {
  assert.equal(change(110, 100), 0.1);
  assert.equal(change(100, 0), null);
  assert.deepEqual(periods(7, "2026-11-17"), { from: "2026-11-10", to: "2026-11-16", prevFrom: "2026-11-03", prevTo: "2026-11-09" });
  assert.equal(eachDay("2026-02-27", "2026-03-01").length, 3);
  const day = (date: string) => ({ date, impressions: 1, clicks: 1, cost: 10, conversions: 0 });
  assert.equal(sumRange([day("2026-01-01"), day("2026-01-02"), day("2026-01-03")], "2026-01-02", "2026-01-03").cost, 20);
});

// --- конфигурация ---------------------------------------------------------------

test("loadConfig: демо без токена, боевой режим — только чтение, пока не разрешили", () => {
  assert.equal(loadConfig({}).mode, "demo");
  const live = loadConfig({ YD_TOKEN: "t" });
  assert.equal(live.mode, "live");
  assert.equal(live.writeEnabled, false);
  assert.equal(live.apiVersion, "v501");
  assert.equal(live.clientLogins, undefined);
  assert.equal(loadConfig({ YD_TOKEN: "t", ADS_ALLOW_WRITE: "1" }).writeEnabled, true);
  assert.deepEqual(loadConfig({ YD_TOKEN: "t", YD_CLIENT_LOGINS: " a, b ,," }).clientLogins, ["a", "b"]);
  assert.throws(() => loadConfig({ YD_TOKEN: "t", YD_API_VERSION: "v6" }), /v5 и v501/);
});

// --- разбор отчётов -------------------------------------------------------------

const TSV = [
  "Date\tCampaignId\tImpressions\tClicks\tCost\tConversions",
  "2026-11-10\t111\t1000\t50\t2500.50\t3",
  "2026-11-11\t111\t900\t40\t2000.00\t--",
  "2026-11-10\t222\t500\t5\t100.00\t--",
  "",
].join("\n");

test("parseReportTsv и groupReportRows: «--» читается как ноль", () => {
  const grouped = groupReportRows(parseReportTsv(TSV));
  assert.deepEqual(grouped.get("111"), [
    { date: "2026-11-10", impressions: 1000, clicks: 50, cost: 2500.5, conversions: 3 },
    { date: "2026-11-11", impressions: 900, clicks: 40, cost: 2000, conversions: 0 },
  ]);
  assert.deepEqual(parseReportTsv(""), []);
});

test("rowMetrics: при заданных целях конверсии складываются по колонкам целей", () => {
  const m = rowMetrics({ Impressions: "10", Clicks: "2", Cost: "30.5", Conversions_123_LC: "1", Conversions_456_LC: "2", ConversionRate_123_LC: "50" });
  assert.deepEqual(m, { impressions: 10, clicks: 2, cost: 30.5, conversions: 3 });
});

test("mapState: состояния Директа", () => {
  assert.equal(mapState("ON"), "active");
  assert.equal(mapState("SUSPENDED"), "paused");
  assert.equal(mapState("OFF_BY_MONITORING"), "inactive");
  assert.equal(mapState("SOMETHING_NEW"), "unknown");
});

// --- клиент Яндекс Директа -------------------------------------------------------

interface Call {
  url: string;
  service: string;
  headers: Record<string, string>;
  body: { method?: string; params: Record<string, unknown> };
}

type Reply = Response | ((call: Call) => Response);

/** Подменный fetch: отвечает по сервису и методу, записывает запросы. */
function fakeApi(routes: Record<string, Reply | Reply[]>) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const service = String(url).split("/").pop()!;
    const call: Call = { url: String(url), service, headers: init?.headers as Record<string, string>, body };
    calls.push(call);
    const key = `${service}.${body.method ?? body.params.ReportType}`;
    const route = routes[key];
    if (route === undefined) throw new Error(`Неожиданный запрос: ${key}`);
    const reply = Array.isArray(route) ? route.shift() : route;
    if (!reply) throw new Error(`Ответы для ${key} закончились`);
    return typeof reply === "function" ? reply(call) : reply.clone();
  }) as typeof fetch;
  return { impl, calls, of: (key: string) => calls.filter((c) => `${c.service}.${c.body.method ?? c.body.params.ReportType}` === key) };
}

const ok = (result: unknown) => Response.json({ result });
const tsv = (lines: string[]) => new Response(lines.join("\n"), { status: 200 });

test("discoverAccounts: клиенты агентства запрашиваются без Client-Login", async () => {
  const api = fakeApi({
    "agencyclients.get": ok({ Clients: [{ Login: "client-a", ClientInfo: "Клиника" }, { Login: "client-b", ClientInfo: "" }] }),
  });
  const accounts = await discoverAccounts({ token: "T", fetchImpl: api.impl });
  assert.deepEqual(accounts, [
    { id: "client-a", name: "Клиника", platform: "yandex_direct", login: "client-a" },
    { id: "client-b", name: "client-b", platform: "yandex_direct", login: "client-b" },
  ]);
  assert.equal(api.calls[0].url, "https://api.direct.yandex.com/json/v5/agencyclients");
  assert.equal("Client-Login" in api.calls[0].headers, false);
  assert.deepEqual(api.calls[0].body.params.SelectionCriteria, { Archived: "NO" });
});

test("discoverAccounts: не агентство — единственный кабинет, собственный аккаунт", async () => {
  const api = fakeApi({
    "agencyclients.get": Response.json({ error: { error_code: 54, error_string: "Нет прав", error_detail: "" } }),
    "clients.get": ok({ Clients: [{ Login: "me", ClientInfo: "Мой аккаунт" }] }),
  });
  const accounts = await discoverAccounts({ token: "T", fetchImpl: api.impl });
  assert.deepEqual(accounts, [{ id: "me", name: "Мой аккаунт", platform: "yandex_direct" }]);
});

test("fetchCampaigns: адрес v501, Client-Login, стратегия и недельный бюджет, ожидание офлайн-отчёта", async () => {
  const waits: number[] = [];
  const api = fakeApi({
    "campaigns.get": ok({
      Campaigns: [
        { Id: 111, Name: "Поиск", State: "ON", Type: "TEXT_CAMPAIGN", Currency: "RUB", DailyBudget: { Amount: 3_000_000_000, Mode: "DISTRIBUTED" }, TextCampaign: { BiddingStrategy: { Search: { BiddingStrategyType: "HIGHEST_POSITION" }, Network: { BiddingStrategyType: "SERVING_OFF" } } } },
        { Id: 222, Name: "ЕПК", State: "SUSPENDED", Type: "UNIFIED_CAMPAIGN", Currency: "RUB", UnifiedCampaign: { BiddingStrategy: { Search: { BiddingStrategyType: "SERVING_OFF" }, Network: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 21_000_000_000 } } } } },
      ],
    }),
    "reports.CAMPAIGN_PERFORMANCE_REPORT": [new Response(null, { status: 201, headers: { retryIn: "7" } }), new Response(TSV, { status: 200 })],
  });
  const provider = createYandexDirectProvider({ token: "TOKEN", login: "client-a", fetchImpl: api.impl, sleep: async (ms) => void waits.push(ms) });
  const { currency, campaigns } = await provider.fetchCampaigns("2026-11-10", "2026-11-11", { goals: ["123"], attribution: "AUTO" });

  assert.equal(currency, "RUB");
  assert.deepEqual(
    { ...campaigns[0], daily: campaigns[0].daily.length },
    { id: "111", name: "Поиск", state: "active", kind: "TEXT_CAMPAIGN", dailyBudget: 3000, budgetEditable: true, strategy: "HIGHEST_POSITION", weeklyBudget: null, daily: 2 },
  );
  assert.deepEqual(
    { state: campaigns[1].state, strategy: campaigns[1].strategy, weeklyBudget: campaigns[1].weeklyBudget, budgetEditable: campaigns[1].budgetEditable },
    { state: "paused", strategy: "WB_MAXIMUM_CLICKS", weeklyBudget: 21000, budgetEditable: false },
  );
  assert.deepEqual(waits, [7000]);

  const get = api.of("campaigns.get")[0];
  assert.equal(get.url, "https://api.direct.yandex.com/json/v501/campaigns");
  assert.equal(get.headers.Authorization, "Bearer TOKEN");
  assert.equal(get.headers["Client-Login"], "client-a");
  assert.deepEqual(get.body.params.UnifiedCampaignFieldNames, ["BiddingStrategy"]);

  const reports = api.of("reports.CAMPAIGN_PERFORMANCE_REPORT");
  assert.equal(reports.length, 2);
  assert.equal(reports[0].url, "https://api.direct.yandex.com/json/v5/reports");
  assert.equal(reports[0].headers.returnMoneyInMicros, "false");
  assert.deepEqual(reports[0].body.params.Goals, ["123"]);
  assert.deepEqual(reports[0].body.params.AttributionModels, ["AUTO"]);
  // Повторный запрос офлайн-отчёта должен быть точно таким же, включая имя.
  assert.deepEqual(reports[0].body, reports[1].body);
});

test("fetchBreakdown: фразы со ставками и статистикой, запросы складываются по тексту", async () => {
  const api = fakeApi({
    "adgroups.get": ok({ AdGroups: [{ Id: 10, Name: "Группа А" }] }),
    "keywords.get": ok({
      Keywords: [
        { Id: 1, Keyword: "купить котел", AdGroupId: 10, State: "ON", Bid: 45_000_000 },
        { Id: 2, Keyword: "---autotargeting", AdGroupId: 10, State: "SUSPENDED" },
      ],
    }),
    "reports.CRITERIA_PERFORMANCE_REPORT": tsv(["CriterionId\tImpressions\tClicks\tCost\tConversions", "1\t100\t10\t450.00\t2"]),
    "reports.SEARCH_QUERY_PERFORMANCE_REPORT": tsv([
      "Query\tAdGroupName\tImpressions\tClicks\tCost\tConversions",
      "котел бесплатно\tГруппа А\t50\t5\t200.00\t--",
      "котел бесплатно\tГруппа Б\t30\t3\t100.00\t--",
    ]),
  });
  const provider = createYandexDirectProvider({ token: "T", login: "c", fetchImpl: api.impl });

  const keywords = await provider.fetchBreakdown("777", "keywords", "2026-11-10", "2026-11-16");
  assert.deepEqual(keywords, [
    { key: "1", label: "купить котел", state: "active", groupId: "10", groupName: "Группа А", bid: 45, impressions: 100, clicks: 10, cost: 450, conversions: 2 },
    { key: "2", label: "Автотаргетинг", state: "paused", groupId: "10", groupName: "Группа А", bid: null, impressions: 0, clicks: 0, cost: 0, conversions: 0 },
  ]);
  const report = api.of("reports.CRITERIA_PERFORMANCE_REPORT")[0].body.params;
  assert.deepEqual((report.SelectionCriteria as { Filter: unknown }).Filter, [{ Field: "CampaignId", Operator: "EQUALS", Values: ["777"] }]);

  const queries = await provider.fetchBreakdown("777", "queries", "2026-11-10", "2026-11-16");
  assert.deepEqual(queries, [{ key: "котел бесплатно", label: "котел бесплатно", groupName: "Группа А", impressions: 80, clicks: 8, cost: 300, conversions: 0 }]);
});

test("ошибка API превращается в DirectApiError с кодом", async () => {
  const api = fakeApi({
    "campaigns.suspend": Response.json({ error: { error_code: 53, error_string: "Ошибка авторизации", error_detail: "Неверный токен", request_id: "42" } }),
  });
  const provider = createYandexDirectProvider({ token: "bad", fetchImpl: api.impl });
  await assert.rejects(provider.setCampaignState("111", "paused"), (e: unknown) => {
    assert.ok(e instanceof DirectApiError);
    assert.equal(e.code, 53);
    assert.match(e.message, /Неверный токен/);
    return true;
  });
});

test("управление: пауза кампании, объявления и фразы, ставка, бюджет", async () => {
  const api = fakeApi({
    "campaigns.suspend": ok({ SuspendResults: [{ Id: 111 }] }),
    "ads.resume": ok({ ResumeResults: [{ Id: 5 }] }),
    "keywords.suspend": ok({ SuspendResults: [{ Errors: [{ Code: 8800, Message: "Объект не найден" }] }] }),
    "keywordbids.set": ok({ SetResults: [{}] }),
    "campaigns.get": ok({ Campaigns: [{ Id: 111, Name: "Поиск", DailyBudget: { Amount: 3_000_000_000, Mode: "DISTRIBUTED" } }] }),
    "campaigns.update": ok({ UpdateResults: [{ Id: 111 }] }),
  });
  const provider = createYandexDirectProvider({ token: "T", fetchImpl: api.impl });

  await provider.setCampaignState("111", "paused");
  assert.deepEqual(api.of("campaigns.suspend")[0].body.params, { SelectionCriteria: { Ids: [111] } });
  assert.equal("Client-Login" in api.calls[0].headers, false);

  await provider.setAdState("5", "active");
  assert.equal(api.of("ads.resume")[0].url, "https://api.direct.yandex.com/json/v501/ads");

  await assert.rejects(provider.setKeywordState("9", "paused"), /Объект не найден/);

  await provider.setKeywordBid("9", 37.5);
  assert.deepEqual(api.of("keywordbids.set")[0].body.params, { KeywordBids: [{ KeywordId: 9, SearchBid: 37_500_000 }] });

  await provider.setDailyBudget("111", 3600);
  // Режим бюджета кампании сохраняется, сумма уходит в микроединицах.
  assert.deepEqual(api.of("campaigns.update")[0].body.params, {
    Campaigns: [{ Id: 111, DailyBudget: { Amount: 3_600_000_000, Mode: "DISTRIBUTED" } }],
  });
});

test("минус-фразы и площадки дописываются к существующим без дублей", async () => {
  const api = fakeApi({
    "campaigns.get": ok({ Campaigns: [{ Id: 111, NegativeKeywords: { Items: ["бесплатно", "скачать"] }, ExcludedSites: null }] }),
    "campaigns.update": ok({ UpdateResults: [{ Id: 111 }] }),
  });
  const provider = createYandexDirectProvider({ token: "T", fetchImpl: api.impl });
  await provider.addNegativeKeywords("111", ["Бесплатно", "своими руками"]);
  assert.deepEqual(api.of("campaigns.update")[0].body.params, {
    Campaigns: [{ Id: 111, NegativeKeywords: { Items: ["бесплатно", "скачать", "своими руками"] } }],
  });
  await provider.excludePlacements("111", ["com.game.app"]);
  assert.deepEqual(api.of("campaigns.update")[1].body.params, { Campaigns: [{ Id: 111, ExcludedSites: { Items: ["com.game.app"] } }] });
});

test("не более четырёх одновременных запросов к API", async () => {
  let active = 0;
  let peak = 0;
  const impl = (async () => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active -= 1;
    return Response.json({ result: { SuspendResults: [{ Id: 1 }] } });
  }) as typeof fetch;
  const provider = createYandexDirectProvider({ token: "T", fetchImpl: impl });
  await Promise.all(Array.from({ length: 12 }, (_, i) => provider.setAdState(String(i + 1), "paused")));
  assert.equal(peak, 4);
});

// --- создание кампаний ----------------------------------------------------------

const PLAN: CampaignPlan = {
  accountId: "demo-clinic",
  name: "Поиск | Виниры",
  placement: "search",
  strategy: "max_conversions",
  weeklyBudget: 14000,
  goalId: "12345",
  counterId: "777",
  regionIds: [213],
  negativeKeywords: ["бесплатно"],
  groups: [
    {
      name: "Виниры цена",
      keywords: ["виниры цена", "поставить виниры москва"],
      ads: [{ title: "Виниры под ключ", title2: "Рассрочка 0%", text: "Керамические виниры за два визита. Гарантия.", href: "https://example.com/veneers" }],
    },
  ],
};

test("buildBiddingStrategy: поиск, сети и оба канала", () => {
  assert.deepEqual(buildBiddingStrategy(PLAN), {
    Search: { BiddingStrategyType: "WB_MAXIMUM_CONVERSION_RATE", WbMaximumConversionRate: { WeeklySpendLimit: 14_000_000_000, GoalId: 12345 } },
    Network: { BiddingStrategyType: "SERVING_OFF" },
  });
  const network = buildBiddingStrategy({ ...PLAN, placement: "network", strategy: "max_clicks" });
  assert.deepEqual(network, {
    Search: { BiddingStrategyType: "SERVING_OFF" },
    Network: { BiddingStrategyType: "WB_MAXIMUM_CLICKS", WbMaximumClicks: { WeeklySpendLimit: 14_000_000_000 } },
  });
  const both = buildBiddingStrategy({ ...PLAN, placement: "both", strategy: "average_cpa", averageCpa: 1500 });
  assert.deepEqual(both.Search, { BiddingStrategyType: "AVERAGE_CPA", AverageCpa: { AverageCpa: 1_500_000_000, GoalId: 12345, WeeklySpendLimit: 14_000_000_000 } });
  assert.deepEqual(both.Network, { BiddingStrategyType: "NETWORK_DEFAULT" });
});

test("validatePlan: лимиты объявлений и фраз из справочника API", () => {
  assert.deepEqual(validatePlan(PLAN), []);
  const bad: CampaignPlan = {
    ...PLAN,
    goalId: undefined,
    regionIds: [],
    groups: [
      {
        name: "",
        keywords: ["купить недорого хороший газовый котел отопления двухконтурный настенный", "дубль", "Дубль"],
        ads: [{ title: "Очень длинный заголовок объявления, который точно не поместится в лимит", text: "", href: "example.com" }],
      },
    ],
  };
  const paths = validatePlan(bad).map((i) => i.path);
  for (const expected of ["goalId", "regionIds", "groups[0].name", "groups[0].keywords[0]", "groups[0].keywords[2]", "groups[0].ads[0].title", "groups[0].ads[0].text", "groups[0].ads[0].href"]) {
    assert.ok(paths.includes(expected), `нет замечания к ${expected}`);
  }
  // Минус-слова и стоп-слова в лимит на число слов не входят.
  assert.equal(countedWords("купить котел в москве -бу -ремонт"), 3);
});

test("createCampaign: кампания, группы, фразы и объявления создаются по адресу v501", async () => {
  const api = fakeApi({
    "campaigns.add": ok({ AddResults: [{ Id: 500 }] }),
    "adgroups.add": ok({ AddResults: [{ Id: 600 }] }),
    "keywords.add": ok({ AddResults: [{ Id: 1 }, { Id: 2 }] }),
    "ads.add": ok({ AddResults: [{ Id: 900 }] }),
    "ads.moderate": ok({ ModerateResults: [{ Id: 900 }] }),
  });
  const provider = createYandexDirectProvider({ token: "T", login: "client-a", apiVersion: "v5", fetchImpl: api.impl });
  const result = await provider.createCampaign(PLAN);

  assert.equal(result.ok, true);
  assert.equal(result.campaignId, "500");
  assert.deepEqual(result.adIds, ["900"]);
  assert.deepEqual(result.steps.map((s) => s.step), ["Кампания", "Группы", "Фразы", "Объявления"]);
  // Даже при настройке v5 создание идёт через v501: иначе единую кампанию не создать.
  assert.ok(api.calls.every((c) => c.url.includes("/json/v501/")));

  const campaign = (api.of("campaigns.add")[0].body.params.Campaigns as Record<string, unknown>[])[0];
  assert.equal(campaign.Name, "Поиск | Виниры");
  assert.deepEqual(campaign.NegativeKeywords, { Items: ["бесплатно"] });
  assert.deepEqual((campaign.UnifiedCampaign as Record<string, unknown>).CounterIds, { Items: [777] });
  assert.deepEqual(api.of("adgroups.add")[0].body.params, {
    AdGroups: [{ Name: "Виниры цена", CampaignId: 500, RegionIds: [213], UnifiedAdGroup: { OfferRetargeting: "NO" } }],
  });
  assert.deepEqual(api.of("keywords.add")[0].body.params, {
    Keywords: [{ Keyword: "виниры цена", AdGroupId: 600 }, { Keyword: "поставить виниры москва", AdGroupId: 600 }],
  });
  assert.deepEqual(api.of("ads.add")[0].body.params, {
    Ads: [{ AdGroupId: 600, TextAd: { Title: "Виниры под ключ", Title2: "Рассрочка 0%", Text: "Керамические виниры за два визита. Гарантия.", Href: "https://example.com/veneers", Mobile: "NO" } }],
  });
  // На модерацию ничего не уходит, пока об этом не попросили отдельно.
  assert.equal(api.of("ads.moderate").length, 0);
  await provider.sendToModeration(result.adIds);
  assert.deepEqual(api.of("ads.moderate")[0].body.params, { SelectionCriteria: { Ids: [900] } });
});

test("createCampaign: ошибка на шаге групп возвращает созданную кампанию и останавливается", async () => {
  const api = fakeApi({
    "campaigns.add": ok({ AddResults: [{ Id: 500 }] }),
    "adgroups.add": Response.json({ error: { error_code: 152, error_string: "Недостаточно баллов", error_detail: "" } }),
  });
  const provider = createYandexDirectProvider({ token: "T", fetchImpl: api.impl });
  const result = await provider.createCampaign(PLAN);
  assert.equal(result.ok, false);
  assert.equal(result.campaignId, "500");
  assert.deepEqual(result.steps.map((s) => [s.step, s.ok]), [["Кампания", true], ["Группы", false]]);
  assert.match(result.steps[1].detail, /Недостаточно баллов/);
});

// --- правила ---------------------------------------------------------------------

test("isCoveredByNegatives: минус-фраза покрывает запрос, если все её слова есть в запросе", () => {
  assert.equal(isCoveredByNegatives("купить котел бесплатно", ["бесплатно"]), true);
  assert.equal(isCoveredByNegatives("котел своими руками", ["-своими руками"]), true);
  assert.equal(isCoveredByNegatives("купить котел", ["бесплатно", "своими руками"]), false);
  assert.equal(isCoveredByNegatives("купить котел", []), false);
});

test("distribute: суммы по частям сходятся с итогом", () => {
  const total = { impressions: 1003, clicks: 97, cost: 5432.1, conversions: 7 };
  const parts = distribute(total, [
    { weight: 1, ctr: 1, cpc: 1, cr: 1 },
    { weight: 2, ctr: 0.5, cpc: 1.3, cr: 0 },
    { weight: 0.7, ctr: 1.4, cpc: 0.8, cr: 1.2 },
  ]);
  assert.equal(parts.reduce((s, p) => s + p.impressions, 0), 1003);
  assert.equal(parts.reduce((s, p) => s + p.clicks, 0), 97);
  assert.equal(parts.reduce((s, p) => s + p.conversions, 0), 7);
  assert.ok(Math.abs(parts.reduce((s, p) => s + p.cost, 0) - 5432.1) < 0.05);
  assert.equal(parts[1].conversions, 0);
});

// Демо-данные зависят от даты, поэтому проверяем не один «сегодняшний» день, а полтора месяца подряд.
const TODAYS = eachDay("2026-11-01", "2026-12-15");

for (const days of [7, 14, 30]) {
  test(`демо-сводка за ${days} дн.: итоги сходятся, правила находят заложенные случаи`, async () => {
    for (const today of TODAYS) {
      reset();
      const o = await getOverview(days, DEMO, today);
      assert.equal(o.accounts.length, 3);
      assert.equal(o.daily.length, days);

      const fromDaily = o.daily.reduce((s, d) => s + d.cost, 0);
      assert.ok(Math.abs(fromDaily - o.totals.current.cost) < 0.01);
      const fromAccounts = o.accounts.reduce((s, a) => s + a.current.cost, 0);
      assert.ok(Math.abs(fromAccounts - o.totals.current.cost) < 0.01);

      const ids = o.insights.map((i) => i.id);
      assert.ok(ids.includes("waste:demo-clinic:c104"), `расход без конверсий (${today})`);
      assert.ok(ids.includes("scale:demo-clinic:c101"), `упор в бюджет (${today})`);
      assert.ok(ids.includes("expensive:demo-shop:c203"), `дорогие конверсии (${today})`);
      assert.ok(ids.includes("ctr:demo-shop:c204"), `падение CTR (${today})`);
      assert.ok(!ids.some((id) => id.endsWith(":c205")), "остановленная кампания в рекомендации не попадает");
      assert.equal(o.insights[0].severity, "critical");
    }
  });
}

test("детализация кампании: уровни сходятся с итогом, правила находят запросы, фразы и объявления", async () => {
  reset();
  const d = await getCampaignDetail("demo-clinic", "c101", 14, undefined, DEMO, TODAY);
  assert.equal(d.referenceCpaSource, "account_average");
  assert.equal(d.daily.length, 14);

  for (const level of ["groups", "ads", "keywords", "queries"] as const) {
    const rows = d.breakdowns[level];
    assert.ok(rows.length > 0, level);
    assert.equal(rows.reduce((s, r) => s + r.clicks, 0), d.campaign.current.clicks, `клики: ${level}`);
    assert.equal(rows.reduce((s, r) => s + r.conversions, 0), d.campaign.current.conversions, `конверсии: ${level}`);
    assert.ok(Math.abs(rows.reduce((s, r) => s + r.cost, 0) - d.campaign.current.cost) < 1, `расход: ${level}`);
  }
  // Поисковая кампания: площадок в сетях нет.
  assert.deepEqual(d.breakdowns.placements, []);
  assert.ok(d.breakdowns.keywords.every((k) => typeof k.bid === "number"));

  const kinds = new Set(d.insights.map((i) => i.id.split(":")[0]));
  assert.ok(kinds.has("query"), "нецелевые запросы");
  assert.ok(kinds.has("keyword-waste"), "фраза без конверсий");
  assert.ok(kinds.has("ad"), "слабое объявление");
  assert.ok(d.insights.every((i) => i.action), "у каждой рекомендации есть действие");
});

test("детализация сетевой кампании: площадки без конверсий предлагаются к исключению", async () => {
  reset();
  const d = await getCampaignDetail("demo-shop", "c203", 30, undefined, DEMO, TODAY);
  assert.deepEqual(d.breakdowns.queries, []);
  const placements = d.insights.filter((i) => i.id.startsWith("placement:"));
  assert.ok(placements.length > 0);
  assert.ok(placements.every((i) => i.action?.type === "exclude_placements" && i.subject?.startsWith("com.")));
});

test("кампания без единой конверсии: внутри неё расход без конверсий не разбирается", async () => {
  reset();
  const d = await getCampaignDetail("demo-clinic", "c104", 14, undefined, DEMO, TODAY);
  assert.equal(d.campaign.current.conversions, 0);
  assert.ok(d.breakdowns.placements.length > 0);
  // Иначе правила предложили бы запретить все площадки и остановить все фразы подряд.
  assert.ok(d.insights.every((i) => i.id.startsWith("ad:")), JSON.stringify(d.insights.map((i) => i.id)));
});

test("уровни можно запрашивать выборочно", async () => {
  reset();
  const d = await getCampaignDetail("demo-clinic", "c101", 7, ["queries"], DEMO, TODAY);
  assert.ok(d.breakdowns.queries.length > 0);
  assert.deepEqual(d.breakdowns.keywords, []);
  assert.ok(d.insights.every((i) => i.id.startsWith("query:")));
});

test("целевой CPA из настроек заменяет среднее по кабинету", async () => {
  reset();
  await updateSettings("demo-school", { targetCpa: 400, goals: ["111"], attribution: "AUTO" }, DEMO);
  const o = await getOverview(14, DEMO, TODAY);
  const school = o.accounts.find((a) => a.id === "demo-school")!;
  assert.deepEqual(school.settings, { targetCpa: 400, goals: ["111"], attribution: "AUTO" });
  const python = o.insights.find((i) => i.id === "expensive:demo-school:c301");
  assert.ok(python, "при цели 400 ₽ поиск по Python становится дорогим");
  assert.equal(python.title, "Конверсии дороже цели");

  const d = await getCampaignDetail("demo-school", "c301", 14, ["keywords"], DEMO, TODAY);
  assert.equal(d.referenceCpa, 400);
  assert.equal(d.referenceCpaSource, "target");
  await assert.rejects(updateSettings("nope", {}, DEMO), (e: unknown) => e instanceof ActionError && e.status === 404);
});

// --- действия ---------------------------------------------------------------------

test("applyAction: все виды действий в демо-режиме", async () => {
  reset();
  const act = (campaignId: string, action: Parameters<typeof applyAction>[0]["action"], label?: string) =>
    applyAction({ accountId: "demo-clinic", campaignId, action, label }, DEMO);

  const before = await getCampaignDetail("demo-clinic", "c101", 14, undefined, DEMO, TODAY);
  const query = before.insights.find((i) => i.id.startsWith("query:"))!;
  const keyword = before.insights.find((i) => i.id.startsWith("keyword-waste:"))!;
  const ad = before.insights.find((i) => i.id.startsWith("ad:"))!;

  assert.equal((await act("c101", query.action!)).ok, true);
  assert.equal((await act("c101", keyword.action!, keyword.subject)).description, `Фраза «${keyword.subject}» остановлена`);
  assert.equal((await act("c101", ad.action!, ad.subject)).description, `Объявление «${ad.subject}» остановлено`);
  const bidTarget = before.breakdowns.keywords[0];
  await act("c101", { type: "set_bid", keywordId: bidTarget.key, amount: 77 }, bidTarget.label);
  await act("c101", { type: "set_budget", amount: 7200 });
  await act("c104", { type: "pause", target: "campaign", id: "c104" });

  const after = await getCampaignDetail("demo-clinic", "c101", 14, undefined, DEMO, TODAY);
  assert.deepEqual(after.exclusions.negativeKeywords, [query.subject]);
  assert.equal(after.breakdowns.queries.find((q) => q.key === query.subject)?.handled, true);
  assert.equal(after.breakdowns.keywords.find((k) => k.label === keyword.subject)?.state, "paused");
  assert.equal(after.breakdowns.ads.find((a) => a.label === ad.subject)?.state, "paused");
  assert.equal(after.breakdowns.keywords.find((k) => k.key === bidTarget.key)?.bid, 77);
  assert.equal(after.campaign.dailyBudget, 7200);
  // Выполненные рекомендации больше не предлагаются.
  for (const done of [query.id, keyword.id, ad.id]) assert.ok(!after.insights.some((i) => i.id === done), done);

  const overview = await getOverview(14, DEMO, TODAY);
  assert.equal(overview.accounts[0].campaigns.find((c) => c.id === "c104")?.state, "paused");
  assert.equal(overview.log.length, 6);
  assert.equal(overview.log[0].description, "Кампания остановлена");

  await assert.rejects(
    applyAction({ accountId: "demo-shop", campaignId: "c202", action: { type: "set_budget", amount: 100 } }, DEMO),
    (e: unknown) => e instanceof ActionError && e.status === 400,
  );
});

test("режим «только чтение» отказывает в любых изменениях до обращения к API", async () => {
  reset();
  const readOnly = loadConfig({ YD_TOKEN: "t", ADS_DATA_DIR: "memory" });
  const denied = (e: unknown) => e instanceof ActionError && e.status === 403;
  await assert.rejects(applyAction({ accountId: "a", campaignId: "1", action: { type: "pause", target: "campaign", id: "1" } }, readOnly), denied);
  await assert.rejects(createCampaign(PLAN, readOnly), denied);
});

test("createCampaign в демо: черновик появляется в кабинете, некорректный план отклоняется", async () => {
  reset();
  const result = await createCampaign(PLAN, DEMO);
  assert.equal(result.ok, true);
  assert.equal(result.adIds.length, 1);

  const o = await getOverview(7, DEMO, TODAY);
  const created = o.accounts[0].campaigns.find((c) => c.id === result.campaignId)!;
  assert.deepEqual(
    { name: created.name, state: created.state, weeklyBudget: created.weeklyBudget, cost: created.current.cost },
    { name: "Поиск | Виниры", state: "inactive", weeklyBudget: 14000, cost: 0 },
  );
  assert.equal(o.log[0].description, "Создана кампания (черновик)");

  const d = await getCampaignDetail("demo-clinic", result.campaignId!, 7, undefined, DEMO, TODAY);
  assert.deepEqual(d.breakdowns.keywords.map((k) => k.label), ["виниры цена", "поставить виниры москва"]);
  assert.deepEqual(d.exclusions.negativeKeywords, ["бесплатно"]);
  assert.deepEqual(d.insights, []);

  await assert.rejects(createCampaign({ ...PLAN, name: " " }, DEMO), (e: unknown) => e instanceof ActionError && e.status === 400);
});

// --- хранение -----------------------------------------------------------------------

test("настройки и журнал переживают перезапуск", async () => {
  reset();
  const dir = await mkdtemp(path.join(tmpdir(), "ads-store-"));
  try {
    const config = loadConfig({ ADS_DATA_DIR: dir });
    await updateSettings("demo-shop", { targetCpa: 1500 }, config);
    await applyAction({ accountId: "demo-shop", campaignId: "c203", action: { type: "pause", target: "campaign", id: "c203" } }, config);

    // «Перезапуск»: состояние в памяти сброшено, данные читаются с диска.
    resetStore();
    const o = await getOverview(7, config, TODAY);
    assert.equal(o.accounts.find((a) => a.id === "demo-shop")?.settings.targetCpa, 1500);
    assert.equal(o.log.length, 1);
    const file = JSON.parse(await readFile(path.join(dir, "cabinet.json"), "utf8"));
    assert.equal(file.settings["demo-shop"].targetCpa, 1500);
  } finally {
    await rm(dir, { recursive: true, force: true });
    reset();
  }
});

// --- автономная работа ---------------------------------------------------------------

const ON = { ...DEFAULT_POLICY, enabled: true };

test("permissionFor, computePacing, judge, zScore", () => {
  assert.equal(permissionFor({ type: "pause", target: "campaign", id: "1" }), "pauseCampaigns");
  assert.equal(permissionFor({ type: "pause", target: "keyword", id: "1" }), "pauseKeywords");
  assert.equal(permissionFor({ type: "add_negatives", phrases: ["x"] }), "negatives");
  // Запуск остановленного автопилот не делает никогда.
  assert.equal(permissionFor({ type: "resume", target: "ad", id: "1" }), null);

  // 16 дней из 30 прошло, потрачено 80 000: прогноз 150 000.
  assert.deepEqual(computePacing(80_000, "2026-11-17", 120_000), { monthlyBudget: 120_000, spent: 80_000, projected: 150_000, status: "over" });
  assert.equal(computePacing(80_000, "2026-11-17", 150_000)?.status, "ok");
  assert.equal(computePacing(80_000, "2026-11-17", 300_000)?.status, "under");
  assert.equal(computePacing(0, "2026-11-01", 100_000), undefined);

  const m = (cost: number, conversions: number) => ({ impressions: 1000, clicks: 100, cost, conversions });
  const negatives = { type: "add_negatives", phrases: ["x"] } as const;
  assert.equal(judge(m(10_000, 5), m(8_000, 5), negatives).verdict, "improved");
  assert.equal(judge(m(10_000, 5), m(13_000, 5), negatives).verdict, "worse");
  assert.equal(judge(m(10_000, 5), m(10_300, 5), negatives).verdict, "neutral");
  assert.equal(judge(m(10_000, 1), m(8_000, 2), negatives).verdict, "insufficient");
  assert.equal(judge(m(10_000, 0), m(0, 0), { type: "pause", target: "campaign", id: "1" }).verdict, "improved");

  const ctr = (impressions: number, clicks: number) => ({ impressions, clicks, cost: 0, conversions: 0 });
  assert.ok(zScore(ctr(5000, 200), ctr(5000, 300)) > 1.96);
  assert.ok(Math.abs(zScore(ctr(5000, 200), ctr(5000, 205))) < 1.96);
  assert.equal(zScore(ctr(0, 0), ctr(100, 5)), 0);
});

test("ежедневный обход без автопилота: ничего не меняет, всё выносит на решение", async () => {
  reset();
  const report = await runDaily(DEMO, TODAY);
  assert.equal(report.accounts.length, 3);
  assert.ok(report.accounts.every((a) => !a.autopilot && a.applied.length === 0));
  assert.ok(report.accounts.every((a) => a.needsDecision.length > 0));
  const o = await getOverview(7, DEMO, TODAY);
  assert.equal(o.log.length, 0);
  assert.equal(o.lastReport?.date, TODAY);
});

test("автопилот: сам делает разрешённое, бюджеты и остановку кампаний оставляет человеку", async () => {
  reset();
  await updateSettings("demo-clinic", { autopilot: ON }, DEMO);
  const report = await runDaily(DEMO, TODAY);
  const clinic = report.accounts.find((a) => a.accountId === "demo-clinic")!;
  assert.equal(clinic.autopilot, true);
  assert.ok(clinic.applied.length >= 5, `сделано ${clinic.applied.length}`);
  assert.ok(clinic.applied.every((a) => a.ok && a.reason));
  // Остановка кампании без конверсий и повышение бюджета не разрешены по умолчанию.
  const waiting = clinic.needsDecision.map((i) => i.id);
  assert.ok(waiting.includes("waste:demo-clinic:c104"));
  assert.ok(waiting.includes("scale:demo-clinic:c101"));
  // Остальные кабинеты без автопилота не тронуты.
  assert.ok(report.accounts.filter((a) => a.accountId !== "demo-clinic").every((a) => a.applied.length === 0));

  const history = await changeHistory(DEMO);
  assert.equal(history.length, clinic.applied.length);
  assert.ok(history.every((e) => e.actor === "autopilot" && e.insightId && e.before && e.date === TODAY && e.accountId === "demo-clinic"));
  const kinds = new Set(history.map((e) => e.action!.type));
  assert.ok(kinds.has("add_negatives") && kinds.has("pause"));
  assert.ok(!kinds.has("set_budget"));
  assert.ok(!history.some((e) => e.action!.type === "pause" && e.action!.target === "campaign"));

  // Повторный обход в тот же день ничего не дублирует, а отчёт дня сохраняет сделанное ранее.
  const again = await runDaily(DEMO, TODAY);
  assert.equal(again.accounts.find((a) => a.accountId === "demo-clinic")!.applied.length, history.length);
  assert.equal((await changeHistory(DEMO)).length, history.length);
  assert.equal((await getOverview(7, DEMO, TODAY)).lastReport?.accounts[0].applied.length, history.length);
});

test("автопилот: лимит изменений в день и пробный прогон", async () => {
  reset();
  await updateSettings("demo-clinic", { autopilot: { ...ON, maxActionsPerDay: 2 } }, DEMO);

  const dry = await runDaily(DEMO, TODAY, { dryRun: true });
  const dryClinic = dry.accounts.find((a) => a.accountId === "demo-clinic")!;
  assert.equal(dry.dryRun, true);
  assert.equal(dryClinic.applied.length, 2);
  // Пробный прогон ничего не выполняет и не сохраняет.
  assert.equal((await changeHistory(DEMO)).length, 0);
  assert.equal((await getOverview(7, DEMO, TODAY)).lastReport, null);

  const real = await runDaily(DEMO, TODAY);
  const clinic = real.accounts.find((a) => a.accountId === "demo-clinic")!;
  assert.equal(clinic.applied.length, 2);
  assert.ok(clinic.skipped.some((s) => /лимит изменений/.test(s.why)));
  assert.equal((await changeHistory(DEMO)).length, 2);
});

test("автопилот с бюджетами: при перерасходе не повышает, а снижение не повторяет до результата", async () => {
  reset();
  const budgets = { ...ON, allow: { ...ON.allow, budgets: true } };
  // Месячный бюджет заведомо ниже темпа расхода.
  await updateSettings("demo-clinic", { autopilot: budgets, monthlyBudget: 50_000 }, DEMO);
  await updateSettings("demo-shop", { autopilot: budgets }, DEMO);
  const report = await runDaily(DEMO, TODAY);

  const clinic = report.accounts.find((a) => a.accountId === "demo-clinic")!;
  assert.equal(clinic.pacing?.status, "over");
  assert.ok(clinic.skipped.some((s) => /месячного бюджета/.test(s.why)), "повышение бюджета должно быть отложено");
  assert.ok(!(await changeHistory(DEMO)).some((e) => e.accountId === "demo-clinic" && e.action?.type === "set_budget"));

  const shopCut = (await changeHistory(DEMO)).filter((e) => e.accountId === "demo-shop" && e.insightId === "expensive:demo-shop:c203");
  assert.equal(shopCut.length, 1);
  assert.deepEqual(shopCut[0].action, { type: "set_budget", amount: 4000 });

  // На следующий день статистика почти та же — правило сработало бы снова и срезало бы ещё 20%.
  const next = await runDaily(DEMO, "2026-11-18");
  const shop = next.accounts.find((a) => a.accountId === "demo-shop")!;
  assert.ok(shop.skipped.some((s) => /жду результата/.test(s.why)));
  assert.equal((await changeHistory(DEMO)).filter((e) => e.insightId === "expensive:demo-shop:c203").length, 1);
});

test("итоги изменений подводятся через неделю", async () => {
  reset();
  await updateSettings("demo-clinic", { autopilot: ON }, DEMO);
  await runDaily(DEMO, TODAY);
  const made = (await changeHistory(DEMO)).length;

  // Через три дня рано: недели после изменения ещё нет.
  assert.deepEqual((await runDaily(DEMO, "2026-11-20")).evaluated, []);
  const later = await runDaily(DEMO, "2026-11-25");
  assert.equal(later.evaluated.length, made);
  const history = await changeHistory(DEMO);
  const original = history.filter((e) => e.date === TODAY);
  assert.ok(original.every((e) => e.outcome && e.outcome.note && e.outcome.after.cost >= 0));
  // Уже оценённые изменения повторно не оцениваются.
  assert.deepEqual((await runDaily(DEMO, "2026-11-26")).evaluated.filter((x) => original.some((e) => e.description === x.description)), []);
});

test("тест объявления: запуск, один тест на группу, итог и остановка проигравшего", async () => {
  reset();
  await updateSettings("demo-shop", { autopilot: ON }, DEMO);
  const ads = (await getCampaignDetail("demo-shop", "c201", 7, ["ads"], DEMO, TODAY)).breakdowns.ads;
  const control = ads.find((a) => a.groupId === "c201g1")!;
  const input = {
    accountId: "demo-shop",
    campaignId: "c201",
    groupId: "c201g1",
    controlAdId: control.key,
    ad: { title: "Электрокотлы со склада", text: "Доставка за 1 день. Монтаж под ключ. Гарантия 5 лет.", href: "https://example.com/boilers" },
    hypothesis: "Срок доставки в заголовке поднимет CTR",
  };

  await assert.rejects(startAdTest({ ...input, hypothesis: " " }, DEMO, "agent", TODAY), /гипотезу/);
  await assert.rejects(startAdTest({ ...input, ad: { ...input.ad, href: "нет" } }, DEMO, "agent", TODAY), /не прошло проверку/);
  await assert.rejects(startAdTest({ ...input, controlAdId: "nope" }, DEMO, "agent", TODAY), (e: unknown) => e instanceof ActionError && e.status === 404);

  const started = await startAdTest(input, DEMO, "agent", TODAY);
  assert.equal(started.status, "running");
  assert.equal(started.controlLabel, control.label);
  await assert.rejects(startAdTest(input, DEMO, "agent", TODAY), (e: unknown) => e instanceof ActionError && e.status === 409);
  const afterStart = (await getCampaignDetail("demo-shop", "c201", 7, ["ads"], DEMO, TODAY)).breakdowns.ads;
  assert.ok(afterStart.some((a) => a.key === started.variantAdId && a.label === "Электрокотлы со склада"));

  // Через три дня данных мало — тест продолжается.
  assert.deepEqual((await runDaily(DEMO, "2026-11-20")).finishedTests, []);
  const done = await runDaily(DEMO, "2026-12-01");
  assert.equal(done.finishedTests.length, 1);
  assert.match(done.finishedTests[0].note, /Победил новый вариант.*остановлено/);

  const o = await getOverview(7, DEMO, "2026-12-01");
  assert.equal(o.tests[0].status, "finished");
  assert.equal(o.tests[0].result?.winner, "variant");
  const finalAds = (await getCampaignDetail("demo-shop", "c201", 7, ["ads"], DEMO, "2026-12-01")).breakdowns.ads;
  assert.equal(finalAds.find((a) => a.key === control.key)?.state, "paused");
  assert.equal(finalAds.find((a) => a.key === started.variantAdId)?.state, "active");
});

// --- креативы -----------------------------------------------------------------------

const SPEC = { headline: "Имплантация зубов под ключ", subline: "Гарантия 5 лет, рассрочка 0%", cta: "Записаться", badge: "от 25 000 ₽", brand: "Улыбка", color: "#1c5cab", style: "solid" } as const;

test("fitText: кегль уменьшается, пока текст не уместится; строки выравниваются", () => {
  const short = fitText("Скидка 20%", 1000, 2, 100, 40);
  assert.deepEqual(short, { size: 100, lines: ["Скидка 20%"] });

  const long = fitText("Газовые котлы со склада в Москве с доставкой за один день", 600, 3, 100, 20);
  assert.ok(long.size < 100 && long.size >= 20);
  assert.ok(long.lines.length <= 3);
  assert.equal(long.lines.join(" "), "Газовые котлы со склада в Москве с доставкой за один день");
  for (const line of long.lines) assert.ok(textWidth(line) * long.size <= 600, line);
  // Ни одной «висящей» строки из одного короткого слова.
  assert.ok(long.lines.every((l) => l.length > 3));
});

test("shade и readableOn: оттенки и читаемый цвет текста", () => {
  assert.equal(shade("#808080", -1), "#000000");
  assert.equal(shade("#808080", 1), "#ffffff");
  assert.equal(readableOn("#1c5cab"), "#ffffff");
  assert.equal(readableOn("#ffd84d"), "#0b0b0b");
  assert.throws(() => shade("синий", 0.1), /#RRGGBB/);
});

test("renderCreative: PNG точного размера в каждом формате, графические — не тяжелее 512 КБ", async () => {
  for (const format of FORMATS) {
    const png = await renderCreative(SPEC, format);
    assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47], "сигнатура PNG");
    assert.deepEqual(pngSize(png), { width: format.width, height: format.height }, format.key);
    if (format.use === "image_ad") assert.ok(png.length <= 512 * 1024, `${format.key}: ${png.length} байт`);
  }
  await assert.rejects(renderCreative({ ...SPEC, headline: " " }, FORMATS[0]), /заголовок/);
});

test("библиотека креативов: создание, чтение файла, загрузка на площадку один раз", async () => {
  reset();
  const created = await createCreative({ accountId: "demo-clinic", spec: SPEC, formats: ["square", "300x250"], note: "Цена в плашке поднимет CTR" }, DEMO);
  assert.deepEqual(created.formats, ["square", "300x250"]);
  assert.ok(created.bytes.square > 1000);
  assert.equal((await listCreatives(DEMO))[0].id, created.id);
  assert.deepEqual(pngSize(await readCreativeFile(created.id, "square", DEMO)), { width: 1080, height: 1080 });
  await assert.rejects(readCreativeFile(created.id, "wide", DEMO), (e: unknown) => e instanceof ActionError && e.status === 404);
  await assert.rejects(createCreative({ accountId: "demo-clinic", spec: SPEC, formats: ["999x1"] }, DEMO), /Неизвестный формат/);

  const hash = await uploadCreative(created.id, "square", DEMO);
  assert.match(hash, /^demo-/);
  // Повторная загрузка того же формата не создаёт второе изображение и не пишет в журнал.
  assert.equal(await uploadCreative(created.id, "square", DEMO), hash);
  const history = await changeHistory(DEMO);
  assert.equal(history.length, 1);
  assert.match(history[0].description, /Загружено изображение/);
  assert.equal(history[0].reason, "Цена в плашке поднимет CTR");
  assert.equal((await listCreatives(DEMO, "demo-clinic"))[0].uploads.square, hash);
  assert.deepEqual(await listCreatives(DEMO, "demo-shop"), []);
});

test("Директ: загрузка изображения и объявление с картинкой", async () => {
  const api = fakeApi({
    "adimages.add": ok({ AddResults: [{ AdImageHash: "abc123" }] }),
    "ads.add": ok({ AddResults: [{ Id: 77 }] }),
  });
  const provider = createYandexDirectProvider({ token: "T", login: "c", fetchImpl: api.impl });
  const hash = await provider.uploadImage("Баннер square", Buffer.from("png-bytes"));
  assert.equal(hash, "abc123");
  assert.deepEqual(api.of("adimages.add")[0].body.params, { AdImages: [{ ImageData: Buffer.from("png-bytes").toString("base64"), Name: "Баннер square" }] });

  const ids = await provider.addAds("600", [{ title: "Заголовок", text: "Текст объявления.", href: "https://example.com", imageHash: hash }]);
  assert.deepEqual(ids, ["77"]);
  assert.deepEqual(api.of("ads.add")[0].body.params, {
    Ads: [{ AdGroupId: 600, TextAd: { Title: "Заголовок", Text: "Текст объявления.", Href: "https://example.com", Mobile: "NO", AdImageHash: "abc123" } }],
  });
});
