import { connection } from "next/server";
import { errorResponse } from "@/lib/ads/http";
import { listMedia, spentToday } from "@/lib/ads/media-library";
import { loadConfig } from "@/lib/ads/service";

/** Сгенерированные изображения и ролики. Запуск генерации — через командную строку: он стоит денег. */
export async function GET() {
  await connection();
  try {
    const config = loadConfig();
    return Response.json({
      enabled: Boolean(config.hfKey),
      dailyLimitUsd: config.hfDailyLimitUsd,
      spentTodayUsd: await spentToday(config),
      media: await listMedia(config),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
