import { z } from "zod";
import { errorResponse } from "@/lib/ads/http";
import { createCampaign } from "@/lib/ads/service";

const text = (max: number) => z.string().max(max);

const Plan = z.object({
  accountId: z.string().min(1),
  name: text(255),
  placement: z.enum(["search", "network", "both"]),
  strategy: z.enum(["max_clicks", "max_conversions", "average_cpa"]),
  weeklyBudget: z.number().positive().max(100_000_000),
  goalId: text(20).optional(),
  averageCpa: z.number().positive().max(100_000_000).optional(),
  counterId: text(20).optional(),
  regionIds: z.array(z.number().int().positive()).max(100),
  negativeKeywords: z.array(text(4096)).max(1000),
  groups: z
    .array(
      z.object({
        name: text(255),
        keywords: z.array(text(4096)).max(200),
        ads: z.array(z.object({ title: text(200), title2: text(200).optional(), text: text(500), href: text(1024) })).max(50),
      }),
    )
    .max(50),
});

export async function POST(request: Request) {
  const parsed = Plan.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректный план кампании" }, { status: 400 });
  try {
    return Response.json(await createCampaign(parsed.data));
  } catch (e) {
    return errorResponse(e);
  }
}
