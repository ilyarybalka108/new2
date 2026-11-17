"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtDateTime, fmtDay, fmtInt, fmtMoney, fmtPct } from "@/lib/ads/format";
import { change, derive } from "@/lib/ads/metrics";
import type {
  AccountView,
  ActionRequest,
  CampaignState,
  CampaignView,
  Insight,
  Metrics,
  Overview,
  ProposedAction,
  Severity,
} from "@/lib/ads/types";
import TrendChart from "./TrendChart";

const PERIODS = [7, 14, 30];

/** Действие, ожидающее подтверждения человеком. */
interface Pending {
  accountId: string;
  accountName: string;
  campaign: CampaignView;
  action: ProposedAction;
  /** Почему действие предлагается (из рекомендации). */
  reason?: string;
}

const STATE_LABEL: Record<CampaignState, { text: string; dot: string }> = {
  active: { text: "Идут показы", dot: "bg-st-good" },
  paused: { text: "Остановлена", dot: "bg-muted" },
  inactive: { text: "Не активна", dot: "bg-st-warning" },
  ended: { text: "Завершена", dot: "bg-muted" },
  archived: { text: "В архиве", dot: "bg-muted" },
  unknown: { text: "Неизвестно", dot: "bg-muted" },
};

const KIND_LABEL: Record<string, string> = {
  TEXT_CAMPAIGN: "Текстово-графическая",
  UNIFIED_CAMPAIGN: "Единая перфоманс-кампания",
  SMART_CAMPAIGN: "Смарт-баннеры",
  DYNAMIC_TEXT_CAMPAIGN: "Динамические объявления",
  MOBILE_APP_CAMPAIGN: "Реклама приложений",
  CPM_BANNER_CAMPAIGN: "Медийная",
};

const SEVERITY: Record<Severity, { label: string; icon: string; color: string }> = {
  critical: { label: "Критично", icon: "●", color: "text-st-critical" },
  warning: { label: "Внимание", icon: "▲", color: "text-st-serious" },
  opportunity: { label: "Возможность", icon: "◆", color: "text-st-good" },
};

function actionLabel(action: ProposedAction, currency: string): string {
  switch (action.type) {
    case "pause":
      return "Остановить кампанию";
    case "resume":
      return "Запустить кампанию";
    case "set_budget":
      return `Поставить бюджет ${fmtMoney(action.amount, currency)}`;
  }
}

// --- сводные показатели -------------------------------------------------------

function Delta({ value, good }: { value: number | null; good: "up" | "down" | "none" }) {
  if (value === null) return <span className="text-muted">нет данных для сравнения</span>;
  const flat = Math.abs(value) < 0.005;
  const up = value > 0;
  const tone = flat || good === "none" ? "text-ink-2" : (good === "up") === up ? "text-good" : "text-bad";
  return (
    <span className={tone}>
      {flat ? "≈" : up ? "▲" : "▼"} {flat ? "без изменений" : `${Math.abs(value * 100).toFixed(1).replace(".", ",")}%`}
    </span>
  );
}

function Kpis({ current, previous, currency }: { current: Metrics; previous: Metrics; currency: string }) {
  const c = derive(current);
  const p = derive(previous);
  const tiles: { label: string; value: string; delta: number | null; good: "up" | "down" | "none" }[] = [
    { label: "Расход", value: fmtMoney(current.cost, currency), delta: change(current.cost, previous.cost), good: "none" },
    { label: "Конверсии", value: fmtInt(current.conversions), delta: change(current.conversions, previous.conversions), good: "up" },
    { label: "CPA", value: fmtMoney(c.cpa, currency), delta: change(c.cpa, p.cpa), good: "down" },
    { label: "Клики", value: fmtInt(current.clicks), delta: change(current.clicks, previous.clicks), good: "up" },
    { label: "CPC", value: fmtMoney(c.cpc, currency, 2), delta: change(c.cpc, p.cpc), good: "down" },
    { label: "CTR", value: fmtPct(c.ctr), delta: change(c.ctr, p.ctr), good: "up" },
  ];
  return (
    <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" aria-label="Сводные показатели">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl border border-line bg-surface p-4">
          <div className="text-sm text-ink-2">{t.label}</div>
          <div className="mt-1 text-2xl font-semibold">{t.value}</div>
          <div className="mt-1 text-xs">
            <Delta value={t.delta} good={t.good} />
          </div>
        </div>
      ))}
    </section>
  );
}

// --- рекомендации -------------------------------------------------------------

function Insights({
  insights,
  currency,
  canWrite,
  onAct,
}: {
  insights: Insight[];
  currency: string;
  canWrite: boolean;
  onAct: (insight: Insight) => void;
}) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">Что требует внимания</h2>
        <span className="text-sm text-muted">{insights.length > 0 ? `${insights.length} шт.` : ""}</span>
      </div>
      {insights.length === 0 ? (
        <p className="mt-3 text-sm text-ink-2">За этот период правила не нашли проблем и точек роста.</p>
      ) : (
        <ul className="mt-3 grid gap-3 lg:grid-cols-2">
          {insights.map((i) => {
            const s = SEVERITY[i.severity];
            return (
              <li key={i.id} className="flex flex-col rounded-lg border border-line p-3.5">
                <div className="flex items-center gap-2 text-sm">
                  <span className={s.color} aria-hidden>
                    {s.icon}
                  </span>
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted">· {i.accountName}</span>
                </div>
                <div className="mt-1.5 font-semibold">{i.title}</div>
                <div className="text-sm text-ink-2">{i.campaignName}</div>
                <p className="mt-2 text-sm leading-relaxed">{i.detail}</p>
                {i.action && (
                  <div className="mt-3">
                    <button
                      type="button"
                      disabled={!canWrite}
                      onClick={() => onAct(i)}
                      title={canWrite ? undefined : "Кабинет в режиме «только чтение»"}
                      className="rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm font-medium hover:border-axis disabled:opacity-50"
                    >
                      {actionLabel(i.action, currency)}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

// --- кабинеты и кампании ------------------------------------------------------

function AccountCard({
  account,
  canWrite,
  onAct,
}: {
  account: AccountView;
  canWrite: boolean;
  onAct: (campaign: CampaignView, action: ProposedAction) => void;
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
      </summary>

      {account.error ? (
        <p className="border-t border-line p-4 text-sm text-bad sm:px-5">Не удалось получить данные: {account.error}</p>
      ) : (
        <div className="overflow-x-auto border-t border-line">
          <table className="w-full min-w-[880px] text-sm tabular-nums">
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
                <th className="px-3 py-2 text-right font-normal">Бюджет в день</th>
                <th className="px-4 py-2 text-right font-normal sm:pr-5">Действие</th>
              </tr>
            </thead>
            <tbody>
              {account.campaigns.map((c) => {
                const m = derive(c.current);
                const st = STATE_LABEL[c.state];
                return (
                  <tr key={c.id} className="border-t border-line align-top">
                    <td className="px-4 py-2.5 sm:pl-5">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-muted">{(c.kind && KIND_LABEL[c.kind]) ?? c.kind ?? ""}</div>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className={`mr-1.5 inline-block size-2 rounded-full ${st.dot}`} aria-hidden />
                      {st.text}
                    </td>
                    <td className="px-3 py-2.5 text-right">{fmtMoney(c.current.cost, cur)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtInt(c.current.clicks)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtPct(m.ctr)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtMoney(m.cpc, cur, 2)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtInt(c.current.conversions)}</td>
                    <td className="px-3 py-2.5 text-right">{fmtMoney(m.cpa, cur)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {c.dailyBudget === null ? (
                        <span className="text-muted" title="Бюджет задаётся автостратегией">
                          стратегия
                        </span>
                      ) : (
                        <>
                          {fmtMoney(c.dailyBudget, cur)}
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
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right sm:pr-5">
                      {(c.state === "active" || c.state === "paused") && (
                        <button
                          type="button"
                          disabled={!canWrite}
                          onClick={() => onAct(c, { type: c.state === "active" ? "pause" : "resume" })}
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

// --- подтверждение действия ---------------------------------------------------

function ConfirmDialog({
  pending,
  live,
  currency,
  busy,
  onCancel,
  onConfirm,
}: {
  pending: Pending;
  live: boolean;
  currency: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (action: ProposedAction) => void;
}) {
  const isBudget = pending.action.type === "set_budget";
  const [amount, setAmount] = useState(pending.action.type === "set_budget" ? String(pending.action.amount) : "");
  const parsed = Number(amount.replace(",", "."));
  const valid = !isBudget || (Number.isFinite(parsed) && parsed > 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const title = isBudget
    ? "Изменить дневной бюджет"
    : pending.action.type === "pause"
      ? "Остановить кампанию"
      : "Запустить кампанию";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-md rounded-xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onConfirm(isBudget ? { type: "set_budget", amount: parsed } : pending.action);
        }}
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-2 text-sm">
          <span className="font-medium">{pending.campaign.name}</span>
          <span className="text-ink-2"> · {pending.accountName}</span>
        </p>
        {pending.reason && <p className="mt-2 text-sm text-ink-2">{pending.reason}</p>}

        {isBudget && (
          <label className="mt-4 block text-sm">
            <span className="text-ink-2">
              Новый дневной бюджет, сейчас {fmtMoney(pending.campaign.dailyBudget, currency)}
            </span>
            <input
              autoFocus
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-line bg-page px-3 py-2 text-base tabular-nums"
            />
          </label>
        )}

        <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm">
          {live
            ? "Изменение сразу уйдёт в рекламный кабинет через API."
            : "Демо-режим: меняются только демонстрационные данные, в реальные кабинеты ничего не отправляется."}
        </p>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-lg border border-line px-4 py-2 text-sm">
            Отмена
          </button>
          <button
            type="submit"
            autoFocus={!isBudget}
            disabled={busy || !valid}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-page disabled:opacity-50"
          >
            {busy ? "Применяю…" : "Подтвердить"}
          </button>
        </div>
      </form>
    </div>
  );
}

// --- страница -----------------------------------------------------------------

export default function Dashboard() {
  const [days, setDays] = useState(7);
  const [reload, setReload] = useState(0);
  const [data, setData] = useState<Overview | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const requestKey = `${days}:${reload}`;
  const loading = loaded !== requestKey;

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ads/overview?days=${days}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body as Overview;
      })
      .then((overview) => {
        if (cancelled) return;
        setData(overview);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoaded(`${days}:${reload}`);
      });
    return () => {
      cancelled = true;
    };
  }, [days, reload]);

  const cancel = useCallback(() => setPending(null), []);

  async function confirm(action: ProposedAction) {
    if (!pending) return;
    setBusy(true);
    const req: ActionRequest = { accountId: pending.accountId, campaignId: pending.campaign.id, action };
    try {
      const res = await fetch("/api/ads/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Действие не выполнено");
      setNotice({ ok: true, text: `${body.description}: ${pending.campaign.name}` });
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setPending(null);
      setReload((n) => n + 1);
    }
  }

  function actOnInsight(insight: Insight) {
    const account = data?.accounts.find((a) => a.id === insight.accountId);
    const campaign = account?.campaigns.find((c) => c.id === insight.campaignId);
    if (!account || !campaign || !insight.action) return;
    setPending({
      accountId: account.id,
      accountName: account.name,
      campaign,
      action: insight.action,
      reason: `${insight.title}. ${insight.detail}`,
    });
  }

  const canWrite = Boolean(data?.writeEnabled);

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
          {data && (
            <span className="rounded-full border border-line px-3 py-1 text-sm text-ink-2">
              {data.mode === "demo" ? "Демо-данные" : canWrite ? "Боевые кабинеты" : "Боевые кабинеты · только чтение"}
            </span>
          )}
          <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Период">
            {PERIODS.map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={days === p}
                onClick={() => setDays(p)}
                className={`rounded-md px-3 py-1 text-sm ${
                  days === p ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"
                }`}
              >
                {p} дней
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setReload((n) => n + 1)}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink-2 hover:text-ink"
          >
            Обновить
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="mt-4 rounded-lg border border-line bg-surface p-3 text-sm text-bad">
          Не удалось загрузить данные: {error}
        </p>
      )}
      {notice && (
        <p
          role="status"
          className={`mt-4 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3 text-sm ${
            notice.ok ? "" : "text-bad"
          }`}
        >
          <span>
            {notice.ok ? "✓ " : "✕ "}
            {notice.text}
          </span>
          <button type="button" onClick={() => setNotice(null)} className="text-muted hover:text-ink" aria-label="Скрыть">
            ✕
          </button>
        </p>
      )}

      {data && (
        <div className={`mt-5 grid grid-cols-1 gap-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
          {data.mixedCurrency && (
            <p className="rounded-lg border border-line bg-surface p-3 text-sm text-ink-2">
              Кабинеты ведутся в разных валютах: общие суммы сложены без пересчёта и приблизительны.
            </p>
          )}
          <Kpis current={data.totals.current} previous={data.totals.previous} currency={data.currency} />
          <TrendChart daily={data.daily} currency={data.currency} />
          <Insights insights={data.insights} currency={data.currency} canWrite={canWrite} onAct={actOnInsight} />

          <section className="grid grid-cols-1 gap-3" aria-label="Кабинеты">
            <h2 className="text-base font-semibold">Кабинеты и кампании</h2>
            {data.accounts.map((account) => (
              <AccountCard
                key={account.id}
                account={account}
                canWrite={canWrite}
                onAct={(campaign, action) =>
                  setPending({ accountId: account.id, accountName: account.name, campaign, action })
                }
              />
            ))}
          </section>

          <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
            <h2 className="text-base font-semibold">Журнал действий</h2>
            {data.log.length === 0 ? (
              <p className="mt-2 text-sm text-ink-2">Пока ничего не менялось.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line text-sm">
                {data.log.map((entry) => (
                  <li key={entry.id} className="flex flex-wrap gap-x-3 py-2">
                    <span className="text-muted tabular-nums">{fmtDateTime(entry.at)}</span>
                    <span className={entry.ok ? "" : "text-bad"}>
                      {entry.ok ? entry.description : `Ошибка: ${entry.error}`}
                    </span>
                    <span className="text-ink-2">
                      {entry.campaignName} · {entry.accountName}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {pending && data && (
        <ConfirmDialog
          key={`${pending.campaign.id}:${pending.action.type}`}
          pending={pending}
          live={data.mode === "live"}
          currency={data.currency}
          busy={busy}
          onCancel={cancel}
          onConfirm={confirm}
        />
      )}
    </main>
  );
}
