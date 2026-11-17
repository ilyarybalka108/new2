"use client";

import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useState } from "react";
import { fmtDay, fmtInt, fmtMoney, fmtPct } from "@/lib/ads/format";
import { derive } from "@/lib/ads/metrics";
import type { BreakdownLevel, BreakdownRow, CampaignDetail, Insight, ProposedAction } from "@/lib/ads/types";
import {
  InsightCards,
  KIND_LABEL,
  Kpis,
  ModeBadge,
  PERIODS,
  PeriodSwitch,
  StatePill,
  STRATEGY_LABEL,
  useActions,
  useData,
} from "./shared";
import TrendChart from "./TrendChart";

const TABS: { level: BreakdownLevel; label: string; first: string; empty: string }[] = [
  { level: "groups", label: "Группы", first: "Группа", empty: "В кампании нет групп." },
  { level: "ads", label: "Объявления", first: "Объявление", empty: "В кампании нет объявлений." },
  { level: "keywords", label: "Фразы", first: "Фраза", empty: "В кампании нет ключевых фраз." },
  { level: "queries", label: "Поисковые запросы", first: "Запрос", empty: "За период нет показов на поиске." },
  { level: "placements", label: "Площадки", first: "Площадка", empty: "За период нет показов в сетях." },
];

const ORDER = { critical: 0, warning: 1, opportunity: 2 };

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function BreakdownTable({
  level,
  rows,
  first,
  currency,
  canWrite,
  onAct,
}: {
  level: BreakdownLevel;
  rows: BreakdownRow[];
  first: string;
  currency: string;
  canWrite: boolean;
  onAct: (row: BreakdownRow, action: ProposedAction) => void;
}) {
  const hasGroup = level !== "groups" && level !== "placements";
  const hasState = level === "ads" || level === "keywords";
  const hasBid = level === "keywords";
  const hasAction = level !== "groups";
  const button = "rounded-md border border-line px-2.5 py-1 whitespace-nowrap hover:border-axis disabled:opacity-40";

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm tabular-nums">
        <thead className="text-left text-muted">
          <tr>
            <th className="px-4 py-2 font-normal sm:pl-5">{first}</th>
            {hasGroup && <th className="px-3 py-2 font-normal">Группа</th>}
            {hasState && <th className="px-3 py-2 font-normal">Статус</th>}
            <th className="px-3 py-2 text-right font-normal">Показы</th>
            <th className="px-3 py-2 text-right font-normal">Клики</th>
            <th className="px-3 py-2 text-right font-normal">CTR</th>
            <th className="px-3 py-2 text-right font-normal">Расход</th>
            <th className="px-3 py-2 text-right font-normal">Конв.</th>
            <th className="px-3 py-2 text-right font-normal">CPA</th>
            {hasBid && <th className="px-3 py-2 text-right font-normal">Ставка</th>}
            {hasAction && <th className="px-4 py-2 text-right font-normal sm:pr-5">Действие</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const m = derive(row);
            return (
              <tr key={row.key} className="border-t border-line align-top">
                <td className="max-w-md px-4 py-2.5 sm:pl-5">
                  <div className="font-medium break-words">{row.label}</div>
                  {row.sublabel && <div className="text-xs text-muted">{row.sublabel}</div>}
                </td>
                {hasGroup && <td className="px-3 py-2.5 text-ink-2">{row.groupName ?? "—"}</td>}
                {hasState && <td className="px-3 py-2.5">{row.state && <StatePill state={row.state} />}</td>}
                <td className="px-3 py-2.5 text-right">{fmtInt(row.impressions)}</td>
                <td className="px-3 py-2.5 text-right">{fmtInt(row.clicks)}</td>
                <td className="px-3 py-2.5 text-right">{fmtPct(m.ctr)}</td>
                <td className="px-3 py-2.5 text-right">{fmtMoney(row.cost, currency)}</td>
                <td className="px-3 py-2.5 text-right">{fmtInt(row.conversions)}</td>
                <td className="px-3 py-2.5 text-right">{fmtMoney(m.cpa, currency)}</td>
                {hasBid && (
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    {row.bid ? (
                      <>
                        {fmtMoney(row.bid, currency)}
                        <button
                          type="button"
                          disabled={!canWrite}
                          onClick={() => onAct(row, { type: "set_bid", keywordId: row.key, amount: row.bid! })}
                          aria-label={`Изменить ставку фразы «${row.label}»`}
                          className="ml-2 text-accent hover:underline disabled:opacity-40"
                        >
                          изменить
                        </button>
                      </>
                    ) : (
                      <span className="text-muted" title="Ставкой управляет стратегия">
                        авто
                      </span>
                    )}
                  </td>
                )}
                {hasAction && (
                  <td className="px-4 py-2.5 text-right sm:pr-5">
                    {hasState && (row.state === "active" || row.state === "paused") && (
                      <button
                        type="button"
                        disabled={!canWrite}
                        onClick={() =>
                          onAct(row, {
                            type: row.state === "active" ? "pause" : "resume",
                            target: level === "ads" ? "ad" : "keyword",
                            id: row.key,
                          })
                        }
                        className={button}
                      >
                        {row.state === "active" ? "Пауза" : "Запустить"}
                      </button>
                    )}
                    {level === "queries" &&
                      (row.handled ? (
                        <span className="text-muted">в минус-фразах</span>
                      ) : (
                        <button type="button" disabled={!canWrite} onClick={() => onAct(row, { type: "add_negatives", phrases: [row.key] })} className={button}>
                          В минус-фразы
                        </button>
                      ))}
                    {level === "placements" &&
                      (row.handled ? (
                        <span className="text-muted">запрещена</span>
                      ) : (
                        <button type="button" disabled={!canWrite} onClick={() => onAct(row, { type: "exclude_placements", sites: [row.key] })} className={button}>
                          Запретить
                        </button>
                      ))}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function CampaignView() {
  const params = useParams<{ accountId: string; campaignId: string }>();
  const search = useSearchParams();
  const accountId = decode(params.accountId);
  const campaignId = decode(params.campaignId);
  const initial = Number(search.get("days"));

  const [days, setDays] = useState(PERIODS.includes(initial) ? initial : 7);
  const [reload, setReload] = useState(0);
  const [tab, setTab] = useState<BreakdownLevel>("keywords");

  const base = `/api/ads/campaign?account=${encodeURIComponent(accountId)}&campaign=${encodeURIComponent(campaignId)}&days=${days}`;
  // Отчёт по поисковым запросам Директ строит дольше остальных — запрашиваем его отдельно.
  const main = useData<CampaignDetail>(`${base}&levels=groups,ads,keywords,placements`, reload);
  const queries = useData<CampaignDetail>(`${base}&levels=queries`, reload);
  const data = main.data;

  const refresh = () => setReload((n) => n + 1);
  const actions = useActions(data?.mode === "live", data?.account.currency ?? "RUB", refresh);
  const canWrite = Boolean(data?.writeEnabled);

  if (main.error && !data) {
    return (
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <Link href="/" className="text-sm text-accent hover:underline">
          ← Все кабинеты
        </Link>
        <p role="alert" className="mt-4 rounded-lg border border-line bg-surface p-3 text-sm text-bad">
          Не удалось загрузить кампанию: {main.error}
        </p>
      </main>
    );
  }
  if (!data) return <p className="p-6 text-sm text-ink-2">Загружаю кампанию…</p>;

  const { campaign, account } = data;
  const currency = account.currency;
  const rowsOf = (level: BreakdownLevel) => (level === "queries" ? (queries.data?.breakdowns.queries ?? []) : data.breakdowns[level]);
  const errorOf = (level: BreakdownLevel) =>
    level === "queries" ? (queries.error ?? queries.data?.breakdownErrors.queries) : data.breakdownErrors[level];
  const insights: Insight[] = [...data.insights, ...(queries.data?.insights ?? [])].sort((a, b) => ORDER[a.severity] - ORDER[b.severity]);

  const pendingBase = { accountId: account.id, accountName: account.name, campaignId: campaign.id, campaignName: campaign.name };

  function actOnInsight(insight: Insight) {
    if (!insight.action) return;
    const a = insight.action;
    const keyword = a.type === "set_bid" ? data!.breakdowns.keywords.find((k) => k.key === a.keywordId) : undefined;
    actions.request({
      ...pendingBase,
      action: a,
      label: insight.subject,
      reason: `${insight.title}. ${insight.detail}`,
      currentAmount: a.type === "set_bid" ? keyword?.bid : campaign.dailyBudget,
    });
  }

  const active = TABS.find((t) => t.level === tab)!;
  const rows = rowsOf(tab);
  const tabError = errorOf(tab);
  const tabLoading = tab === "queries" ? queries.loading && !queries.data : false;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/" className="text-sm text-accent hover:underline">
        ← Все кабинеты
      </Link>

      <header className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold break-words">{campaign.name}</h1>
          <p className="mt-0.5 text-sm text-ink-2">
            {account.name} · <StatePill state={campaign.state} />
            {campaign.kind ? ` · ${KIND_LABEL[campaign.kind] ?? campaign.kind}` : ""}
            {campaign.strategy ? ` · ${STRATEGY_LABEL[campaign.strategy] ?? campaign.strategy}` : ""}
          </p>
          <p className="mt-0.5 text-sm text-ink-2">
            {fmtDay(data.range.from)} — {fmtDay(data.range.to)} ·{" "}
            {campaign.dailyBudget !== null
              ? `бюджет ${fmtMoney(campaign.dailyBudget, currency)} в день`
              : campaign.weeklyBudget !== null
                ? `бюджет ${fmtMoney(campaign.weeklyBudget, currency)} в неделю`
                : "бюджет не задан"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ModeBadge mode={data.mode} canWrite={canWrite} />
          <PeriodSwitch days={days} onChange={setDays} />
          {campaign.budgetEditable && campaign.dailyBudget !== null && (
            <button
              type="button"
              disabled={!canWrite}
              onClick={() => actions.request({ ...pendingBase, action: { type: "set_budget", amount: campaign.dailyBudget! }, currentAmount: campaign.dailyBudget })}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:border-axis disabled:opacity-40"
            >
              Изменить бюджет
            </button>
          )}
          {(campaign.state === "active" || campaign.state === "paused") && (
            <button
              type="button"
              disabled={!canWrite}
              onClick={() =>
                actions.request({ ...pendingBase, action: { type: campaign.state === "active" ? "pause" : "resume", target: "campaign", id: campaign.id } })
              }
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:border-axis disabled:opacity-40"
            >
              {campaign.state === "active" ? "Остановить" : "Запустить"}
            </button>
          )}
        </div>
      </header>

      {actions.notice}

      <div className={`mt-5 grid grid-cols-1 gap-5 transition-opacity ${main.loading ? "opacity-60" : ""}`}>
        <Kpis current={campaign.current} previous={campaign.previous} currency={currency} />
        <TrendChart daily={data.daily} currency={currency} scope="кампания" />

        <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-semibold">Что требует внимания в кампании</h2>
            <span className="text-sm text-muted">{insights.length > 0 ? `${insights.length} шт.` : ""}</span>
          </div>
          <p className="mt-1 text-sm text-ink-2">
            {data.referenceCpa === null
              ? "В кабинете нет конверсий и не задана целевая цена — правила по расходу без конверсий молчат. Задайте цель в настройках кабинета."
              : data.referenceCpaSource === "target"
                ? `Сравниваю с целевой ценой конверсии ${fmtMoney(data.referenceCpa, currency)}.`
                : `Сравниваю со средней ценой конверсии по кабинету ${fmtMoney(data.referenceCpa, currency)} — точнее будет задать целевую цену в настройках кабинета.`}
            {queries.loading && !queries.data ? " Отчёт по поисковым запросам ещё формируется." : ""}
          </p>
          <InsightCards insights={insights} currency={currency} canWrite={canWrite} showCampaign={false} onAct={actOnInsight} />
        </section>

        <section className="rounded-xl border border-line bg-surface">
          <div className="flex flex-wrap gap-1 border-b border-line p-2" role="tablist" aria-label="Детализация">
            {TABS.map((t) => {
              const count = rowsOf(t.level).length;
              return (
                <button
                  key={t.level}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.level}
                  onClick={() => setTab(t.level)}
                  className={`rounded-md px-3 py-1.5 text-sm ${tab === t.level ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
                >
                  {t.label}
                  {count > 0 && <span className="ml-1.5 text-muted">{count}</span>}
                </button>
              );
            })}
          </div>
          {tabError ? (
            <p className="p-4 text-sm text-bad sm:px-5">Не удалось загрузить: {tabError}</p>
          ) : tabLoading ? (
            <p className="p-4 text-sm text-ink-2 sm:px-5">Формирую отчёт по поисковым запросам — в Директе это занимает до нескольких минут…</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-ink-2 sm:px-5">{active.empty}</p>
          ) : (
            <BreakdownTable
              level={tab}
              rows={rows}
              first={active.first}
              currency={currency}
              canWrite={canWrite}
              onAct={(row, action) =>
                actions.request({ ...pendingBase, action, label: row.label, currentAmount: action.type === "set_bid" ? row.bid : undefined })
              }
            />
          )}
        </section>

        <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
          <h2 className="text-base font-semibold">Ограничения показов</h2>
          <div className="mt-3 grid gap-4 text-sm md:grid-cols-2">
            <div>
              <h3 className="text-ink-2">Минус-фразы кампании · {data.exclusions.negativeKeywords.length}</h3>
              <p className="mt-1 break-words">{data.exclusions.negativeKeywords.join(", ") || "Не заданы."}</p>
            </div>
            <div>
              <h3 className="text-ink-2">Запрещённые площадки · {data.exclusions.excludedSites.length}</h3>
              <p className="mt-1 break-words">{data.exclusions.excludedSites.join(", ") || "Не заданы."}</p>
            </div>
          </div>
        </section>
      </div>

      {actions.dialog}
    </main>
  );
}
