import { z } from "zod";
import { errorResponse } from "@/lib/ads/http";
import { applyAction } from "@/lib/ads/service";

const id = z.string().min(1).max(200);
const amount = z.number().positive().max(100_000_000);

const Body = z.object({
  accountId: id,
  campaignId: id,
  label: z.string().max(300).optional(),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("pause"), target: z.enum(["campaign", "ad", "keyword"]), id }),
    z.object({ type: z.literal("resume"), target: z.enum(["campaign", "ad", "keyword"]), id }),
    z.object({ type: z.literal("set_budget"), amount }),
    z.object({ type: z.literal("set_bid"), keywordId: id, amount }),
    z.object({ type: z.literal("add_negatives"), phrases: z.array(z.string().min(1).max(4096)).min(1).max(100) }),
    z.object({ type: z.literal("exclude_placements"), sites: z.array(z.string().min(1).max(255)).min(1).max(100) }),
  ]),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  try {
    const entry = await applyAction(parsed.data);
    return Response.json(entry, { status: entry.ok ? 200 : 502 });
  } catch (e) {
    return errorResponse(e);
  }
}
