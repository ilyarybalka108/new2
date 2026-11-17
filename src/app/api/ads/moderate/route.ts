import { z } from "zod";
import { errorResponse } from "@/lib/ads/http";
import { sendToModeration } from "@/lib/ads/service";

const Body = z.object({
  accountId: z.string().min(1),
  campaignName: z.string().max(255),
  adIds: z.array(z.string().min(1)).min(1).max(1000),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  try {
    const entry = await sendToModeration(parsed.data.accountId, parsed.data.campaignName, parsed.data.adIds);
    return Response.json(entry, { status: entry.ok ? 200 : 502 });
  } catch (e) {
    return errorResponse(e);
  }
}
