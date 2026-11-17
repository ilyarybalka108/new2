import { runDaily } from "@/lib/ads/autopilot";
import { errorResponse } from "@/lib/ads/http";

/** Запускает ежедневный обход. Тело `{ "dryRun": true }` — пробный прогон без изменений. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { dryRun?: unknown } | null;
  try {
    return Response.json(await runDaily(undefined, undefined, { dryRun: body?.dryRun === true }));
  } catch (e) {
    return errorResponse(e);
  }
}
