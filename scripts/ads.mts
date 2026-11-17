// Командная строка рекламного кабинета. Те же данные, правила, защита и журнал, что и в интерфейсе,
// но в виде JSON — чтобы кабинеты можно было вести из терминала или из сессии Claude.
//
//   npm run ads -- accounts
//   npm run ads -- overview --days 14
//   npm run ads -- audit --days 14
//   npm run ads -- campaign <кабинет> <кампания> --days 14 --levels keywords,queries
//   npm run ads -- apply '{"accountId":"…","campaignId":"…","action":{"type":"pause","target":"campaign","id":"…"}}'
//   npm run ads -- settings <кабинет> '{"targetCpa":1500,"goals":["123"]}'
//   npm run ads -- create plan.json
//   npm run ads -- moderate <кабинет> "<название кампании>" <id объявлений через запятую>

import { readFile } from "node:fs/promises";
import { validatePlan } from "../src/lib/ads/plan.ts";
import {
  applyAction,
  BREAKDOWN_LEVELS,
  createCampaign,
  getCampaignDetail,
  getOverview,
  listAccounts,
  loadConfig,
  sendToModeration,
  updateSettings,
} from "../src/lib/ads/service.ts";
import type { ActionRequest, BreakdownLevel, CampaignPlan, Insight } from "../src/lib/ads/types.ts";

const [command, ...rest] = process.argv.slice(2);
const args = rest.filter((a) => !a.startsWith("--"));
const flag = (name: string): string | undefined => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : undefined;
};
const days = Number(flag("days") ?? 7);
const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

function need(value: string | undefined, what: string): string {
  if (!value) throw new Error(`Не указано: ${what}`);
  return value;
}

async function main() {
  if (![7, 14, 30].includes(days)) throw new Error("--days: 7, 14 или 30");
  const config = loadConfig();

  switch (command) {
    case "accounts":
      return print({ mode: config.mode, writeEnabled: config.writeEnabled, accounts: await listAccounts(config) });

    case "overview":
      return print(await getOverview(days, config));

    case "audit": {
      // Полный обход: рекомендации уровня кампаний плюс разбор каждой активной кампании с расходом.
      const overview = await getOverview(days, config);
      const insights: Insight[] = [...overview.insights];
      const errors: string[] = overview.accounts.filter((a) => a.error).map((a) => `${a.name}: ${a.error}`);
      for (const account of overview.accounts) {
        for (const campaign of account.campaigns) {
          if (campaign.state !== "active" || campaign.current.cost === 0) continue;
          try {
            const detail = await getCampaignDetail(account.id, campaign.id, days, BREAKDOWN_LEVELS, config);
            insights.push(...detail.insights);
            for (const [level, message] of Object.entries(detail.breakdownErrors)) errors.push(`${campaign.name} / ${level}: ${message}`);
          } catch (e) {
            errors.push(`${campaign.name}: ${e instanceof Error ? e.message : e}`);
          }
        }
      }
      return print({ mode: overview.mode, writeEnabled: overview.writeEnabled, range: overview.range, totals: overview.totals, insights, errors });
    }

    case "campaign": {
      const levels = flag("levels")?.split(",") as BreakdownLevel[] | undefined;
      if (levels?.some((l) => !BREAKDOWN_LEVELS.includes(l))) throw new Error(`--levels: ${BREAKDOWN_LEVELS.join(", ")}`);
      return print(await getCampaignDetail(need(args[0], "кабинет"), need(args[1], "кампания"), days, levels, config));
    }

    case "apply":
      return print(await applyAction(JSON.parse(need(args[0], "действие в формате JSON")) as ActionRequest, config));

    case "settings":
      return print(await updateSettings(need(args[0], "кабинет"), JSON.parse(need(args[1], "настройки в формате JSON")), config));

    case "create": {
      const plan = JSON.parse(await readFile(need(args[0], "файл с планом кампании"), "utf8")) as CampaignPlan;
      const issues = validatePlan(plan);
      if (issues.length) return print({ ok: false, issues });
      return print(await createCampaign(plan, config));
    }

    case "moderate":
      return print(await sendToModeration(need(args[0], "кабинет"), need(args[1], "название кампании"), need(args[2], "объявления").split(","), config));

    default:
      throw new Error("Команды: accounts, overview, audit, campaign, apply, settings, create, moderate");
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
