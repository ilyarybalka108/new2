import { type AdsConfig, loadConfig } from "./config.ts";
import { addDays, derive, sum, todayMoscow } from "./metrics.ts";
import { validatePlan } from "./plan.ts";
import {
  ActionError,
  applyAction,
  BREAKDOWN_LEVELS,
  describeAction,
  fetchSnapshot,
  findAccount,
  getCampaignDetail,
  getOverview,
  invalidate,
  listAccounts,
  providerFor,
  record,
  requireWrite,
} from "./service.ts";
import { getSettings, mutate, read } from "./store.ts";
import type {
  AccountSettings,
  ActionLogEntry,
  Actor,
  AdTest,
  AutopilotPermission,
  AutopilotPolicy,
  ChangeOutcome,
  DailyAccountReport,
  DailyReport,
  Insight,
  Metrics,
  Pacing,
  PlanAd,
  ProposedAction,
} from "./types.ts";

// Автономная работа директолога: ежедневный обход кабинетов, изменения в рамках выданных
// разрешений, оценка результатов прошлых изменений, контроль бюджета и тесты объявлений.

/** За сколько дней смотрим статистику при ежедневном обходе. */
export const DAILY_WINDOW = 14;
/** Сколько дней не повторяем то же изменение: сначала должен быть виден результат. */
export const COOLDOWN_DAYS = 7;
/** Через сколько полных дней после изменения подводим его итог. */
export const EVALUATE_AFTER_DAYS = 7;

export const TEST_RULES = {
  /** Минимум показов у каждого варианта, чтобы сравнивать. */
  minImpressions: 1000,
  minDays: 7,
  /** Если за это время значимой разницы нет — тест закрывается без победителя. */
  maxDays: 28,
  /** Порог значимости: 1,96 соответствует уверенности 95%. */
  zThreshold: 1.96,
};

/**
 * Разрешения по умолчанию при включении автопилота. Самому можно то, что режет заведомо
 * пустые траты и легко откатывается. Бюджеты и остановка кампаний — только с явного разрешения.
 */
export const DEFAULT_POLICY: AutopilotPolicy = {
  enabled: false,
  allow: { negatives: true, placements: true, pauseKeywords: true, pauseAds: true, bids: true, budgets: false, pauseCampaigns: false },
  maxActionsPerDay: 20,
};

/** Какое разрешение нужно для действия; null — такое действие автопилот не выполняет никогда. */
export function permissionFor(action: ProposedAction): AutopilotPermission | null {
  switch (action.type) {
    case "pause":
      return action.target === "campaign" ? "pauseCampaigns" : action.target === "ad" ? "pauseAds" : "pauseKeywords";
    case "resume":
      return null;
    case "set_budget":
      return "budgets";
    case "set_bid":
      return "bids";
    case "add_negatives":
      return "negatives";
    case "exclude_placements":
      return "placements";
  }
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const rub = (value: number) => `${Math.round(value).toLocaleString("ru-RU")} ₽`;
const signed = (share: number) => `${share > 0 ? "+" : "−"}${Math.abs(Math.round(share * 100))}%`;

// --- темп расхода --------------------------------------------------------------------

/** Прогноз расхода на конец месяца по расходу с его начала до вчера включительно. */
export function computePacing(spent: number, today: string, monthlyBudget: number): Pacing | undefined {
  const yesterday = addDays(today, -1);
  // Первого числа месяц только начался: прогнозировать не по чему.
  if (yesterday.slice(0, 7) !== today.slice(0, 7)) return undefined;
  const elapsed = Number(yesterday.slice(8, 10));
  const [year, month] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const projected = (spent / elapsed) * daysInMonth;
  const status = projected > monthlyBudget * 1.05 ? "over" : projected < monthlyBudget * 0.85 ? "under" : "ok";
  return { monthlyBudget, spent, projected, status };
}

async function accountPacing(config: AdsConfig, accountId: string, settings: AccountSettings, today: string) {
  if (!settings.monthlyBudget) return undefined;
  const yesterday = addDays(today, -1);
  if (yesterday.slice(0, 7) !== today.slice(0, 7)) return undefined;
  const account = await findAccount(config, accountId);
  const snapshot = await fetchSnapshot(config, account, settings, `${today.slice(0, 8)}01`, yesterday, today);
  const spent = sum(snapshot.campaigns.flatMap((c) => c.daily)).cost;
  return computePacing(spent, today, settings.monthlyBudget);
}

// --- оценка прошлых изменений ---------------------------------------------------------

/** Сравнивает неделю до изменения с неделей после. */
export function judge(before: Metrics, after: Metrics, action: ProposedAction): Pick<ChangeOutcome, "verdict" | "note"> {
  const b = derive(before);
  const a = derive(after);
  if (action.type === "pause" && action.target === "campaign") {
    return before.conversions === 0
      ? { verdict: "improved", note: `Расход без конверсий остановлен: было ${rub(before.cost)} за неделю.` }
      : { verdict: "neutral", note: `Кампания остановлена: до этого ${before.conversions} конв. за неделю при CPA ${rub(b.cpa ?? 0)}.` };
  }
  if (before.conversions >= 3 && after.conversions >= 3 && b.cpa !== null && a.cpa !== null) {
    const delta = (a.cpa - b.cpa) / b.cpa;
    const note = `CPA ${rub(b.cpa)} → ${rub(a.cpa)} (${signed(delta)}), конверсий ${before.conversions} → ${after.conversions}.`;
    return { verdict: delta <= -0.1 ? "improved" : delta >= 0.1 ? "worse" : "neutral", note };
  }
  if (before.conversions === 0 && after.conversions > 0) {
    return { verdict: "improved", note: `Появились конверсии: ${after.conversions} за неделю при CPA ${rub(a.cpa ?? 0)}.` };
  }
  return { verdict: "insufficient", note: `Мало конверсий для вывода: ${before.conversions} до и ${after.conversions} после.` };
}

/** Подводит итоги изменений, после которых прошла полная неделя. */
export async function evaluateChanges(config: AdsConfig, today: string): Promise<DailyReport["evaluated"]> {
  const state = await read(config.dataDir);
  const due = state.log.filter(
    (e) => e.ok && e.action && e.before && !e.outcome && e.accountId && e.campaignId && e.date && addDays(e.date, EVALUATE_AFTER_DAYS) < today,
  );
  const outcomes = new Map<string, ChangeOutcome>();
  for (const entry of due) {
    try {
      const account = await findAccount(config, entry.accountId!);
      const settings = await getSettings(config.dataDir, account.id);
      const snapshot = await fetchSnapshot(config, account, settings, addDays(entry.date!, 1), addDays(entry.date!, EVALUATE_AFTER_DAYS), today);
      const campaign = snapshot.campaigns.find((c) => c.id === entry.campaignId);
      if (!campaign) continue;
      const after = sum(campaign.daily);
      outcomes.set(entry.id, { evaluatedAt: new Date().toISOString(), after, ...judge(entry.before!, after, entry.action!) });
    } catch {
      // Кабинет временно недоступен — итог подведём в следующий обход.
    }
  }
  if (outcomes.size === 0) return [];
  await mutate(config.dataDir, (s) => {
    for (const e of s.log) if (outcomes.has(e.id)) e.outcome = outcomes.get(e.id);
  });
  return due
    .filter((e) => outcomes.has(e.id))
    .map((e) => ({ description: e.description, campaignName: e.campaignName, ...outcomes.get(e.id)! }))
    .map(({ description, campaignName, verdict, note }) => ({ description, campaignName, verdict, note }));
}

// --- тесты объявлений -----------------------------------------------------------------

/** z-статистика для разницы двух долей (CTR варианта против CTR контроля). */
export function zScore(control: Metrics, variant: Metrics): number {
  const n1 = control.impressions;
  const n2 = variant.impressions;
  if (n1 === 0 || n2 === 0) return 0;
  const pooled = (control.clicks + variant.clicks) / (n1 + n2);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2));
  return se === 0 ? 0 : (variant.clicks / n2 - control.clicks / n1) / se;
}

export interface StartTestInput {
  accountId: string;
  campaignId: string;
  groupId: string;
  /** Действующее объявление, с которым сравниваем. */
  controlAdId: string;
  ad: PlanAd;
  hypothesis: string;
}

/** Запускает тест: добавляет вариант объявления в группу и отправляет его на модерацию. */
export async function startAdTest(
  input: StartTestInput,
  config: AdsConfig = loadConfig(),
  actor: Actor = "agent",
  today: string = todayMoscow(),
): Promise<AdTest> {
  requireWrite(config);
  if (!input.hypothesis.trim()) throw new ActionError("Укажите гипотезу: что проверяем и почему ждём улучшения", 400);
  const issues = validatePlan({
    accountId: input.accountId,
    name: "test",
    placement: "search",
    strategy: "max_clicks",
    weeklyBudget: 1,
    regionIds: [225],
    negativeKeywords: [],
    groups: [{ name: "test", keywords: ["test"], ads: [input.ad] }],
  });
  if (issues.length) throw new ActionError(`Объявление не прошло проверку: ${issues.map((i) => i.message).join("; ")}`, 400);

  const account = await findAccount(config, input.accountId);
  const detail = await getCampaignDetail(account.id, input.campaignId, 7, ["ads"], config, today);
  const control = detail.breakdowns.ads.find((ad) => ad.key === input.controlAdId && ad.groupId === input.groupId);
  if (!control) throw new ActionError("Контрольное объявление не найдено в этой группе", 404);
  const running = (await read(config.dataDir)).tests.find((t) => t.status === "running" && t.groupId === input.groupId);
  if (running) throw new ActionError("В этой группе уже идёт тест — два одновременно дают неразделимый результат", 409);

  const provider = providerFor(config, account, today);
  let variantAdId = "";
  const entry = await record(
    config,
    {
      date: today,
      accountId: account.id,
      accountName: account.name,
      campaignId: detail.campaign.id,
      campaignName: detail.campaign.name,
      description: `Запущен тест объявления «${input.ad.title}» против «${control.label}»`,
      actor,
      reason: input.hypothesis,
    },
    async () => {
      const [id] = await provider.addAds(input.groupId, [input.ad]);
      if (!id) throw new Error("API не вернул идентификатор объявления");
      variantAdId = id;
      await provider.sendToModeration([id]);
    },
  );
  if (!entry.ok) throw new ActionError(`Тест не запущен: ${entry.error}`, 502);

  const test: AdTest = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    startDate: today,
    accountId: account.id,
    accountName: account.name,
    campaignId: detail.campaign.id,
    campaignName: detail.campaign.name,
    groupId: input.groupId,
    controlAdId: control.key,
    controlLabel: control.label,
    variantAdId,
    variantLabel: input.ad.title,
    hypothesis: input.hypothesis.trim(),
    status: "running",
  };
  await mutate(config.dataDir, (s) => {
    s.tests.unshift(test);
  });
  invalidate(account.id);
  return test;
}

/** Подводит итоги тестов, набравших достаточно данных. Проигравшее объявление останавливает, если это разрешено. */
export async function evaluateTests(config: AdsConfig, today: string): Promise<DailyReport["finishedTests"]> {
  const state = await read(config.dataDir);
  const finished: DailyReport["finishedTests"] = [];
  const zero: Metrics = { impressions: 0, clicks: 0, cost: 0, conversions: 0 };

  for (const test of state.tests.filter((t) => t.status === "running")) {
    const days = daysBetween(test.startDate, today);
    if (days < 1) continue;
    let result: AdTest["result"];
    try {
      const account = await findAccount(config, test.accountId);
      const settings = await getSettings(config.dataDir, account.id);
      const rows = await providerFor(config, account, today).fetchBreakdown(test.campaignId, "ads", test.startDate, addDays(today, -1), {
        goals: settings.goals,
        attribution: settings.attribution,
      });
      const pick = (id: string): Metrics => {
        const row = rows.find((r) => r.key === id);
        return row ? { impressions: row.impressions, clicks: row.clicks, cost: row.cost, conversions: row.conversions } : zero;
      };
      const control = pick(test.controlAdId);
      const variant = pick(test.variantAdId);
      const enough = control.impressions >= TEST_RULES.minImpressions && variant.impressions >= TEST_RULES.minImpressions;
      const z = zScore(control, variant);
      const ctr = (m: Metrics) => `${((derive(m).ctr ?? 0) * 100).toFixed(2).replace(".", ",")}%`;

      if (enough && days >= TEST_RULES.minDays && Math.abs(z) >= TEST_RULES.zThreshold) {
        const winner = z > 0 ? "variant" : "control";
        const loser = winner === "variant" ? { id: test.controlAdId, label: test.controlLabel } : { id: test.variantAdId, label: test.variantLabel };
        let note = `CTR варианта ${ctr(variant)} против ${ctr(control)} у контроля — разница значима. Победил ${winner === "variant" ? "новый вариант" : "действующий"}.`;
        // Проигравшее объявление останавливаем сами, только если кабинет это разрешил.
        const policy = settings.autopilot;
        if (config.writeEnabled && policy?.enabled && policy.allow.pauseAds) {
          const done = await applyAction(
            { accountId: test.accountId, campaignId: test.campaignId, action: { type: "pause", target: "ad", id: loser.id }, label: loser.label },
            config,
            { actor: "autopilot", reason: `Итог теста: ${note}` },
            today,
          );
          note += done.ok ? " Проигравшее объявление остановлено." : ` Остановить проигравшее не удалось: ${done.error}.`;
        } else {
          note += ` Проигравшее объявление «${loser.label}» нужно остановить вручную.`;
        }
        result = { finishedAt: new Date().toISOString(), winner, note, control, variant };
      } else if (days >= TEST_RULES.maxDays) {
        const note = enough
          ? `За ${days} дн. значимой разницы нет: CTR ${ctr(variant)} против ${ctr(control)}.`
          : `За ${days} дн. вариант не набрал ${TEST_RULES.minImpressions} показов — возможно, он отклонён модерацией.`;
        result = { finishedAt: new Date().toISOString(), winner: "none", note, control, variant };
      }
    } catch {
      continue; // кабинет временно недоступен — вернёмся к тесту в следующий обход
    }
    if (!result) continue;
    const done = result;
    await mutate(config.dataDir, (s) => {
      const stored = s.tests.find((t) => t.id === test.id);
      if (stored) Object.assign(stored, { status: "finished", result: done });
    });
    finished.push({ campaignName: test.campaignName, hypothesis: test.hypothesis, note: done.note });
  }
  return finished;
}

// --- ежедневный обход ------------------------------------------------------------------

/**
 * Обходит все кабинеты: собирает рекомендации по кампаниям и внутри них, выполняет то,
 * что разрешено автопилоту, остальное откладывает на решение человека. Затем подводит итоги
 * прошлых изменений и тестов и сохраняет отчёт.
 */
export async function runDaily(
  config: AdsConfig = loadConfig(),
  today: string = todayMoscow(),
  opts: { dryRun?: boolean } = {},
): Promise<DailyReport> {
  const dryRun = Boolean(opts.dryRun);
  const overview = await getOverview(DAILY_WINDOW, config, today);
  const known = new Set((await listAccounts(config)).map((a) => a.id));
  const accounts: DailyAccountReport[] = [];

  for (const account of overview.accounts) {
    const policy = account.settings.autopilot;
    const report: DailyAccountReport = {
      accountId: account.id,
      accountName: account.name,
      autopilot: Boolean(policy?.enabled),
      applied: [],
      needsDecision: [],
      skipped: [],
    };
    accounts.push(report);
    if (account.error || !known.has(account.id)) {
      report.error = account.error ?? "Кабинет недоступен";
      continue;
    }

    try {
      report.pacing = await accountPacing(config, account.id, account.settings, today);
    } catch (e) {
      report.error = `Не удалось посчитать темп расхода: ${e instanceof Error ? e.message : e}`;
    }

    const insights: Insight[] = overview.insights.filter((i) => i.accountId === account.id);
    for (const campaign of account.campaigns) {
      if (campaign.state !== "active" || campaign.current.cost === 0) continue;
      try {
        const detail = await getCampaignDetail(account.id, campaign.id, DAILY_WINDOW, BREAKDOWN_LEVELS, config, today);
        insights.push(...detail.insights);
      } catch (e) {
        report.skipped.push({ title: "Разбор кампании", campaignName: campaign.name, why: e instanceof Error ? e.message : String(e) });
      }
    }

    const log = (await read(config.dataDir)).log;
    let usedToday = log.filter((e) => e.accountId === account.id && e.date === today && e.actor === "autopilot" && e.ok).length;

    for (const insight of insights) {
      const skip = (why: string) => report.skipped.push({ title: insight.title, campaignName: insight.campaignName, why });
      const permission = insight.action ? permissionFor(insight.action) : null;
      if (!insight.action || !permission || !policy?.enabled || !policy.allow[permission]) {
        report.needsDecision.push(insight);
        continue;
      }
      const action = insight.action;
      const recent = log.find((e) => e.ok && e.insightId === insight.id && e.date && daysBetween(e.date, today) < COOLDOWN_DAYS);
      if (recent) {
        skip(`такое же изменение сделано ${daysBetween(recent.date!, today)} дн. назад — жду результата`);
        continue;
      }
      if (action.type === "set_budget") {
        const current = account.campaigns.find((c) => c.id === insight.campaignId)?.dailyBudget ?? 0;
        if (action.amount > current && report.pacing?.status === "over") {
          skip("прогноз расхода выше месячного бюджета — бюджеты не повышаю");
          continue;
        }
      }
      if (!config.writeEnabled) {
        skip("кабинет в режиме «только чтение»");
        continue;
      }
      if (usedToday >= policy.maxActionsPerDay) {
        skip(`достигнут лимит изменений за день: ${policy.maxActionsPerDay}`);
        continue;
      }

      const reason = `${insight.title}. ${insight.detail}`;
      usedToday += 1;
      if (dryRun) {
        report.applied.push({ description: describeAction(action, insight.subject), campaignName: insight.campaignName, reason, ok: true });
        continue;
      }
      try {
        const entry = await applyAction(
          { accountId: account.id, campaignId: insight.campaignId, action, label: insight.subject },
          config,
          { actor: "autopilot", reason, insightId: insight.id },
          today,
        );
        report.applied.push({ description: entry.description, campaignName: entry.campaignName, reason, ok: entry.ok, error: entry.error });
      } catch (e) {
        report.applied.push({
          description: describeAction(action, insight.subject),
          campaignName: insight.campaignName,
          reason,
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  const result: DailyReport = {
    date: today,
    at: new Date().toISOString(),
    dryRun,
    days: DAILY_WINDOW,
    accounts,
    // Пробный прогон ничего не меняет — в том числе не закрывает тесты и не пишет итоги.
    evaluated: dryRun ? [] : await evaluateChanges(config, today),
    finishedTests: dryRun ? [] : await evaluateTests(config, today),
  };
  if (!dryRun) {
    // Обход могут запустить несколько раз за день: отчёт дня копит всё сделанное, а не затирается последним запуском.
    const earlier = (await read(config.dataDir)).reports.find((r) => r.date === today);
    if (earlier) {
      for (const account of result.accounts) {
        const before = earlier.accounts.find((a) => a.accountId === account.accountId);
        if (before) account.applied = [...before.applied, ...account.applied];
      }
      result.evaluated = [...earlier.evaluated, ...result.evaluated];
      result.finishedTests = [...earlier.finishedTests, ...result.finishedTests];
    }
    await mutate(config.dataDir, (s) => {
      s.reports = [result, ...s.reports.filter((r) => r.date !== today)];
    });
  }
  return result;
}

/** Журнал изменений с причинами и итогами — для отчёта и командной строки. */
export async function changeHistory(config: AdsConfig = loadConfig(), limit = 100): Promise<ActionLogEntry[]> {
  return (await read(config.dataDir)).log.slice(0, limit);
}
