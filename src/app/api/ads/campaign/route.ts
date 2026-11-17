import { errorResponse, parseDays } from "@/lib/ads/http";
import { BREAKDOWN_LEVELS, getCampaignDetail } from "@/lib/ads/service";
import type { BreakdownLevel } from "@/lib/ads/types";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const days = parseDays(params.get("days"));
  const account = params.get("account");
  const campaign = params.get("campaign");
  if (days === null || !account || !campaign) {
    return Response.json({ error: "Нужны параметры account, campaign и days (7, 14 или 30)" }, { status: 400 });
  }
  const requested = (params.get("levels") ?? "").split(",").filter(Boolean);
  const levels = requested.filter((l): l is BreakdownLevel => (BREAKDOWN_LEVELS as string[]).includes(l));
  if (levels.length !== requested.length) return Response.json({ error: "Неизвестный уровень детализации" }, { status: 400 });
  try {
    return Response.json(await getCampaignDetail(account, campaign, days, requested.length ? levels : undefined));
  } catch (e) {
    return errorResponse(e);
  }
}
