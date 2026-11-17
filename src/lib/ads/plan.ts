import type { CampaignPlan, PlanIssue } from "./types.ts";

// Проверка плана кампании до отправки в API. Ограничения взяты из справочника API Директа
// (Ads.add, Keywords.add): ошибку дешевле поймать здесь, чем получить отказ и потерять баллы.

export const LIMITS = {
  title: 56,
  title2: 30,
  text: 81,
  narrow: 15,
  titleWord: 22,
  textWord: 23,
  href: 1024,
  keywordWords: 7,
  keywordWord: 35,
  keywordLength: 4096,
};

/** «Узкие» символы: в тексте и втором заголовке считаются отдельно от остальных. */
const NARROW = /[!,.;:"]/g;

/** Слова, которые Директ не учитывает в лимите на длину фразы (частые предлоги и союзы). */
const STOP_WORDS = new Set(["в", "на", "и", "с", "по", "для", "от", "из", "к", "у", "за", "до", "о", "а", "не", "как", "или"]);

/** Известные идентификаторы регионов геобазы Яндекса для быстрого выбора. */
export const REGION_PRESETS: { id: number; name: string }[] = [
  { id: 225, name: "Россия" },
  { id: 1, name: "Москва и область" },
  { id: 213, name: "Москва" },
  { id: 10174, name: "Санкт-Петербург и область" },
  { id: 2, name: "Санкт-Петербург" },
];

export function lengths(text: string): { wide: number; narrow: number } {
  const narrow = (text.match(NARROW) ?? []).length;
  return { wide: [...text].length - narrow, narrow };
}

function longestWord(text: string): number {
  return Math.max(0, ...text.split(/[\s\-/]+/).map((w) => [...w].length));
}

/** Число слов фразы, учитываемых в лимите: без минус-слов и стоп-слов. */
export function countedWords(keyword: string): number {
  return keyword
    .replace(/["\[\]!+]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !w.startsWith("-") && !STOP_WORDS.has(w.toLowerCase())).length;
}

export function validatePlan(plan: CampaignPlan): PlanIssue[] {
  const issues: PlanIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (!plan.accountId) add("accountId", "Не выбран кабинет");
  if (!plan.name.trim()) add("name", "Укажите название кампании");
  if (!(plan.weeklyBudget > 0)) add("weeklyBudget", "Укажите недельный бюджет");
  if (plan.regionIds.length === 0) add("regionIds", "Выберите хотя бы один регион показа");
  if (plan.regionIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    add("regionIds", "Идентификаторы регионов должны быть целыми числами");
  }
  if (plan.counterId && !/^\d+$/.test(plan.counterId)) add("counterId", "Номер счётчика Метрики — только цифры");
  if (plan.goalId && !/^\d+$/.test(plan.goalId)) add("goalId", "Идентификатор цели — только цифры");
  if (plan.strategy !== "max_clicks" && !plan.goalId) {
    add("goalId", "Для стратегии по конверсиям нужна цель Метрики");
  }
  if (plan.strategy === "average_cpa" && !(plan.averageCpa && plan.averageCpa > 0)) {
    add("averageCpa", "Укажите среднюю цену конверсии");
  }
  if (plan.groups.length === 0) add("groups", "Добавьте хотя бы одну группу объявлений");

  plan.groups.forEach((group, g) => {
    const at = `groups[${g}]`;
    if (!group.name.trim()) add(`${at}.name`, "Укажите название группы");
    if (group.keywords.length === 0) add(`${at}.keywords`, "Добавьте хотя бы одну ключевую фразу");
    if (group.ads.length === 0) add(`${at}.ads`, "Добавьте хотя бы одно объявление");

    const seen = new Set<string>();
    group.keywords.forEach((keyword, k) => {
      const path = `${at}.keywords[${k}]`;
      const key = keyword.trim().toLowerCase();
      if (!key) return add(path, "Пустая фраза");
      if (seen.has(key)) add(path, `Фраза «${keyword}» повторяется`);
      seen.add(key);
      if ([...keyword].length > LIMITS.keywordLength) add(path, "Фраза слишком длинная");
      if (countedWords(keyword) > LIMITS.keywordWords) {
        add(path, `В фразе «${keyword}» больше ${LIMITS.keywordWords} слов (без минус-слов и стоп-слов)`);
      }
      if (longestWord(keyword) > LIMITS.keywordWord) add(path, `Слово длиннее ${LIMITS.keywordWord} символов`);
    });

    group.ads.forEach((ad, a) => {
      const path = `${at}.ads[${a}]`;
      if (!ad.title.trim()) add(`${path}.title`, "Укажите заголовок");
      if ([...ad.title].length > LIMITS.title) {
        add(`${path}.title`, `Заголовок: ${[...ad.title].length} символов из ${LIMITS.title}`);
      }
      if (longestWord(ad.title) > LIMITS.titleWord) {
        add(`${path}.title`, `В заголовке слово длиннее ${LIMITS.titleWord} символов`);
      }
      if (ad.title2) {
        const len = lengths(ad.title2);
        if (len.wide > LIMITS.title2) add(`${path}.title2`, `Второй заголовок: ${len.wide} символов из ${LIMITS.title2}`);
        if (len.narrow > LIMITS.narrow) add(`${path}.title2`, `Слишком много знаков препинания во втором заголовке`);
        if (longestWord(ad.title2) > LIMITS.titleWord) {
          add(`${path}.title2`, `Во втором заголовке слово длиннее ${LIMITS.titleWord} символов`);
        }
      }
      if (!ad.text.trim()) add(`${path}.text`, "Укажите текст объявления");
      const text = lengths(ad.text);
      if (text.wide > LIMITS.text) add(`${path}.text`, `Текст: ${text.wide} символов из ${LIMITS.text}`);
      if (text.narrow > LIMITS.narrow) add(`${path}.text`, "Слишком много знаков препинания в тексте");
      if (longestWord(ad.text) > LIMITS.textWord) add(`${path}.text`, `В тексте слово длиннее ${LIMITS.textWord} символов`);
      if (!/^https?:\/\/\S+\.\S+/.test(ad.href)) add(`${path}.href`, "Ссылка должна начинаться с http:// или https://");
      if (ad.href.length > LIMITS.href) add(`${path}.href`, "Ссылка длиннее 1024 символов");
    });
  });

  return issues;
}
