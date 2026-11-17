import { errorResponse, parseDays } from "@/lib/ads/http";
import { getOverview } from "@/lib/ads/service";

export async function GET(request: Request) {
  const days = parseDays(new URL(request.url).searchParams.get("days"));
  if (days === null) return Response.json({ error: "Параметр days: 7, 14 или 30" }, { status: 400 });
  try {
    return Response.json(await getOverview(days));
  } catch (e) {
    return errorResponse(e);
  }
}
