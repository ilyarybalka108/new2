import { change, derive } from "./metrics.ts";
import type { AccountView, BreakdownLevel, BreakdownRow, CampaignView, DailyPoint, Insight, Severity } from "./types.ts";

// Правила директолога. Каждое правило объясняет, на каких цифрах сработало,
// и, где это безопасно, предлагает конкретное действие. Применяет его человек.

export const RULES = {
  /** Слив: расход кампании без конверсий не меньше стольких опорных CPA. */
  wasteCpaMultiple: 2,
  /** Дорогая кампания: CPA выше опорного во столько раз. */
  expensiveCpaMultiple: 1.6,
  /** Меньше этого числа конверсий — CPA объекта статистически ненадёжен. */
  minConversions: 3,
  /** Падение CTR к прошлому периоду, начиная с которого поднимаем флаг. */
  ctrDrop: 0.2,
  minImpressionsForCtr: 1000,
  /** Упор в бюджет: день считается «упёршимся», если расход ≥ этой доли лимита. */
  cappedSpendShare: 0.95,
  /** ...и таких дней должно быть не меньше этой доли периода. */
  cappedDaysShare: 0.6,
  /** Масштабируем только кампании с CPA заметно лучше опорного. */
  scaleCpaMultiple: 0.85,
  budgetStep: 0.2,

  /** Запрос или площадка без конверсий: расход не меньше этой доли опорного CPA... */
  wasteItemCpaShare: 0.7,
  /** ...и не меньше стольких кликов, чтобы не судить по случайным двум-трём. */
  wasteQueryClicks: 10,
  wastePlacementClicks: 20,
  /** Фраза без конверсий: расход не меньше стольких опорных CPA. */
  wasteKeywordCpaMultiple: 1.5,
  /** Фраза с конверсиями, но дороже опорного CPA во столько раз — снижаем ставку. */
  expensiveKeywordCpaMultiple: 2,
  bidStep: 0.2,
  /** Объявление слабее лучшего в группе: его CTR не выше этой доли лучшего. */
  weakAdCtrShare: 0.6,
  minImpressionsForAd: 300,
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

type Weighted = Insight & { weight: number };

function ranked(items: Weighted[]): Insight[] {
  return items
    .sort((a, b) => ORDER[a.severity] - ORDER[b.severity] || b.weight - a.weight)
    .map((item) => {
      const { weight, ...insight } = item;
      void weight;
      return insight;
    });
}

/** Опорная цена конверсии: целевая из настроек кабинета, иначе средняя по кабинету. */
export function referenceCpa(account: AccountView): { value: number | null; source: "target" | "account_average" | null } {
  if (account.settings.targetCpa && account.settings.targetCpa > 0) {
    return { value: account.settings.targetCpa, source: "target" };
  }
  const average = derive(account.current).cpa;
  return { value: average, source: average === null ? null : "account_average" };
}

// --- уровень кампаний -----------------------------------------------------------

export interface InsightInput {
  account: AccountView;
  /** Статистика кампаний по дням за текущий период: campaignId → дни. */
  daily: Map<string, DailyPoint[]>;
  days: number;
}

export function analyzeAccount({ account, daily, days }: InsightInput): Insight[] {
  const out: Weighted[] = [];
  const ref = referenceCpa(account);
  const refLabel = ref.source === "target" ? "целевой цене конверсии" : "средней цене конверсии по кабинету";
  const refShort = ref.source === "target" ? "целевого" : "среднего по кабинету";

  for (const c of account.campaigns) {
    if (c.state !== "active") continue;
    const cur = derive(c.current);
    const prev = derive(c.previous);
    const base = { accountId: account.id, accountName: account.name, campaignId: c.id, campaignName: c.name };

    // 1. Расход без конверсий. Если опорного CPA нет (в кабинете нет ни конверсий, ни цели),
    // скорее всего не настроены цели — правило молчит, чтобы не предлагать остановить всё подряд.
    if (ref.value !== null && c.current.conversions === 0 && c.current.cost >= ref.value * RULES.wasteCpaMultiple) {
      out.push({
        ...base,
        id: `waste:${account.id}:${c.id}`,
        severity: "critical",
        title: "Расход без конверсий",
        detail: `За ${days} дн. потрачено ${rub(c.current.cost)} и ни одной конверсии. При ${refLabel} ${rub(ref.value)} это бюджет на ${Math.floor(c.current.cost / ref.value)} заявок.`,
        action: { type: "pause", target: "campaign", id: c.id },
        weight: c.current.cost,
      });
      continue;
    }

    // 2. Конверсии есть, но заметно дороже опорной цены.
    if (
      ref.value !== null &&
      cur.cpa !== null &&
      c.current.conversions >= RULES.minConversions &&
      cur.cpa >= ref.value * RULES.expensiveCpaMultiple
    ) {
      const canCut = c.budgetEditable && c.dailyBudget !== null;
      const newBudget = canCut ? roundBudget(c.dailyBudget! * (1 - RULES.budgetStep)) : null;
      out.push({
        ...base,
        id: `expensive:${account.id}:${c.id}`,
        severity: "warning",
        title: ref.source === "target" ? "Конверсии дороже цели" : "Конверсии дороже среднего",
        detail:
          `CPA ${rub(cur.cpa)} против ${rub(ref.value)} ${refShort} (в ${dec(cur.cpa / ref.value, 1)} раза дороже) при ${c.current.conversions} конверсиях. ` +
          (newBudget !== null
            ? `Предлагаю снизить дневной бюджет с ${rub(c.dailyBudget!)} до ${rub(newBudget)} и разобрать запросы и площадки.`
            : "Бюджет задан стратегией — нужно разобрать запросы, площадки и объявления внутри кампании."),
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

    // 4. Кампания окупается лучше опорной цены и упирается в дневной бюджет — её можно масштабировать.
    if (
      ref.value !== null &&
      cur.cpa !== null &&
      c.budgetEditable &&
      c.dailyBudget !== null &&
      c.current.conversions >= RULES.minConversions &&
      cur.cpa <= ref.value * RULES.scaleCpaMultiple
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
          detail: `${capped} из ${days} дн. расход доходил до дневного лимита ${rub(c.dailyBudget)}, а CPA ${rub(cur.cpa)} — на ${pct(1 - cur.cpa / ref.value)} ниже ${refShort}. Предлагаю поднять бюджет до ${rub(newBudget)}.`,
          action: { type: "set_budget", amount: newBudget },
          weight: c.current.cost,
        });
      }
    }
  }

  return ranked(out);
}

// --- внутри кампании ------------------------------------------------------------

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/["\[\]!+]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^-/, ""))
    .filter(Boolean);
}

/** Покрыт ли запрос минус-фразами: все слова хотя бы одной минус-фразы есть в запросе. */
export function isCoveredByNegatives(query: string, negatives: string[]): boolean {
  const queryWords = new Set(words(query));
  return negatives.some((negative) => {
    const parts = words(negative);
    return parts.length > 0 && parts.every((w) => queryWords.has(w));
  });
}

export interface CampaignInsightInput {
  account: { id: string; name: string };
  campaign: CampaignView;
  referenceCpa: number | null;
  breakdowns: Partial<Record<BreakdownLevel, BreakdownRow[]>>;
  days: number;
}

export function analyzeCampaign({ account, campaign, referenceCpa: ref, breakdowns, days }: CampaignInsightInput): Insight[] {
  const out: Weighted[] = [];
  const base = { accountId: account.id, accountName: account.name, campaignId: campaign.id, campaignName: campaign.name };

  // Если у всей кампании нет конверсий, внутри неё нечем отличить плохое от хорошего:
  // «без конверсий» окажется всё подряд. Решение принимается уровнем выше — по кампании целиком.
  if (ref !== null && campaign.current.conversions > 0) {
    // Поисковые запросы: деньги уходят, заявок нет — в минус-фразы.
    for (const q of breakdowns.queries ?? []) {
      if (q.handled || q.conversions > 0) continue;
      if (q.cost < ref * RULES.wasteItemCpaShare || q.clicks < RULES.wasteQueryClicks) continue;
      out.push({
        ...base,
        id: `query:${campaign.id}:${q.key}`,
        severity: "warning",
        subject: q.label,
        title: "Запрос тратит бюджет без конверсий",
        detail: `По запросу «${q.label}» за ${days} дн. — ${q.clicks} кликов на ${rub(q.cost)} и ни одной конверсии. Предлагаю добавить его в минус-фразы кампании.`,
        action: { type: "add_negatives", phrases: [q.key] },
        weight: q.cost,
      });
    }

    // Площадки в сетях: то же самое — в исключения.
    for (const p of breakdowns.placements ?? []) {
      if (p.handled || p.conversions > 0) continue;
      if (p.cost < ref * RULES.wasteItemCpaShare || p.clicks < RULES.wastePlacementClicks) continue;
      out.push({
        ...base,
        id: `placement:${campaign.id}:${p.key}`,
        severity: "warning",
        subject: p.label,
        title: "Площадка тратит бюджет без конверсий",
        detail: `Площадка ${p.label} за ${days} дн. — ${p.clicks} кликов на ${rub(p.cost)} и ни одной конверсии. Предлагаю запретить показы на ней.`,
        action: { type: "exclude_placements", sites: [p.key] },
        weight: p.cost,
      });
    }

    for (const k of breakdowns.keywords ?? []) {
      if (k.state !== "active") continue;
      const cpa = derive(k).cpa;
      if (k.conversions === 0 && k.cost >= ref * RULES.wasteKeywordCpaMultiple) {
        out.push({
          ...base,
          id: `keyword-waste:${campaign.id}:${k.key}`,
          severity: "critical",
          subject: k.label,
          title: "Фраза без конверсий",
          detail: `Фраза «${k.label}» за ${days} дн. потратила ${rub(k.cost)} (${k.clicks} кликов) без единой конверсии — в ${dec(k.cost / ref, 1)} раза больше опорной цены конверсии. Предлагаю остановить её.`,
          action: { type: "pause", target: "keyword", id: k.key },
          weight: k.cost,
        });
      } else if (
        cpa !== null &&
        k.conversions >= RULES.minConversions &&
        cpa >= ref * RULES.expensiveKeywordCpaMultiple &&
        k.bid
      ) {
        const newBid = Math.max(1, Math.round(k.bid * (1 - RULES.bidStep)));
        out.push({
          ...base,
          id: `keyword-expensive:${campaign.id}:${k.key}`,
          severity: "warning",
          subject: k.label,
          title: "Фраза приносит дорогие конверсии",
          detail: `По фразе «${k.label}» CPA ${rub(cpa)} — в ${dec(cpa / ref, 1)} раза выше опорной цены ${rub(ref)}. Предлагаю снизить ставку с ${rub(k.bid)} до ${rub(newBid)}.`,
          action: { type: "set_bid", keywordId: k.key, amount: newBid },
          weight: k.cost,
        });
      }
    }
  }

  // Объявления: в группе с несколькими активными оставляем сильные. Опорный CPA здесь не нужен.
  const byGroup = new Map<string, BreakdownRow[]>();
  for (const ad of breakdowns.ads ?? []) {
    if (ad.state !== "active" || !ad.groupId || ad.impressions < RULES.minImpressionsForAd) continue;
    byGroup.set(ad.groupId, [...(byGroup.get(ad.groupId) ?? []), ad]);
  }
  for (const ads of byGroup.values()) {
    if (ads.length < 2) continue;
    const best = ads.reduce((a, b) => ((derive(a).ctr ?? 0) >= (derive(b).ctr ?? 0) ? a : b));
    const bestCtr = derive(best).ctr ?? 0;
    for (const ad of ads) {
      const ctr = derive(ad).ctr ?? 0;
      if (ad === best || bestCtr === 0 || ctr > bestCtr * RULES.weakAdCtrShare) continue;
      // Объявление с лучшей конверсией не трогаем, даже если его CTR ниже.
      if (ad.conversions > best.conversions) continue;
      out.push({
        ...base,
        id: `ad:${campaign.id}:${ad.key}`,
        severity: "warning",
        subject: ad.label,
        title: "Объявление заметно слабее соседнего",
        detail: `В группе «${ad.groupName ?? ""}» у объявления «${ad.label}» CTR ${dec(ctr * 100, 2)}% против ${dec(bestCtr * 100, 2)}% у «${best.label}». Предлагаю остановить слабое и написать новый вариант.`,
        action: { type: "pause", target: "ad", id: ad.key },
        weight: ad.cost,
      });
    }
  }

  return ranked(out);
}
