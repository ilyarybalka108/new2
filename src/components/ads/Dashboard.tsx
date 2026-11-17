"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { fmtDateTime, fmtDay, fmtInt, fmtMoney, fmtPct } from "@/lib/ads/format";
import { derive } from "@/lib/ads/metrics";
import type {
  AccountSettings,
  AccountView,
  AutopilotPermission,
  AutopilotPolicy,
  CampaignView,
  DailyReport,
  Insight,
  Overview,
  ProposedAction,
} from "@/lib/ads/types";
import AgentPanel, { VERDICT } from "./AgentPanel";
import {
  InsightCards,
  KIND_LABEL,
  Kpis,
  ModeBadge,
  PeriodSwitch,
  StatePill,
  STRATEGY_LABEL,
  useActions,
  useData,
} from "./shared";
import TrendChart from "./TrendChart";

// --- настройки кабинета -------------------------------------------------------

/** Разрешения по умолчанию: совпадают с серверными (DEFAULT_POLICY в autopilot.ts). */
const DEFAULT_POLICY: AutopilotPolicy = {
  enabled: false,
  allow: { negatives: true, placements: true, pauseKeywords: true, pauseAds: true, bids: true, budgets: false, pauseCampaigns: false },
  maxActionsPerDay: 20,
};

const PERMISSIONS: [AutopilotPermission, string][] = [
  ["negatives", "Добавлять минус-фразы"],
  ["placements", "Запрещать площадки"],
  ["pauseKeywords", "Останавливать фразы без конверсий"],
  ["pauseAds", "Останавливать слабые объявления"],
  ["bids", "Менять ставки фраз"],
  ["budgets", "Менять дневные бюджеты кампаний"],
  ["pauseCampaigns", "Останавливать кампании без конверсий"],
];

function SettingsDialog({
  account,
  onClose,
  onSaved,
}: {
  account: AccountView;
  onClose: () => void;
  onSaved: (message: { ok: boolean; text: string }) => void;
}) {
  const [targetCpa, setTargetCpa] = useState(account.settings.targetCpa ? String(account.settings.targetCpa) : "");
  const [goals, setGoals] = useState((account.settings.goals ?? []).join(", "));
  const [attribution, setAttribution] = useState<string>(account.settings.attribution ?? "");
  const [monthlyBudget, setMonthlyBudget] = useState(account.settings.monthlyBudget ? String(account.settings.monthlyBudget) : "");
  const [policy, setPolicy] = useState<AutopilotPolicy>(account.settings.autopilot ?? DEFAULT_POLICY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const goalIds = goals.split(/[\s,;]+/).filter(Boolean);
  const cpa = Number(targetCpa.replace(",", "."));
  const monthly = Number(monthlyBudget.replace(",", ".").replace(/\s/g, ""));
  const valid =
    (targetCpa.trim() === "" || (Number.isFinite(cpa) && cpa > 0)) &&
    (monthlyBudget.trim() === "" || (Number.isFinite(monthly) && monthly > 0)) &&
    goalIds.every((g) => /^\d+$/.test(g)) &&
    goalIds.length <= 10 &&
    Number.isInteger(policy.maxActionsPerDay) &&
    policy.maxActionsPerDay >= 1;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    const settings: AccountSettings = {
      ...(targetCpa.trim() ? { targetCpa: cpa } : {}),
      ...(goalIds.length ? { goals: goalIds } : {}),
      ...(attribution ? { attribution: attribution as AccountSettings["attribution"] } : {}),
      ...(monthlyBudget.trim() ? { monthlyBudget: monthly } : {}),
      autopilot: policy,
    };
    try {
      const res = await fetch("/api/ads/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account.id, settings }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Не удалось сохранить");
      onSaved({ ok: true, text: `Настройки сохранены — ${account.name}` });
    } catch (err) {
      onSaved({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  }

  const field = "mt-1 block w-full rounded-lg border border-line bg-page px-3 py-2 text-base";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
      >
        <h2 id="settings-title" className="text-lg font-semibold">
          Настройки кабинета
        </h2>
        <p className="mt-1 text-sm text-ink-2">{account.name}</p>

        <label className="mt-4 block text-sm">
          <span className="text-ink-2">Целевая цена конверсии, {account.currency}</span>
          <input autoFocus inputMode="decimal" value={targetCpa} onChange={(e) => setTargetCpa(e.target.value)} className={`${field} tabular-nums`} />
          <span className="mt-1 block text-xs text-muted">
            С ней сравниваются кампании, фразы, запросы и площадки. Без неё используется средняя цена по кабинету.
          </span>
        </label>

        <label className="mt-4 block text-sm">
          <span className="text-ink-2">Цели Метрики, идентификаторы через запятую</span>
          <input inputMode="numeric" value={goals} onChange={(e) => setGoals(e.target.value)} className={`${field} tabular-nums`} />
          <span className="mt-1 block text-xs text-muted">Конверсиями считаются только эти цели. Пусто — все цели, до 10 штук.</span>
        </label>

        <label className="mt-4 block text-sm">
          <span className="text-ink-2">Модель атрибуции</span>
          <select value={attribution} onChange={(e) => setAttribution(e.target.value)} className={field}>
            <option value="">По умолчанию в API (последний переход)</option>
            <option value="AUTO">Автоматическая</option>
            <option value="LC">Последний переход</option>
            <option value="LSCCD">Последний значимый переход, кросс-девайс</option>
            <option value="FCCD">Первый переход, кросс-девайс</option>
          </select>
        </label>

        <label className="mt-4 block text-sm">
          <span className="text-ink-2">Бюджет на месяц, {account.currency}</span>
          <input inputMode="decimal" value={monthlyBudget} onChange={(e) => setMonthlyBudget(e.target.value)} className={`${field} tabular-nums`} />
          <span className="mt-1 block text-xs text-muted">Директолог следит за темпом расхода и не повышает бюджеты, если прогноз выше этой суммы.</span>
        </label>

        <fieldset className="mt-5 rounded-lg border border-line p-3 text-sm">
          <legend className="px-1 font-medium">Автопилот</legend>
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={policy.enabled} onChange={(e) => setPolicy({ ...policy, enabled: e.target.checked })} />
            <span>
              Директолог сам вносит изменения в этом кабинете
              <span className="block text-xs text-muted">Выключено — он только наблюдает и выносит рекомендации на твоё решение.</span>
            </span>
          </label>
          <div className={`mt-3 grid gap-1.5 ${policy.enabled ? "" : "opacity-50"}`}>
            <span className="text-ink-2">Что можно делать без подтверждения</span>
            {PERMISSIONS.map(([key, label]) => (
              <label key={key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  disabled={!policy.enabled}
                  checked={policy.allow[key]}
                  onChange={(e) => setPolicy({ ...policy, allow: { ...policy.allow, [key]: e.target.checked } })}
                />
                {label}
              </label>
            ))}
            <label className="mt-2 block">
              <span className="text-ink-2">Не больше изменений в день</span>
              <input
                inputMode="numeric"
                disabled={!policy.enabled}
                value={Number.isFinite(policy.maxActionsPerDay) ? String(policy.maxActionsPerDay) : ""}
                onChange={(e) => setPolicy({ ...policy, maxActionsPerDay: e.target.value.trim() === "" ? NaN : Number(e.target.value) })}
                className={`${field} tabular-nums`}
              />
            </label>
          </div>
        </fieldset>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm">
            Отмена
          </button>
          <button type="submit" disabled={busy || !valid} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-page disabled:opacity-50">
            {busy ? "Сохраняю…" : "Сохранить"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Сколько последних записей журнала показывать сразу. */
const LOG_PREVIEW = 8;

const ACTOR = { human: "Вручную", autopilot: "Автопилот", agent: "Директолог" } as const;

// --- кабинеты и кампании ------------------------------------------------------

function AccountCard({
  account,
  days,
  canWrite,
  onAct,
  onSettings,
}: {
  account: AccountView;
  days: number;
  canWrite: boolean;
  onAct: (campaign: CampaignView, action: ProposedAction) => void;
  onSettings: () => void;
}) {
  const d = derive(account.current);
  const cur = account.currency;
  return (
    <details open className="group rounded-xl border border-line bg-surface">
      <summary className="flex flex-wrap items-center gap-x-6 gap-y-2 p-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-muted transition-transform group-open:rotate-90" aria-hidden>
              ▸
            </span>
            <h3 className="truncate font-semibold">{account.name}</h3>
          </div>
          <div className="ml-5 text-sm text-muted">
            {account.platform === "yandex_direct" ? "Яндекс Директ" : "VK Реклама"} · кампаний: {account.campaigns.length}
            {account.settings.targetCpa ? ` · цель CPA ${fmtMoney(account.settings.targetCpa, cur)}` : ""}
            {account.settings.autopilot?.enabled ? " · автопилот включён" : " · автопилот выключен"}
          </div>
        </div>
        {!account.error && (
          <dl className="flex gap-6 text-sm tabular-nums">
            <div>
              <dt className="text-muted">Расход</dt>
              <dd className="font-medium">{fmtMoney(account.current.cost, cur)}</dd>
            </div>
            <div>
              <dt className="text-muted">Конверсии</dt>
              <dd className="font-medium">{fmtInt(account.current.conversions)}</dd>
            </div>
            <div>
              <dt className="text-muted">CPA</dt>
              <dd className="font-medium">{fmtMoney(d.cpa, cur)}</dd>
            </div>
          </dl>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            onSettings();
          }}
          className="rounded-md border border-line px-2.5 py-1 text-sm text-ink-2 hover:text-ink"
        >
          Настройки
        </button>
      </summary>

      {account.error ? (
        <p className="border-t border-line p-4 text-sm text-bad sm:px-5">Не удалось получить данные: {account.error}</p>
      ) : (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[920px] text-sm tabular-nums">
            <thead className="text-left text-muted">
              <tr>
                <th className="px-4 py-2 font-normal sm:pl-5">Кампания</th>
                <th className="px-3 py-2 font-normal">Статус</th>
                <th className="px-3 py-2 text-right font-normal">Расход</th>
                <th className="px-3 py-2 text-right font-normal">Клики</th>
                <th className="px-3 py-2 text-right font-normal">CTR</th>
                <th className="px-3 py-2 text-right font-normal">CPC</th>
                <th className="px-3 py-2 text-right font-normal">Конв.</th>
                <th className="px-3 py-2 text-right font-normal">CPA</th>
                <th className="px-3 py-2 text-right font-normal">Бюджет</th>
                <th className="px-4 py-2 text-right font-normal sm:pr-5">Действие</th>
              </tr>
            </thead>
            <tbody>
              {account.campaigns.map((c) => {
                const m = derive(c.current);
                return (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="px-4 py-2.5 sm:pl-5">
                      <Link
                        href={`/campaign/${encodeURIComponent(account.id)}/${encodeURIComponent(c.id)}?days=${days}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {c.name}
                      </Link>
                      <div className="text-xs text-muted">
                        {[c.kind && (KIND_LABEL[c.kind] ?? c.kind), c.strategy && (STRATEGY_LABEL[c.strategy] ?? c.strategy)]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <StatePill state={c.state} />
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmtMoney(c.current.cost, cur)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtInt(c.current.clicks)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtPct(m.ctr)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtMoney(m.cpc, cur, 2)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtInt(c.current.conversions)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtMoney(m.cpa, cur)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {c.dailyBudget !== null ? (
                        <>
                          {fmtMoney(c.dailyBudget, cur)} / день
                          {c.budgetEditable && (
                            <button
                              type="button"
                              disabled={!canWrite}
                              onClick={() => onAct(c, { type: "set_budget", amount: c.dailyBudget! })}
                              aria-label={`Изменить дневной бюджет кампании «${c.name}»`}
                              className="ml-2 text-accent hover:underline disabled:opacity-40"
                            >
                              изменить
                            </button>
                          )}
                        </>
                      ) : c.weeklyBudget !== null ? (
                        `${fmtMoney(c.weeklyBudget, cur)} / нед.`
                      ) : (
                        <span className="text-muted">не задан</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right sm:pr-5">
                      {(c.state === "active" || c.state === "paused") && (
                        <button
                          type="button"
                          disabled={!canWrite}
                          onClick={() => onAct(c, { type: c.state === "active" ? "pause" : "resume", target: "campaign", id: c.id })}
                          className="rounded-md border border-line px-2.5 py-1 hover:border-axis disabled:opacity-40"
                        >
                          {c.state === "active" ? "Пауза" : "Запустить"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}

// --- страница -----------------------------------------------------------------

export default function Dashboard() {
  const [days, setDays] = useState(7);
  const [reload, setReload] = useState(0);
  const [settingsFor, setSettingsFor] = useState<AccountView | null>(null);
  const [showAllLog, setShowAllLog] = useState(false);
  const { data, error, loading } = useData<Overview>(`/api/ads/overview?days=${days}`, reload);
  const refresh = () => setReload((n) => n + 1);
  const actions = useActions(data?.mode === "live", data?.currency ?? "RUB", refresh);
  const canWrite = Boolean(data?.writeEnabled);

  async function runDaily(dryRun: boolean): Promise<DailyReport> {
    const res = await fetch("/api/ads/daily", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? "Обход не выполнен");
    if (!dryRun) refresh();
    return body as DailyReport;
  }

  function actOnInsight(insight: Insight) {
    const account = data?.accounts.find((a) => a.id === insight.accountId);
    const campaign = account?.campaigns.find((c) => c.id === insight.campaignId);
    if (!account || !campaign || !insight.action) return;
    actions.request({
      accountId: account.id,
      accountName: account.name,
      campaignId: campaign.id,
      campaignName: campaign.name,
      action: insight.action,
      reason: `${insight.title}. ${insight.detail}`,
      currentAmount: campaign.dailyBudget,
    });
  }

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Рекламный кабинет</h1>
          <p className="mt-0.5 text-sm text-ink-2">
            {data
              ? `${fmtDay(data.range.from)} — ${fmtDay(data.range.to)} · сравнение с предыдущими ${data.range.days} дн.`
              : "Загружаю данные…"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data && <ModeBadge mode={data.mode} canWrite={canWrite} />}
          <PeriodSwitch days={days} onChange={setDays} />
          <button type="button" onClick={refresh} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 hover:text-ink">
            Обновить
          </button>
          <Link href="/new" className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-page">
            Новая кампания
          </Link>
        </div>
      </header>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-line bg-surface p-3 text-sm text-bad">
          Не удалось загрузить данные: {error}
        </p>
      )}
      {actions.notice}

      {data && (
        <div className={`mt-5 grid grid-cols-1 gap-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {data.mixedCurrency && (
            <p className="rounded-lg border border-line bg-surface p-3 text-sm text-ink-2">
              Кабинеты ведутся в разных валютах: общие суммы сложены без пересчёта и приблизительны.
            </p>
          )}
          <Kpis current={data.totals.current} previous={data.totals.previous} currency={data.currency} />
          <TrendChart daily={data.daily} currency={data.currency} scope="все кабинеты" />
          <AgentPanel
            report={data.lastReport}
            accounts={data.accounts}
            tests={data.tests}
            currency={data.currency}
            canWrite={canWrite}
            onRun={runDaily}
          />

          <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-base font-semibold">Что требует внимания</h2>
              <span className="text-sm text-muted">{data.insights.length > 0 ? `${data.insights.length} шт.` : ""}</span>
            </div>
            <InsightCards insights={data.insights} currency={data.currency} canWrite={canWrite} showCampaign onAct={actOnInsight} />
            <p className="mt-3 text-xs text-muted">
              Здесь — уровень кампаний. Запросы, площадки, фразы и объявления разбираются на странице кампании.
            </p>
          </section>

          <section className="grid grid-cols-1 gap-3" aria-label="Кабинеты">
            <h2 className="text-base font-semibold">Кабинеты и кампании</h2>
            {data.accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                days={days}
                canWrite={canWrite}
                onSettings={() => setSettingsFor(account)}
                onAct={(campaign, action) =>
                  actions.request({
                    accountId: account.id,
                    accountName: account.name,
                    campaignId: campaign.id,
                    campaignName: campaign.name,
                    action,
                    currentAmount: campaign.dailyBudget,
                  })
                }
              />
            ))}
          </section>

          <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
            <h2 className="text-base font-semibold">Журнал изменений</h2>
            {data.log.length === 0 ? (
              <p className="mt-2 text-sm text-ink-2">Пока ничего не менялось.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line text-sm">
                {data.log.slice(0, showAllLog ? undefined : LOG_PREVIEW).map((entry) => (
                  <li key={entry.id} className="py-2">
                    <div className="flex flex-wrap gap-x-3">
                      <span className="text-muted tabular-nums">{fmtDateTime(entry.at)}</span>
                      <span className="text-ink-2">{ACTOR[entry.actor ?? "human"]}</span>
                      <span className={entry.ok ? "" : "text-bad"}>
                        {entry.ok ? entry.description : `Не выполнено: ${entry.description}. ${entry.error}`}
                      </span>
                      <span className="text-ink-2">
                        {entry.campaignName} · {entry.accountName}
                      </span>
                    </div>
                    {entry.reason && <div className="mt-0.5 text-xs text-muted">{entry.reason}</div>}
                    {entry.outcome && (
                      <div className="mt-0.5 text-xs">
                        <span className={VERDICT[entry.outcome.verdict].color}>
                          {VERDICT[entry.outcome.verdict].icon} {VERDICT[entry.outcome.verdict].label}
                        </span>
                        <span className="text-muted"> — {entry.outcome.note}</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {data.log.length > LOG_PREVIEW && (
              <button type="button" onClick={() => setShowAllLog((v) => !v)} className="mt-2 text-sm text-accent hover:underline">
                {showAllLog ? "Свернуть" : `Показать ещё ${data.log.length - LOG_PREVIEW}`}
              </button>
            )}
          </section>
        </div>
      )}

      {actions.dialog}
      {settingsFor && (
        <SettingsDialog
          key={settingsFor.id}
          account={settingsFor}
          onClose={() => setSettingsFor(null)}
          onSaved={(message) => {
            setSettingsFor(null);
            actions.setNotice(message);
            refresh();
          }}
        />
      )}
    </main>
  );
}
