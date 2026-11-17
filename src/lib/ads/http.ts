import { ActionError } from "./service.ts";

/** Единый ответ об ошибке для маршрутов API. */
export function errorResponse(e: unknown): Response {
  const status = e instanceof ActionError ? e.status : 500;
  return Response.json({ error: e instanceof Error ? e.message : "Неизвестная ошибка" }, { status });
}

export const ALLOWED_DAYS = [7, 14, 30];

export function parseDays(value: string | null): number | null {
  const days = Number(value ?? 7);
  return ALLOWED_DAYS.includes(days) ? days : null;
}
