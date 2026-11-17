"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/ads/format";
import { change, derive } from "@/lib/ads/metrics";
import type { ActionRequest, EntityState, Insight, Metrics, ProposedAction, Severity } from "@/lib/ads/types";

export const PERIODS = [7, 14, 30];

export const STATE_LABEL: Record<EntityState, { text: string; dot: string }> = {
  active: { text: "Идут показы", dot: "bg-st-good" },
  paused: { text: "Остановлено", dot: "bg-muted" },
  inactive: { text: "Не активно", dot: "bg-st-warning" },
  ended: { text: "Завершено", dot: "bg-muted" },
  archived: { text: "В архиве", dot: "bg-muted" },
  unknown: { text: "Неизвестно", dot: "bg-muted" },
};

export const KIND_LABEL: Record<string, string> = {
  TEXT_CAMPAIGN: "Текстово-графическая",
  UNIFIED_CAMPAIGN: "Единая перфоманс-кампания",
  SMART_CAMPAIGN: "Смарт-баннеры",
  DYNAMIC_TEXT_CAMPAIGN: "Динамические объявления",
  MOBILE_APP_CAMPAIGN: "Реклама приложений",
  CPM_BANNER_CAMPAIGN: "Медийная",
};

export const STRATEGY_LABEL: Record<string, string> = {
  HIGHEST_POSITION: "Ручное управление ставками",
  WB_MAXIMUM_CLICKS: "Максимум кликов",
  WB_MAXIMUM_CONVERSION_RATE: "Максимум конверсий",
  AVERAGE_CPC: "Средняя цена клика",
  AVERAGE_CPA: "Средняя цена конверсии",
  AVERAGE_CRR: "Доля рекламных расходов",
  PAY_FOR_CONVERSION: "Оплата за конверсии",
  PAY_FOR_CONVERSION_CRR: "Оплата за конверсии, ДРР",
  NETWORK_DEFAULT: "Как на поиске",
  MAXIMUM_COVERAGE: "Ручное управление в сетях",
};

const SEVERITY: Record<Severity, { label: string; icon: string; color: string }> = {
  critical: { label: "Критично", icon: "●", color: "text-st-critical" },
  warning: { label: "Внимание", icon: "▲", color: "text-st-serious" },
  opportunity: { label: "Возможность", icon: "◆", color: "text-st-good" },
};

export function actionLabel(action: ProposedAction, currency: string): string {
  switch (action.type) {
    case "pause":
      return action.target === "campaign" ? "Остановить кампанию" : action.target === "ad" ? "Остановить объявление" : "Остановить фразу";
    case "resume":
      return action.target === "campaign" ? "Запустить кампанию" : action.target === "ad" ? "Запустить объявление" : "Запустить фразу";
    case "set_budget":
      return `Поставить бюджет ${fmtMoney(action.amount, currency)}`;
    case "set_bid":
      return `Поставить ставку ${fmtMoney(action.amount, currency)}`;
    case "add_negatives":
      return "Добавить в минус-фразы";
    case "exclude_placements":
      return "Запретить площадку";
  }
}

function actionTitle(action: ProposedAction): string {
  switch (action.type) {
    case "set_budget":
      return "Изменить дневной бюджет";
    case "set_bid":
      return "Изменить ставку";
    case "add_negatives":
      return "Добавить минус-фразы";
    case "exclude_placements":
      return "Запретить показы на площадке";
    default:
      return actionLabel(action, "RUB");
  }
}

export function StatePill({ state }: { state: EntityState }) {
  const s = STATE_LABEL[state];
  return (
    <span className="whitespace-nowrap">
      <span className={`mr-1.5 inline-block size-2 rounded-full ${s.dot}`} aria-hidden />
      {s.text}
    </span>
  );
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

export function Kpis({ current, previous, currency }: { current: Metrics; previous: Metrics; currency: string }) {
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

export function PeriodSwitch({ days, onChange }: { days: number; onChange: (days: number) => void }) {
  return (
    <div className="flex rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Период">
      {PERIODS.map((p) => (
        <button
          key={p}
          type="button"
          aria-pressed={days === p}
          onClick={() => onChange(p)}
          className={`rounded-md px-3 py-1 text-sm ${days === p ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
        >
          {p} дней
        </button>
      ))}
    </div>
  );
}

export function ModeBadge({ mode, canWrite }: { mode: "demo" | "live"; canWrite: boolean }) {
  return (
    <span className="rounded-full border border-line px-3 py-1 text-sm text-ink-2">
      {mode === "demo" ? "Демо-данные" : canWrite ? "Боевые кабинеты" : "Боевые кабинеты · только чтение"}
    </span>
  );
}

// --- рекомендации -------------------------------------------------------------

export function InsightCards({
  insights,
  currency,
  canWrite,
  showCampaign,
  onAct,
}: {
  insights: Insight[];
  currency: string;
  canWrite: boolean;
  /** На общей странице показываем, к какой кампании и кабинету относится рекомендация. */
  showCampaign: boolean;
  onAct: (insight: Insight) => void;
}) {
  if (insights.length === 0) {
    return <p className="mt-3 text-sm text-ink-2">За этот период правила не нашли проблем и точек роста.</p>;
  }
  return (
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
              {showCampaign && <span className="text-muted">· {i.accountName}</span>}
            </div>
            <div className="mt-1.5 font-semibold">{i.title}</div>
            {showCampaign && <div className="text-sm text-ink-2">{i.campaignName}</div>}
            <p className="mt-2 text-sm leading-relaxed">{i.detail}</p>
            {i.action && (
              <div className="mt-auto pt-3">
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
  );
}

// --- подтверждение и выполнение действий ---------------------------------------

/** Действие, ожидающее подтверждения человеком. */
export interface Pending {
  accountId: string;
  accountName: string;
  campaignId: string;
  campaignName: string;
  action: ProposedAction;
  /** Объект внутри кампании: текст фразы, заголовок объявления, запрос, площадка. */
  label?: string;
  /** Почему действие предлагается (из рекомендации). */
  reason?: string;
  /** Текущее значение бюджета или ставки — показать рядом с полем ввода. */
  currentAmount?: number | null;
}

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
  const { action } = pending;
  const hasAmount = action.type === "set_budget" || action.type === "set_bid";
  const [amount, setAmount] = useState(hasAmount ? String(action.amount) : "");
  const parsed = Number(amount.replace(",", "."));
  const valid = !hasAmount || (Number.isFinite(parsed) && parsed > 0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const list = action.type === "add_negatives" ? action.phrases : action.type === "exclude_placements" ? action.sites : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="max-h-full w-full max-w-md overflow-y-auto rounded-xl border border-line bg-surface p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onConfirm(hasAmount ? { ...action, amount: parsed } : action);
        }}
      >
        <h2 id="confirm-title" className="text-lg font-semibold">
          {actionTitle(action)}
        </h2>
        <p className="mt-2 text-sm">
          <span className="font-medium">{pending.campaignName}</span>
          <span className="text-ink-2"> · {pending.accountName}</span>
        </p>
        {pending.label && !list && <p className="mt-1 text-sm">{pending.label}</p>}
        {list && (
          <ul className="mt-2 list-disc pl-5 text-sm">
            {list.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        )}
        {pending.reason && <p className="mt-2 text-sm text-ink-2">{pending.reason}</p>}

        {hasAmount && (
          <label className="mt-4 block text-sm">
            <span className="text-ink-2">
              {action.type === "set_budget" ? "Новый дневной бюджет" : "Новая ставка на поиске"}
              {pending.currentAmount ? `, сейчас ${fmtMoney(pending.currentAmount, currency)}` : ""}
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
            autoFocus={!hasAmount}
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

export function Notice({ notice, onClose }: { notice: { ok: boolean; text: string } | null; onClose: () => void }) {
  if (!notice) return null;
  return (
    <p
      role="status"
      className={`mt-4 flex items-center justify-between gap-3 rounded-lg border border-line bg-surface p-3 text-sm ${notice.ok ? "" : "text-bad"}`}
    >
      <span>
        {notice.ok ? "✓ " : "✕ "}
        {notice.text}
      </span>
      <button type="button" onClick={onClose} className="text-muted hover:text-ink" aria-label="Скрыть">
        ✕
      </button>
    </p>
  );
}

/**
 * Общий механизм действий: запрос подтверждения, отправка, сообщение о результате.
 * `onDone` вызывается после любой попытки — страница перечитывает данные.
 */
export function useActions(live: boolean, currency: string, onDone: () => void) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const cancel = useCallback(() => setPending(null), []);

  async function confirm(action: ProposedAction) {
    if (!pending) return;
    setBusy(true);
    const req: ActionRequest = { accountId: pending.accountId, campaignId: pending.campaignId, action, label: pending.label };
    try {
      const res = await fetch("/api/ads/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Действие не выполнено");
      setNotice({ ok: true, text: `${body.description} — ${pending.campaignName}` });
    } catch (e) {
      setNotice({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
      setPending(null);
      onDone();
    }
  }

  const dialog = pending ? (
    <ConfirmDialog
      key={`${pending.campaignId}:${JSON.stringify(pending.action)}`}
      pending={pending}
      live={live}
      currency={currency}
      busy={busy}
      onCancel={cancel}
      onConfirm={confirm}
    />
  ) : null;

  return { request: setPending, dialog, notice: <Notice notice={notice} onClose={() => setNotice(null)} />, setNotice };
}

/** Загрузка JSON с повтором по ключу; пока идёт новый запрос, остаются прежние данные. */
export function useData<T>(url: string | null, reloadKey: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const key = `${url}#${reloadKey}`;

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    fetch(url)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body as T;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoaded(`${url}#${reloadKey}`);
      });
    return () => {
      cancelled = true;
    };
  }, [url, reloadKey]);

  return { data, error, loading: url !== null && loaded !== key };
}
