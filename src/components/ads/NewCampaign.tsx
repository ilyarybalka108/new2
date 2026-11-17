"use client";

import Link from "next/link";
import { useState } from "react";
import { lengths, LIMITS, REGION_PRESETS, validatePlan } from "@/lib/ads/plan";
import type { CampaignPlan, CreateResult, PlanAd } from "@/lib/ads/types";
import { ModeBadge, Notice, useData } from "./shared";

interface FormGroup {
  name: string;
  /** Ключевые фразы, по одной в строке. */
  keywords: string;
  ads: PlanAd[];
}

interface AccountsResponse {
  mode: "demo" | "live";
  writeEnabled: boolean;
  accounts: { id: string; name: string }[];
}

const emptyAd = (): PlanAd => ({ title: "", title2: "", text: "", href: "" });
const emptyGroup = (): FormGroup => ({ name: "", keywords: "", ads: [emptyAd()] });
const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

const field = "mt-1 block w-full rounded-lg border border-line bg-page px-3 py-2 text-base";
const label = "block text-sm";
const hint = "mt-1 block text-xs text-muted";

/** Счётчик символов рядом с полем: краснеет при превышении лимита. */
function Counter({ value, limit, narrow }: { value: string; limit: number; narrow: boolean }) {
  const used = narrow ? lengths(value).wide : [...value].length;
  return <span className={`tabular-nums ${used > limit ? "text-bad" : "text-muted"}`}>{used} / {limit}</span>;
}

export default function NewCampaign() {
  const { data: accounts, error: accountsError } = useData<AccountsResponse>("/api/ads/accounts", 0);

  const [accountId, setAccountId] = useState("");
  const [name, setName] = useState("");
  const [placement, setPlacement] = useState<CampaignPlan["placement"]>("search");
  const [strategy, setStrategy] = useState<CampaignPlan["strategy"]>("max_clicks");
  const [weeklyBudget, setWeeklyBudget] = useState("");
  const [goalId, setGoalId] = useState("");
  const [averageCpa, setAverageCpa] = useState("");
  const [counterId, setCounterId] = useState("");
  const [regions, setRegions] = useState<number[]>([225]);
  const [extraRegions, setExtraRegions] = useState("");
  const [negatives, setNegatives] = useState("");
  const [groups, setGroups] = useState<FormGroup[]>([emptyGroup()]);

  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreateResult | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [moderated, setModerated] = useState(false);

  const account = accountId || accounts?.accounts[0]?.id || "";
  const num = (value: string) => Number(value.replace(",", ".").replace(/\s/g, ""));

  const plan: CampaignPlan = {
    accountId: account,
    name: name.trim(),
    placement,
    strategy,
    weeklyBudget: num(weeklyBudget) || 0,
    goalId: goalId.trim() || undefined,
    averageCpa: averageCpa.trim() ? num(averageCpa) : undefined,
    counterId: counterId.trim() || undefined,
    regionIds: [...new Set([...regions, ...extraRegions.split(/[\s,;]+/).filter(Boolean).map(Number)])],
    negativeKeywords: lines(negatives),
    groups: groups.map((g) => ({
      name: g.name.trim(),
      keywords: lines(g.keywords),
      ads: g.ads.map((ad) => ({ title: ad.title.trim(), title2: ad.title2?.trim() || undefined, text: ad.text.trim(), href: ad.href.trim() })),
    })),
  };
  const issues = validatePlan(plan);
  const canWrite = Boolean(accounts?.writeEnabled);

  const patchGroup = (g: number, patch: Partial<FormGroup>) => setGroups((list) => list.map((item, i) => (i === g ? { ...item, ...patch } : item)));
  const patchAd = (g: number, a: number, patch: Partial<PlanAd>) =>
    patchGroup(g, { ads: groups[g].ads.map((ad, i) => (i === a ? { ...ad, ...patch } : ad)) });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setTried(true);
    if (issues.length || !canWrite) return;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/ads/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Кампания не создана");
      setResult(body as CreateResult);
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function moderate() {
    if (!result) return;
    setBusy(true);
    try {
      const res = await fetch("/api/ads/moderate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId: account, campaignName: plan.name, adIds: result.adIds }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Не удалось отправить на модерацию");
      setModerated(true);
      setNotice({ ok: true, text: "Объявления отправлены на модерацию" });
    } catch (err) {
      setNotice({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
        <Link href="/" className="text-sm text-accent hover:underline">
          ← Все кабинеты
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{result.ok ? "Кампания создана" : "Кампания создана не полностью"}</h1>
        <p className="mt-1 text-sm text-ink-2">{plan.name}</p>
        <Notice notice={notice} onClose={() => setNotice(null)} />

        <ul className="mt-5 divide-y divide-line rounded-xl border border-line bg-surface text-sm">
          {result.steps.map((s) => (
            <li key={s.step} className="flex gap-3 px-4 py-3">
              <span className={s.ok ? "text-good" : "text-bad"} aria-hidden>
                {s.ok ? "✓" : "✕"}
              </span>
              <span className="font-medium">{s.step}</span>
              <span className="text-ink-2">{s.detail}</span>
            </li>
          ))}
        </ul>

        <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm">
          Сейчас кампания — черновик: показов и расхода нет. Они начнутся после того, как объявления пройдут модерацию и на счёте будут средства.
          {accounts?.mode === "demo" ? " В демо-режиме модерации нет — кампания останется черновиком." : ""}
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          {result.campaignId && (
            <Link
              href={`/campaign/${encodeURIComponent(account)}/${encodeURIComponent(result.campaignId)}`}
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm"
            >
              Открыть кампанию
            </Link>
          )}
          {result.adIds.length > 0 && !moderated && (
            <button type="button" disabled={busy} onClick={moderate} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-page disabled:opacity-50">
              {busy ? "Отправляю…" : `Отправить на модерацию (${result.adIds.length})`}
            </button>
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/" className="text-sm text-accent hover:underline">
        ← Все кабинеты
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Новая кампания</h1>
        {accounts && <ModeBadge mode={accounts.mode} canWrite={canWrite} />}
      </div>
      <p className="mt-1 text-sm text-ink-2">
        Единая перфоманс-кампания с текстовыми объявлениями. Создаётся черновиком — показы начнутся только после отправки на модерацию.
      </p>

      {accountsError && (
        <p role="alert" className="mt-4 rounded-lg border border-line bg-surface p-3 text-sm text-bad">
          Не удалось получить список кабинетов: {accountsError}
        </p>
      )}
      {accounts && !canWrite && (
        <p className="mt-4 rounded-lg border border-line bg-surface p-3 text-sm text-ink-2">
          Кабинет работает в режиме «только чтение»: план можно подготовить и проверить, но создать кампанию нельзя, пока не задано ADS_ALLOW_WRITE=1.
        </p>
      )}
      <Notice notice={notice} onClose={() => setNotice(null)} />

      <form onSubmit={submit} className="mt-5 grid gap-5" noValidate>
        <section className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
          <h2 className="text-base font-semibold">Кампания</h2>
          <label className={label}>
            <span className="text-ink-2">Кабинет</span>
            <select value={account} onChange={(e) => setAccountId(e.target.value)} className={field}>
              {(accounts?.accounts ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className={label}>
            <span className="text-ink-2">Название</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={field} placeholder="Поиск | Услуга | Регион" />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className={label}>
              <span className="text-ink-2">Где показывать</span>
              <select value={placement} onChange={(e) => setPlacement(e.target.value as CampaignPlan["placement"])} className={field}>
                <option value="search">Только поиск</option>
                <option value="network">Только рекламная сеть (РСЯ)</option>
                <option value="both">Поиск и рекламная сеть</option>
              </select>
            </label>
            <label className={label}>
              <span className="text-ink-2">Стратегия</span>
              <select value={strategy} onChange={(e) => setStrategy(e.target.value as CampaignPlan["strategy"])} className={field}>
                <option value="max_clicks">Максимум кликов</option>
                <option value="max_conversions">Максимум конверсий</option>
                <option value="average_cpa">Средняя цена конверсии</option>
              </select>
            </label>
            <label className={label}>
              <span className="text-ink-2">Недельный бюджет, ₽</span>
              <input inputMode="decimal" value={weeklyBudget} onChange={(e) => setWeeklyBudget(e.target.value)} className={`${field} tabular-nums`} />
            </label>
            {strategy === "average_cpa" && (
              <label className={label}>
                <span className="text-ink-2">Средняя цена конверсии, ₽</span>
                <input inputMode="decimal" value={averageCpa} onChange={(e) => setAverageCpa(e.target.value)} className={`${field} tabular-nums`} />
              </label>
            )}
            <label className={label}>
              <span className="text-ink-2">Счётчик Метрики</span>
              <input inputMode="numeric" value={counterId} onChange={(e) => setCounterId(e.target.value)} className={`${field} tabular-nums`} />
              <span className={hint}>Необязательно, но без счётчика не будет конверсий в статистике.</span>
            </label>
            <label className={label}>
              <span className="text-ink-2">Цель Метрики{strategy === "max_clicks" ? "" : " (обязательно)"}</span>
              <input inputMode="numeric" value={goalId} onChange={(e) => setGoalId(e.target.value)} className={`${field} tabular-nums`} />
            </label>
          </div>

          <fieldset>
            <legend className="text-sm text-ink-2">Регионы показа</legend>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {REGION_PRESETS.map((r) => (
                <label key={r.id} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={regions.includes(r.id)}
                    onChange={(e) => setRegions((list) => (e.target.checked ? [...list, r.id] : list.filter((id) => id !== r.id)))}
                  />
                  {r.name}
                </label>
              ))}
            </div>
            <label className={`${label} mt-3`}>
              <span className="text-ink-2">Другие регионы — идентификаторы геобазы Яндекса через запятую</span>
              <input inputMode="numeric" value={extraRegions} onChange={(e) => setExtraRegions(e.target.value)} className={`${field} tabular-nums`} />
            </label>
          </fieldset>

          <label className={label}>
            <span className="text-ink-2">Минус-фразы кампании, по одной в строке</span>
            <textarea rows={3} value={negatives} onChange={(e) => setNegatives(e.target.value)} className={field} />
          </label>
        </section>

        {groups.map((group, g) => (
          <section key={g} className="grid gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Группа {g + 1}</h2>
              {groups.length > 1 && (
                <button type="button" onClick={() => setGroups((list) => list.filter((_, i) => i !== g))} className="text-sm text-ink-2 hover:text-bad">
                  Удалить группу
                </button>
              )}
            </div>
            <label className={label}>
              <span className="text-ink-2">Название группы</span>
              <input value={group.name} onChange={(e) => patchGroup(g, { name: e.target.value })} className={field} />
            </label>
            <label className={label}>
              <span className="text-ink-2">Ключевые фразы, по одной в строке · {lines(group.keywords).length}</span>
              <textarea rows={5} value={group.keywords} onChange={(e) => patchGroup(g, { keywords: e.target.value })} className={field} />
              <span className={hint}>До {LIMITS.keywordWords} слов в фразе, не считая минус-слов.</span>
            </label>

            {group.ads.map((ad, a) => (
              <div key={a} className="grid gap-3 rounded-lg border border-line p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-medium">Объявление {a + 1}</span>
                  {group.ads.length > 1 && (
                    <button type="button" onClick={() => patchGroup(g, { ads: group.ads.filter((_, i) => i !== a) })} className="text-ink-2 hover:text-bad">
                      Удалить
                    </button>
                  )}
                </div>
                <label className={label}>
                  <span className="flex justify-between text-ink-2">
                    Заголовок <Counter value={ad.title} limit={LIMITS.title} narrow={false} />
                  </span>
                  <input value={ad.title} onChange={(e) => patchAd(g, a, { title: e.target.value })} className={field} />
                </label>
                <label className={label}>
                  <span className="flex justify-between text-ink-2">
                    Второй заголовок <Counter value={ad.title2 ?? ""} limit={LIMITS.title2} narrow />
                  </span>
                  <input value={ad.title2 ?? ""} onChange={(e) => patchAd(g, a, { title2: e.target.value })} className={field} />
                </label>
                <label className={label}>
                  <span className="flex justify-between text-ink-2">
                    Текст <Counter value={ad.text} limit={LIMITS.text} narrow />
                  </span>
                  <textarea rows={2} value={ad.text} onChange={(e) => patchAd(g, a, { text: e.target.value })} className={field} />
                </label>
                <label className={label}>
                  <span className="text-ink-2">Ссылка</span>
                  <input inputMode="url" value={ad.href} onChange={(e) => patchAd(g, a, { href: e.target.value })} className={field} placeholder="https://" />
                </label>
              </div>
            ))}
            <div>
              <button type="button" onClick={() => patchGroup(g, { ads: [...group.ads, emptyAd()] })} className="rounded-lg border border-line px-3 py-1.5 text-sm hover:border-axis">
                Добавить объявление
              </button>
            </div>
          </section>
        ))}

        <div>
          <button type="button" onClick={() => setGroups((list) => [...list, emptyGroup()])} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:border-axis">
            Добавить группу
          </button>
        </div>

        {tried && issues.length > 0 && (
          <section role="alert" className="rounded-xl border border-line bg-surface p-4 text-sm sm:p-5">
            <h2 className="font-semibold text-bad">Что нужно исправить · {issues.length}</h2>
            <ul className="mt-2 list-disc pl-5">
              {issues.map((issue, i) => (
                <li key={`${issue.path}:${i}`}>{issue.message}</li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={busy || !canWrite} className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-page disabled:opacity-50">
            {busy ? "Создаю…" : "Создать черновик кампании"}
          </button>
          <span className="text-sm text-ink-2">
            {accounts?.mode === "live" ? "Кампания будет создана в рекламном кабинете через API." : "Демо-режим: в реальные кабинеты ничего не отправляется."}
          </span>
        </div>
      </form>
    </main>
  );
}
