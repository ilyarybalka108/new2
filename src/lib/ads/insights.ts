import { change, derive } from "./metrics.ts";
import type { AccountView, DailyPoint, Insight, Severity } from "./types.ts";

// Базовые правила директолога. Каждое правило объясняет, на каких цифрах сработало,
// и, где это безопасно, предлагает конкретное действие. Применяет его человек.

export const RULES = {
  /** Слив: расход без конверсий не меньше стольких средних CPA по аккаунту. */
  wasteCpaMultiple: 2,
  /** Дорогая кампания: CPA выше среднего по аккаунту во столько раз. */
  expensiveCpaMultiple: 1.6,
  /** Меньше этого числа конверсий — CPA кампании статистически ненадёжен. */
  minConversions: 3,
  /** Падение CTR к прошлому периоду, начиная с которого поднимаем флаг. */
  ctrDrop: 0.2,
  minImpressionsForCtr: 1000,
  /** Упор в бюджет: день считается «упёршимся», если расход ≥ этой доли лимита. */
  cappedSpendShare: 0.95,
  /** ...и таких дней должно быть не меньше этой доли периода. */
  cappedDaysShare: 0.6,
  /** Масштабируем только кампании с CPA заметно лучше среднего. */
  scaleCpaMultiple: 0.85,
  budgetStep: 0.2,
};

const ORDER: Record<Severity, number> = { critical: 0, warning: 1, opportunity: 2 };

function rub(value: number): string {
  return `${Math.round(value).toLocaleString("ru-RU")} ₽`;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** Дробное число с запятой, как принято в русской записи. */
function dec(value: number, digits: number): string {
  return value.toFixed(digits).replace(".", ",");
}

function roundBudget(value: number): number {
  return Math.max(100, Math.round(value / 100) * 100);
}

export interface InsightInput {
  account: AccountView;
  /** Статистика кампаний по дням за текущий период: campaignId → дни. */
  daily: Map<string, DailyPoint[]>;
  days: number;
}

export function analyzeAccount({ account, daily, days }: InsightInput): Insight[] {
  const out: (Insight & { weight: number })[] = [];
  const accountCpa = derive(account.current).cpa;

  for (const c of account.campaigns) {
    if (c.state !== "active") continue;
    const cur = derive(c.current);
    const prev = derive(c.previous);
    const base = {
      accountId: account.id,
      accountName: account.name,
      campaignId: c.id,
      campaignName: c.name,
    };

    // 1. Расход без конверсий. Если конверсий нет во всём аккаунте, скорее всего
    // не настроены цели — тогда правило молчит, чтобы не предлагать остановить всё подряд.
    if (accountCpa !== null && c.current.conversions === 0 && c.current.cost >= accountCpa * RULES.wasteCpaMultiple) {
      out.push({
        ...base,
        id: `waste:${account.id}:${c.id}`,
        severity: "critical",
        title: "Расход без конверсий",
        detail: `За ${days} дн. потрачено ${rub(c.current.cost)} и ни одной конверсии. Средняя цена конверсии по кабинету — ${rub(accountCpa)}, то есть бюджет на ${Math.floor(c.current.cost / accountCpa)} заявок ушёл впустую.`,
        action: { type: "pause" },
        weight: c.current.cost,
      });
      continue;
    }

    // 2. Конверсии есть, но заметно дороже среднего по кабинету.
    if (
      accountCpa !== null &&
      cur.cpa !== null &&
      c.current.conversions >= RULES.minConversions &&
      cur.cpa >= accountCpa * RULES.expensiveCpaMultiple
    ) {
      const canCut = c.budgetEditable && c.dailyBudget !== null;
      const newBudget = canCut ? roundBudget(c.dailyBudget! * (1 - RULES.budgetStep)) : null;
      out.push({
        ...base,
        id: `expensive:${account.id}:${c.id}`,
        severity: "warning",
        title: "Конверсии дороже среднего",
        detail:
          `CPA ${rub(cur.cpa)} против ${rub(accountCpa)} в среднем по кабинету (в ${dec(cur.cpa / accountCpa, 1)} раза дороже) при ${c.current.conversions} конверсиях. ` +
          (newBudget !== null
            ? `Предлагаю снизить дневной бюджет с ${rub(c.dailyBudget!)} до ${rub(newBudget)} и разобрать запросы и площадки.`
            : "Бюджет задан стратегией — нужно пересмотреть ставки, запросы и площадки вручную."),
        action: newBudget !== null ? { type: "set_budget", amount: newBudget } : undefined,
        weight: c.current.cost,
      });
    }

    // 3. CTR просел к прошлому периоду — обычно выгорели объявления или пришла конкуренция.
    const ctrChange = change(cur.ctr, prev.ctr);
    if (
      ctrChange !== null &&
      ctrChange <= -RULES.ctrDrop &&
      c.current.impressions >= RULES.minImpressionsForCtr &&
      c.previous.impressions >= RULES.minImpressionsForCtr
    ) {
      out.push({
        ...base,
        id: `ctr:${account.id}:${c.id}`,
        severity: "warning",
        title: "CTR заметно упал",
        detail: `CTR ${dec(cur.ctr! * 100, 2)}% против ${dec(prev.ctr! * 100, 2)}% за предыдущие ${days} дн. (−${pct(-ctrChange)}). Стоит обновить объявления и проверить позиции и конкурентов.`,
        weight: c.current.cost,
      });
    }

    // 4. Кампания окупается лучше среднего и упирается в дневной бюджет — её можно масштабировать.
    if (
      accountCpa !== null &&
      cur.cpa !== null &&
      c.budgetEditable &&
      c.dailyBudget !== null &&
      c.current.conversions >= RULES.minConversions &&
      cur.cpa <= accountCpa * RULES.scaleCpaMultiple
    ) {
      const points = daily.get(c.id) ?? [];
      const capped = points.filter((d) => d.cost >= c.dailyBudget! * RULES.cappedSpendShare).length;
      if (points.length > 0 && capped / days >= RULES.cappedDaysShare) {
        const newBudget = roundBudget(c.dailyBudget * (1 + RULES.budgetStep));
        out.push({
          ...base,
          id: `scale:${account.id}:${c.id}`,
          severity: "opportunity",
          title: "Упирается в бюджет при хорошем CPA",
          detail: `${capped} из ${days} дн. расход доходил до дневного лимита ${rub(c.dailyBudget)}, а CPA ${rub(cur.cpa)} — на ${pct(1 - cur.cpa / accountCpa)} ниже среднего по кабинету. Предлагаю поднять бюджет до ${rub(newBudget)}.`,
          action: { type: "set_budget", amount: newBudget },
          weight: c.current.cost,
        });
      }
    }
  }

  return out
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.weight - a.weight)
    .map((item) => {
      const { weight, ...insight } = item;
      void weight;
      return insight;
    });
}
