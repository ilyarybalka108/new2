"use client";

import { useState } from "react";
import { fmtDateTime, fmtMoney } from "@/lib/ads/format";
import type { AccountView, AdTest, ChangeOutcome, DailyReport } from "@/lib/ads/types";

export const VERDICT: Record<ChangeOutcome["verdict"], { icon: string; label: string; color: string }> = {
  improved: { icon: "▲", label: "Стало лучше", color: "text-good" },
  worse: { icon: "▼", label: "Стало хуже", color: "text-bad" },
  neutral: { icon: "≈", label: "Без заметных изменений", color: "text-ink-2" },
  insufficient: { icon: "…", label: "Мало данных", color: "text-muted" },
};

const PACING: Record<string, string> = { over: "перерасход", under: "недорасход", ok: "в плане" };

function plural(n: number, one: string, few: string, many: string): string {
  const d = n % 10;
  const h = n % 100;
  return `${n} ${d === 1 && h !== 11 ? one : d >= 2 && d <= 4 && (h < 12 || h > 14) ? few : many}`;
}

/** Что директолог сделал сам, что оставил человеку и чем закончились прошлые изменения. */
export default function AgentPanel({
  report,
  accounts,
  tests,
  currency,
  canWrite,
  onRun,
}: {
  report: DailyReport | null;
  accounts: AccountView[];
  tests: AdTest[];
  currency: string;
  canWrite: boolean;
  /** Запускает обход и возвращает его отчёт; после настоящего обхода страница перечитывает данные. */
  onRun: (dryRun: boolean) => Promise<DailyReport>;
}) {
  const [busy, setBusy] = useState<"run" | "dry" | null>(null);
  const [preview, setPreview] = useState<DailyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dryRun: boolean) {
    setBusy(dryRun ? "dry" : "run");
    setError(null);
    try {
      const result = await onRun(dryRun);
      setPreview(dryRun ? result : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const shown = preview ?? report;
  const applied = shown?.accounts.flatMap((a) => a.applied.map((x) => ({ ...x, accountName: a.accountName }))) ?? [];
  const waiting = shown?.accounts.reduce((n, a) => n + a.needsDecision.length, 0) ?? 0;
  const skipped = shown?.accounts.flatMap((a) => a.skipped.map((x) => ({ ...x, accountName: a.accountName }))) ?? [];
  const onAutopilot = accounts.filter((a) => a.settings.autopilot?.enabled).length;
  const running = tests.filter((t) => t.status === "running");
  const finished = tests.filter((t) => t.status === "finished").slice(0, 5);
  const button = "rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:border-axis disabled:opacity-50";

  return (
    <section className="rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">Работа директолога</h2>
          <p className="mt-1 text-sm text-ink-2">
            {report ? `Последний обход: ${fmtDateTime(report.at)}.` : "Обходов ещё не было."} Автопилот включён в {onAutopilot} из{" "}
            {plural(accounts.length, "кабинета", "кабинетов", "кабинетов")}.
            {!canWrite ? " Кабинет в режиме «только чтение» — изменения не выполняются." : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy !== null} onClick={() => run(true)} className={button}>
            {busy === "dry" ? "Считаю…" : "Пробный прогон"}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => run(false)} className={button}>
            {busy === "run" ? "Обхожу кабинеты…" : "Провести обход сейчас"}
          </button>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-bad">
          Обход не выполнен: {error}
        </p>
      )}

      {shown && (
        <>
          {preview && (
            <p className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
              Пробный прогон: ниже — что было бы сделано. Ничего не изменено.
            </p>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted">{preview ? "Было бы сделано" : "Сделано самостоятельно"}</dt>
              <dd className="text-xl font-semibold">{applied.length}</dd>
            </div>
            <div>
              <dt className="text-muted">Ждёт твоего решения</dt>
              <dd className="text-xl font-semibold">{waiting}</dd>
            </div>
            <div>
              <dt className="text-muted">Отложено</dt>
              <dd className="text-xl font-semibold">{skipped.length}</dd>
            </div>
            <div>
              <dt className="text-muted">Тестов идёт</dt>
              <dd className="text-xl font-semibold">{running.length}</dd>
            </div>
          </dl>

          {shown.accounts.some((a) => a.pacing || a.error) && (
            <ul className="mt-4 grid gap-1 text-sm">
              {shown.accounts.map((a) =>
                a.error ? (
                  <li key={a.accountId} className="text-bad">
                    {a.accountName}: {a.error}
                  </li>
                ) : a.pacing ? (
                  <li key={a.accountId}>
                    <span className={a.pacing.status === "over" ? "text-bad" : "text-ink-2"} aria-hidden>
                      {a.pacing.status === "over" ? "▲ " : a.pacing.status === "under" ? "▼ " : "● "}
                    </span>
                    {a.accountName}: потрачено {fmtMoney(a.pacing.spent, currency)}, прогноз на месяц {fmtMoney(a.pacing.projected, currency)} из{" "}
                    {fmtMoney(a.pacing.monthlyBudget, currency)} — {PACING[a.pacing.status]}
                  </li>
                ) : null,
              )}
            </ul>
          )}

          {applied.length > 0 && (
            <details className="mt-4 text-sm" open={applied.length <= 6}>
              <summary className="font-medium">{preview ? "Что было бы сделано" : "Что сделано"}</summary>
              <ul className="mt-2 divide-y divide-line">
                {applied.map((x, i) => (
                  <li key={i} className="py-2">
                    <div className={x.ok ? "" : "text-bad"}>
                      {x.ok ? "" : "Не выполнено: "}
                      {x.description}
                      <span className="text-ink-2">
                        {" "}
                        · {x.campaignName} · {x.accountName}
                      </span>
                    </div>
                    {x.error && <div className="text-bad">{x.error}</div>}
                    {x.reason && <div className="mt-0.5 text-xs text-muted">{x.reason}</div>}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {skipped.length > 0 && (
            <details className="mt-3 text-sm">
              <summary className="font-medium">Что отложено и почему</summary>
              <ul className="mt-2 grid gap-1">
                {skipped.map((x, i) => (
                  <li key={i}>
                    {x.title} <span className="text-ink-2">· {x.campaignName}</span> — {x.why}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {(shown.evaluated.length > 0 || shown.finishedTests.length > 0) && (
            <div className="mt-4 text-sm">
              <h3 className="font-medium">Итоги прошлых изменений</h3>
              <ul className="mt-2 grid gap-1.5">
                {shown.evaluated.map((x, i) => {
                  const v = VERDICT[x.verdict];
                  return (
                    <li key={i}>
                      <span className={v.color}>
                        {v.icon} {v.label}
                      </span>{" "}
                      — {x.description} <span className="text-ink-2">· {x.campaignName}</span>
                      <div className="text-xs text-muted">{x.note}</div>
                    </li>
                  );
                })}
                {shown.finishedTests.map((x, i) => (
                  <li key={`t${i}`}>
                    Тест завершён <span className="text-ink-2">· {x.campaignName}</span>
                    <div className="text-xs text-muted">
                      {x.hypothesis} — {x.note}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {(running.length > 0 || finished.length > 0) && (
        <div className="mt-4 text-sm">
          <h3 className="font-medium">Тесты объявлений</h3>
          <ul className="mt-2 divide-y divide-line">
            {[...running, ...finished].map((t) => (
              <li key={t.id} className="py-2">
                <div>
                  <span className={t.status === "running" ? "text-ink-2" : ""}>{t.status === "running" ? "Идёт" : "Завершён"}</span> · «{t.variantLabel}»
                  против «{t.controlLabel}» <span className="text-ink-2">· {t.campaignName}</span>
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  Гипотеза: {t.hypothesis}
                  {t.result ? ` Итог: ${t.result.note}` : ""}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
