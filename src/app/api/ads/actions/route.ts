import { z } from "zod";
import { ActionError, applyAction } from "@/lib/ads/service";

const Body = z.object({
  accountId: z.string().min(1),
  campaignId: z.string().min(1),
  action: z.discriminatedUnion("type", [
    z.object({ type: z.literal("pause") }),
    z.object({ type: z.literal("resume") }),
    z.object({ type: z.literal("set_budget"), amount: z.number().positive().max(10_000_000) }),
  ]),
});

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  }
  try {
    const entry = await applyAction(parsed.data);
    return Response.json(entry, { status: entry.ok ? 200 : 502 });
  } catch (e) {
    const status = e instanceof ActionError ? e.status : 500;
    return Response.json({ error: e instanceof Error ? e.message : "Неизвестная ошибка" }, { status });
  }
}
