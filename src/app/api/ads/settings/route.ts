import { z } from "zod";
import { errorResponse } from "@/lib/ads/http";
import { updateSettings } from "@/lib/ads/service";

const Body = z.object({
  accountId: z.string().min(1),
  settings: z.object({
    targetCpa: z.number().positive().max(100_000_000).optional(),
    goals: z.array(z.string().regex(/^\d+$/)).max(10).optional(),
    attribution: z.enum(["AUTO", "LC", "LSCCD", "FCCD"]).optional(),
    monthlyBudget: z.number().positive().max(1_000_000_000).optional(),
    autopilot: z
      .object({
        enabled: z.boolean(),
        allow: z.object({
          negatives: z.boolean(),
          placements: z.boolean(),
          pauseKeywords: z.boolean(),
          pauseAds: z.boolean(),
          bids: z.boolean(),
          budgets: z.boolean(),
          pauseCampaigns: z.boolean(),
        }),
        maxActionsPerDay: z.number().int().min(1).max(500),
      })
      .optional(),
  }),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректные настройки" }, { status: 400 });
  try {
    return Response.json(await updateSettings(parsed.data.accountId, parsed.data.settings));
  } catch (e) {
    return errorResponse(e);
  }
}
