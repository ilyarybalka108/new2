import { connection } from "next/server";
import { errorResponse } from "@/lib/ads/http";
import { listAccounts, loadConfig } from "@/lib/ads/service";

export async function GET() {
  // Список кабинетов зависит от окружения и API — отвечаем на каждый запрос заново.
  await connection();
  try {
    const config = loadConfig();
    const accounts = await listAccounts(config);
    return Response.json({
      mode: config.mode,
      writeEnabled: config.writeEnabled,
      accounts: accounts.map((a) => ({ id: a.id, name: a.name })),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
