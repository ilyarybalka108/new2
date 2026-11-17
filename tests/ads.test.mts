import test from "node:test";
import assert from "node:assert/strict";
import {
  change,
  derive,
  eachDay,
  periods,
  sumRange,
} from "../src/lib/ads/metrics.ts";
import {
  createYandexDirectProvider,
  DirectApiError,
  groupReportRows,
  mapState,
  parseReportTsv,
} from "../src/lib/ads/providers/yandex-direct.ts";
import { resetDemoState } from "../src/lib/ads/providers/demo.ts";
import {
  ActionError,
  applyAction,
  getOverview,
  loadConfig,
} from "../src/lib/ads/service.ts";

// --- метрики ------------------------------------------------------------------

test("derive: неопределённые метрики равны null, а не 0 или Infinity", () => {
  assert.deepEqual(
    derive({ impressions: 0, clicks: 0, cost: 0, conversions: 0 }),
    {
      ctr: null,
      cpc: null,
      cpa: null,
      cr: null,
    },
  );
  const d = derive({
    impressions: 1000,
    clicks: 50,
    cost: 2500,
    conversions: 5,
  });
  assert.equal(d.ctr, 0.05);
  assert.equal(d.cpc, 50);
  assert.equal(d.cpa, 500);
  assert.equal(d.cr, 0.1);
});

test("change: относительное изменение и отсутствие базы", () => {
  assert.equal(change(110, 100), 0.1);
  assert.equal(change(100, 0), null);
  assert.equal(change(null, 100), null);
});

test("periods: полные дни до вчера и равный предыдущий период", () => {
  assert.deepEqual(periods(7, "2026-11-17"), {
    from: "2026-11-10",
    to: "2026-11-16",
    prevFrom: "2026-11-03",
    prevTo: "2026-11-09",
  });
  assert.equal(eachDay("2026-02-27", "2026-03-01").length, 3);
});

test("sumRange: границы включительно", () => {
  const day = (date: string) => ({
    date,
    impressions: 1,
    clicks: 1,
    cost: 10,
    conversions: 0,
  });
  const total = sumRange(
    [day("2026-01-01"), day("2026-01-02"), day("2026-01-03")],
    "2026-01-02",
    "2026-01-03",
  );
  assert.equal(total.cost, 20);
});

// --- Яндекс Директ --------------------------------------------------------------

const TSV = [
  "Date\tCampaignId\tImpressions\tClicks\tCost\tConversions",
  "2026-11-10\t111\t1000\t50\t2500.50\t3",
  "2026-11-11\t111\t900\t40\t2000.00\t--",
  "2026-11-10\t222\t500\t5\t100.00\t--",
  "",
].join("\n");

test("parseReportTsv и groupReportRows: «--» читается как ноль", () => {
  const rows = parseReportTsv(TSV);
  assert.equal(rows.length, 3);
  const grouped = groupReportRows(rows);
  assert.deepEqual(grouped.get("111"), [
    {
      date: "2026-11-10",
      impressions: 1000,
      clicks: 50,
      cost: 2500.5,
      conversions: 3,
    },
    {
      date: "2026-11-11",
      impressions: 900,
      clicks: 40,
      cost: 2000,
      conversions: 0,
    },
  ]);
  assert.equal(grouped.get("222")?.[0].conversions, 0);
  assert.deepEqual(parseReportTsv(""), []);
});

test("mapState: состояния Директа", () => {
  assert.equal(mapState("ON"), "active");
  assert.equal(mapState("SUSPENDED"), "paused");
  assert.equal(mapState("OFF"), "inactive");
  assert.equal(mapState("SOMETHING_NEW"), "unknown");
});

interface Call {
  url: string;
  headers: Record<string, string>;
  body: { method?: string; params: Record<string, unknown> };
}

/** Подменный fetch: записывает запросы и отдаёт ответы по очереди. */
function fakeFetch(responses: (() => Response)[]) {
  const calls: Call[] = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    const next = responses.shift();
    if (!next) throw new Error(`Неожиданный запрос: ${url}`);
    return next();
  }) as typeof fetch;
  return { impl, calls };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status });

test("fetchCampaigns: собирает кампании и отчёт, ждёт офлайн-отчёт", async () => {
  const calls: Call[] = [];
  // Запросы кампаний и отчёта идут параллельно — отвечаем по адресу, а не по порядку.
  let reportAttempts = 0;
  const waits: number[] = [];
  const routed = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    if (String(url).endsWith("/campaigns")) {
      return Response.json({
        result: {
          Campaigns: [
            {
              Id: 111,
              Name: "Поиск",
              State: "ON",
              Type: "TEXT_CAMPAIGN",
              Currency: "RUB",
              DailyBudget: { Amount: 3_000_000_000, Mode: "DISTRIBUTED" },
            },
            {
              Id: 222,
              Name: "РСЯ",
              State: "SUSPENDED",
              Type: "TEXT_CAMPAIGN",
              Currency: "RUB",
            },
          ],
        },
      });
    }
    reportAttempts += 1;
    if (reportAttempts === 1)
      return new Response(null, { status: 201, headers: { retryIn: "7" } });
    return new Response(TSV, { status: 200 });
  }) as typeof fetch;

  const provider = createYandexDirectProvider({
    token: "TOKEN",
    login: "client-login",
    fetchImpl: routed,
    sleep: async (ms) => void waits.push(ms),
  });
  const { currency, campaigns } = await provider.fetchCampaigns(
    "2026-11-10",
    "2026-11-11",
  );

  assert.equal(currency, "RUB");
  assert.equal(campaigns.length, 2);
  assert.deepEqual(
    { ...campaigns[0], daily: campaigns[0].daily.length },
    {
      id: "111",
      name: "Поиск",
      state: "active",
      kind: "TEXT_CAMPAIGN",
      dailyBudget: 3000,
      budgetEditable: true,
      daily: 2,
    },
  );
  assert.equal(campaigns[1].state, "paused");
  assert.equal(campaigns[1].dailyBudget, null);
  assert.equal(campaigns[1].budgetEditable, false);
  assert.deepEqual(waits, [7000]);
  assert.equal(reportAttempts, 2);

  const report = calls.find((c) => c.url.endsWith("/reports"))!;
  assert.equal(report.url, "https://api.direct.yandex.com/json/v5/reports");
  assert.equal(report.headers.Authorization, "Bearer TOKEN");
  assert.equal(report.headers["Client-Login"], "client-login");
  assert.equal(report.headers.returnMoneyInMicros, "false");
  assert.equal(report.body.params.ReportType, "CAMPAIGN_PERFORMANCE_REPORT");
  assert.deepEqual(report.body.params.SelectionCriteria, {
    DateFrom: "2026-11-10",
    DateTo: "2026-11-11",
  });
});

test("ошибка API превращается в DirectApiError с кодом", async () => {
  const { impl } = fakeFetch([
    json({
      error: {
        error_code: 53,
        error_string: "Ошибка авторизации",
        error_detail: "Неверный токен",
        request_id: "42",
      },
    }),
  ]);
  const provider = createYandexDirectProvider({
    token: "bad",
    fetchImpl: impl,
  });
  await assert.rejects(
    provider.setCampaignState("111", "paused"),
    (e: unknown) => {
      assert.ok(e instanceof DirectApiError);
      assert.equal(e.code, 53);
      assert.match(e.message, /Неверный токен/);
      return true;
    },
  );
});

test("пауза и запуск: метод, песочница, отсутствие Client-Login", async () => {
  const { impl, calls } = fakeFetch([
    json({ result: { SuspendResults: [{ Id: 111 }] } }),
    json({ result: { ResumeResults: [{ Id: 111 }] } }),
    json({
      result: {
        SuspendResults: [
          { Errors: [{ Code: 8800, Message: "Объект не найден" }] },
        ],
      },
    }),
  ]);
  const provider = createYandexDirectProvider({
    token: "T",
    sandbox: true,
    fetchImpl: impl,
  });
  await provider.setCampaignState("111", "paused");
  await provider.setCampaignState("111", "active");
  assert.equal(
    calls[0].url,
    "https://api-sandbox.direct.yandex.com/json/v5/campaigns",
  );
  assert.equal(calls[0].body.method, "suspend");
  assert.deepEqual(calls[0].body.params, { SelectionCriteria: { Ids: [111] } });
  assert.equal(calls[1].body.method, "resume");
  assert.equal("Client-Login" in calls[0].headers, false);
  await assert.rejects(
    provider.setCampaignState("111", "paused"),
    /Объект не найден/,
  );
});

test("setDailyBudget: сумма в микроединицах, режим бюджета сохраняется", async () => {
  const { impl, calls } = fakeFetch([
    json({
      result: {
        Campaigns: [
          {
            Id: 111,
            Name: "Поиск",
            DailyBudget: { Amount: 3_000_000_000, Mode: "DISTRIBUTED" },
          },
        ],
      },
    }),
    json({ result: { UpdateResults: [{ Id: 111 }] } }),
  ]);
  const provider = createYandexDirectProvider({ token: "T", fetchImpl: impl });
  await provider.setDailyBudget("111", 3600);
  assert.equal(calls[1].body.method, "update");
  assert.deepEqual(calls[1].body.params, {
    Campaigns: [
      { Id: 111, DailyBudget: { Amount: 3_600_000_000, Mode: "DISTRIBUTED" } },
    ],
  });
});

// --- конфигурация и сводка ------------------------------------------------------

test("loadConfig: демо по умолчанию, боевой режим — только чтение, пока не разрешили", () => {
  assert.equal(loadConfig({}).mode, "demo");
  const accounts = JSON.stringify([
    { id: "a", name: "Проект А", tokenEnv: "YD_TOKEN_A", login: "client" },
  ]);
  const live = loadConfig({ ADS_ACCOUNTS: accounts });
  assert.equal(live.mode, "live");
  assert.equal(live.writeEnabled, false);
  assert.equal(live.accounts[0].platform, "yandex_direct");
  assert.equal(
    loadConfig({ ADS_ACCOUNTS: accounts, ADS_ALLOW_WRITE: "1" }).writeEnabled,
    true,
  );
  assert.throws(() => loadConfig({ ADS_ACCOUNTS: "{" }), /JSON/);
  assert.throws(
    () => loadConfig({ ADS_ACCOUNTS: '[{"id":"a","name":"A"}]' }),
    /tokenEnv/,
  );
  assert.throws(
    () =>
      loadConfig({
        ADS_ACCOUNTS:
          '[{"id":"a","name":"A","tokenEnv":"T","platform":"vk_ads"}]',
      }),
    /не поддерживается/,
  );
});

// Демо-данные зависят от даты, поэтому проверяем не один «сегодняшний» день, а полтора месяца подряд.
const TODAYS = eachDay("2026-11-01", "2026-12-15");

for (const days of [7, 14, 30]) {
  test(`демо-сводка за ${days} дн.: итоги сходятся, правила находят заложенные случаи`, async () => {
    for (const today of TODAYS) {
      resetDemoState();
      const o = await getOverview(days, loadConfig({}), today);
      assert.equal(o.mode, "demo");
      assert.equal(o.accounts.length, 3);
      assert.equal(o.daily.length, days);

      // Итог по кабинетам равен сумме по дням графика.
      const fromDaily = o.daily.reduce((s, d) => s + d.cost, 0);
      assert.ok(Math.abs(fromDaily - o.totals.current.cost) < 0.01);
      const fromAccounts = o.accounts.reduce((s, a) => s + a.current.cost, 0);
      assert.ok(Math.abs(fromAccounts - o.totals.current.cost) < 0.01);

      const ids = o.insights.map((i) => i.id);
      assert.ok(
        ids.includes("waste:demo-clinic:c104"),
        `расход без конверсий (${today})`,
      );
      assert.ok(
        ids.includes("scale:demo-clinic:c101"),
        `упор в бюджет (${today})`,
      );
      assert.ok(
        ids.includes("expensive:demo-shop:c203"),
        `дорогие конверсии (${today})`,
      );
      assert.ok(ids.includes("ctr:demo-shop:c204"), `падение CTR (${today})`);
      // Остановленная кампания в рекомендации не попадает.
      assert.ok(!ids.some((id) => id.endsWith(":c205")));
      assert.equal(o.insights[0].severity, "critical");
    }
  });
}

test("applyAction: демо меняет состояние, режим «только чтение» отказывает", async () => {
  resetDemoState();
  const demo = loadConfig({});
  const entry = await applyAction(
    { accountId: "demo-clinic", campaignId: "c104", action: { type: "pause" } },
    demo,
  );
  assert.equal(entry.ok, true);
  const after = await getOverview(7, demo);
  const campaign = after.accounts[0].campaigns.find((c) => c.id === "c104")!;
  assert.equal(campaign.state, "paused");
  assert.ok(!after.insights.some((i) => i.campaignId === "c104"));
  assert.equal(after.log[0].campaignName, campaign.name);

  await applyAction(
    {
      accountId: "demo-clinic",
      campaignId: "c101",
      action: { type: "set_budget", amount: 7200 },
    },
    demo,
  );
  const budget = (await getOverview(7, demo)).accounts[0].campaigns.find(
    (c) => c.id === "c101",
  )!.dailyBudget;
  assert.equal(budget, 7200);

  const readOnly = loadConfig({
    ADS_ACCOUNTS: JSON.stringify([{ id: "a", name: "A", tokenEnv: "T" }]),
  });
  await assert.rejects(
    applyAction(
      { accountId: "a", campaignId: "1", action: { type: "pause" } },
      readOnly,
    ),
    (e: unknown) => e instanceof ActionError && e.status === 403,
  );
  await assert.rejects(
    applyAction(
      {
        accountId: "demo-shop",
        campaignId: "c202",
        action: { type: "set_budget", amount: 100 },
      },
      demo,
    ),
    (e: unknown) => e instanceof ActionError && e.status === 400,
  );
  resetDemoState();
});
