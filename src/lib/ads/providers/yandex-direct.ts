import type { CampaignState, CampaignStats, DailyPoint } from "../types.ts";
import type { AdsProvider } from "./provider.ts";

// Клиент API Яндекс Директа v5 (JSON).
// Написан по официальной документации; на боевом кабинете ещё не проверялся —
// первый запуск с настоящим токеном нужно делать в режиме «только чтение».

const HOSTS = {
  live: "https://api.direct.yandex.com",
  sandbox: "https://api-sandbox.direct.yandex.com",
};

const MICROS = 1_000_000;
const REPORT_MAX_WAIT_MS = 120_000;

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
  /** Логин клиента для агентского токена. */
  login?: string;
  sandbox?: boolean;
  fetchImpl?: typeof fetch;
  /** Подменяется в тестах, чтобы не ждать по-настоящему. */
  sleep?: (ms: number) => Promise<void>;
}

interface ApiCampaign {
  Id: number;
  Name: string;
  State?: string;
  Type?: string;
  Currency?: string;
  DailyBudget?: { Amount: number; Mode: string } | null;
}

interface ActionResult {
  Id?: number;
  Errors?: { Code: number; Message: string; Details?: string }[];
}

const STATE_MAP: Record<string, CampaignState> = {
  ON: "active",
  SUSPENDED: "paused",
  OFF: "inactive",
  ENDED: "ended",
  ARCHIVED: "archived",
};

export function mapState(state: string | undefined): CampaignState {
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

/** Группирует строки отчёта «день × кампания» в статистику по кампаниям. */
export function groupReportRows(rows: Record<string, string>[]): Map<string, DailyPoint[]> {
  const byCampaign = new Map<string, DailyPoint[]>();
  for (const row of rows) {
    const id = row.CampaignId;
    if (!id) continue;
    const list = byCampaign.get(id) ?? [];
    list.push({
      date: row.Date,
      impressions: num(row.Impressions),
      clicks: num(row.Clicks),
      cost: num(row.Cost),
      conversions: num(row.Conversions),
    });
    byCampaign.set(id, list);
  }
  for (const list of byCampaign.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return byCampaign;
}

export function createYandexDirectProvider(opts: DirectOptions): AdsProvider {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const host = opts.sandbox ? HOSTS.sandbox : HOSTS.live;

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${opts.token}`,
      "Accept-Language": "ru",
      "Content-Type": "application/json; charset=utf-8",
      ...(opts.login ? { "Client-Login": opts.login } : {}),
      ...extra,
    };
  }

  function toError(body: unknown, status: number): DirectApiError {
    const e = (body as { error?: Record<string, unknown> } | null)?.error;
    if (!e) return new DirectApiError(`API Директа ответил HTTP ${status}`);
    const text = [e.error_string, e.error_detail].filter(Boolean).join(": ");
    return new DirectApiError(
      `${text || "Ошибка API Директа"} (код ${e.error_code})`,
      Number(e.error_code) || null,
      (e.request_id as string) ?? null,
    );
  }

  async function call<T>(service: string, method: string, params: unknown): Promise<T> {
    const res = await doFetch(`${host}/json/v5/${service}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ method, params }),
    });
    const body = (await res.json().catch(() => null)) as { result?: T; error?: unknown } | null;
    if (!res.ok || !body || body.error || body.result === undefined) throw toError(body, res.status);
    return body.result;
  }

  async function getCampaigns(ids?: number[]): Promise<ApiCampaign[]> {
    const out: ApiCampaign[] = [];
    const limit = 10_000;
    for (let offset = 0; ; offset += limit) {
      const result = await call<{ Campaigns?: ApiCampaign[]; LimitedBy?: number }>("campaigns", "get", {
        SelectionCriteria: ids ? { Ids: ids } : { States: ["ON", "OFF", "SUSPENDED", "ENDED"] },
        FieldNames: ["Id", "Name", "State", "Type", "Currency", "DailyBudget"],
        Page: { Limit: limit, Offset: offset },
      });
      out.push(...(result.Campaigns ?? []));
      if (result.LimitedBy === undefined) return out;
    }
  }

  async function fetchReport(from: string, to: string): Promise<Record<string, string>[]> {
    const body = JSON.stringify({
      params: {
        SelectionCriteria: { DateFrom: from, DateTo: to },
        FieldNames: ["Date", "CampaignId", "Impressions", "Clicks", "Cost", "Conversions"],
        // Имя однозначно определяет отчёт: одно имя с другими параметрами — ошибка API.
        ReportName: `cabinet_campaigns_daily_v1_${from}_${to}`,
        ReportType: "CAMPAIGN_PERFORMANCE_REPORT",
        DateRangeType: "CUSTOM_DATE",
        Format: "TSV",
        IncludeVAT: "YES",
        IncludeDiscount: "NO",
      },
    });
    const started = Date.now();
    for (;;) {
      const res = await doFetch(`${host}/json/v5/reports`, {
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
  }

  function assertOk(results: ActionResult[] | undefined, what: string) {
    const errors = results?.[0]?.Errors;
    if (errors?.length) {
      const e = errors[0];
      throw new DirectApiError(`${what}: ${[e.Message, e.Details].filter(Boolean).join(": ")} (код ${e.Code})`, e.Code);
    }
  }

  return {
    async fetchCampaigns(from, to) {
      const [campaigns, rows] = await Promise.all([getCampaigns(), fetchReport(from, to)]);
      const stats = groupReportRows(rows);
      const result: CampaignStats[] = campaigns.map((c) => ({
        id: String(c.Id),
        name: c.Name,
        state: mapState(c.State),
        kind: c.Type ?? null,
        dailyBudget: c.DailyBudget ? c.DailyBudget.Amount / MICROS : null,
        // Дневной бюджет в Директе доступен только при ручной стратегии. Чтобы не слать
        // заведомо ошибочные запросы, меняем его лишь там, где он уже задан.
        budgetEditable: Boolean(c.DailyBudget),
        daily: stats.get(String(c.Id)) ?? [],
      }));
      return { currency: campaigns.find((c) => c.Currency)?.Currency ?? "RUB", campaigns: result };
    },

    async setCampaignState(campaignId, state) {
      const method = state === "paused" ? "suspend" : "resume";
      const result = await call<{ SuspendResults?: ActionResult[]; ResumeResults?: ActionResult[] }>(
        "campaigns",
        method,
        { SelectionCriteria: { Ids: [Number(campaignId)] } },
      );
      assertOk(result.SuspendResults ?? result.ResumeResults, state === "paused" ? "Не удалось остановить" : "Не удалось запустить");
    },

    async setDailyBudget(campaignId, amount) {
      // Mode — обязательное поле; сохраняем текущий режим кампании.
      const [current] = await getCampaigns([Number(campaignId)]);
      const mode = current?.DailyBudget?.Mode ?? "STANDARD";
      const result = await call<{ UpdateResults?: ActionResult[] }>("campaigns", "update", {
        Campaigns: [{ Id: Number(campaignId), DailyBudget: { Amount: Math.round(amount * MICROS), Mode: mode } }],
      });
      assertOk(result.UpdateResults, "Не удалось изменить бюджет");
    },
  };
}
