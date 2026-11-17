import { z } from "zod";
import { startAdTest } from "@/lib/ads/autopilot";
import { errorResponse } from "@/lib/ads/http";

const Body = z.object({
  accountId: z.string().min(1),
  campaignId: z.string().min(1),
  groupId: z.string().min(1),
  controlAdId: z.string().min(1),
  hypothesis: z.string().min(1).max(1000),
  ad: z.object({ title: z.string().max(200), title2: z.string().max(200).optional(), text: z.string().max(500), href: z.string().max(1024), imageHash: z.string().max(100).optional(), videoCreativeId: z.string().max(100).optional() }),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  try {
    return Response.json(await startAdTest(parsed.data));
  } catch (e) {
    return errorResponse(e);
  }
}
