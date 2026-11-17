import { getOverview } from "@/lib/ads/service";

const ALLOWED_DAYS = [7, 14, 30];

export async function GET(request: Request) {
  const days = Number(new URL(request.url).searchParams.get("days") ?? 7);
  if (!ALLOWED_DAYS.includes(days)) {
    return Response.json({ error: "Параметр days: 7, 14 или 30" }, { status: 400 });
  }
  try {
    return Response.json(await getOverview(days));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Неизвестная ошибка" }, { status: 500 });
  }
}
