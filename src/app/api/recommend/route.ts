import { z } from "zod";
import { NoCredentialsError, RefusedError, hasCredentials, recommend } from "@/lib/claude";
import { groundAll } from "@/lib/grounding";
import { searchLinks } from "@/lib/links";
import { DEMO_RESPONSE } from "@/lib/demo";
import { Domain, type ApiResult } from "@/lib/types";

export const maxDuration = 120;

const Body = z.object({
  music: z.array(z.string()).max(200).default([]),
  film: z.array(z.string()).max(200).default([]),
  book: z.array(z.string()).max(200).default([]),
  want: z.array(Domain).min(1),
  depth: z.enum(["balanced", "digger"]).default("balanced"),
  from: z.union([Domain, z.literal("all")]).default("all"),
  note: z.string().max(500).optional(),
  verify: z.boolean().default(true),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Некорректный запрос", details: parsed.error.issues }, { status: 400 });
  }
  const input = parsed.data;
  const total = input.music.length + input.film.length + input.book.length;
  if (total < 3) {
    return Response.json({ error: "Укажите хотя бы три позиции, иначе рекомендации будут гаданием." }, { status: 400 });
  }

  const warnings: string[] = [];
  const input_summary = { music: input.music.length, film: input.film.length, book: input.book.length };

  if (!hasCredentials()) {
    warnings.push("Демо-режим: ключ API не задан, показан заранее подготовленный пример. Задайте ANTHROPIC_API_KEY в .env.local.");
    const result: ApiResult = {
      mode: "demo",
      profile: DEMO_RESPONSE.profile,
      recommendations: DEMO_RESPONSE.recommendations
        .filter((r) => input.want.includes(r.domain))
        .map((r) => ({ ...r, verification: "skipped", links: searchLinks(r.domain, r.title, r.creator) })),
      input_summary,
      warnings,
    };
    return Response.json(result);
  }

  try {
    const { data, model } = await recommend(input);
    const wanted = data.recommendations.filter((r) => input.want.includes(r.domain));
    const recommendations = input.verify
      ? await groundAll(wanted)
      : wanted.map((r) => ({ ...r, verification: "skipped" as const, links: searchLinks(r.domain, r.title, r.creator) }));

    const unavailable = recommendations.filter((r) => r.verification === "unavailable").length;
    if (unavailable) warnings.push(`Каталоги недоступны для ${unavailable} рекомендаций — проверка существования не выполнена.`);
    const notFound = recommendations.filter((r) => r.verification === "not_found").length;
    if (notFound) warnings.push(`${notFound} рекомендаций не найдены в открытых каталогах — отнеситесь к ним с осторожностью.`);

    const result: ApiResult = { mode: "live", model, profile: data.profile, recommendations, input_summary, warnings };
    return Response.json(result);
  } catch (e) {
    if (e instanceof NoCredentialsError) return Response.json({ error: e.message }, { status: 503 });
    if (e instanceof RefusedError) return Response.json({ error: `Запрос отклонён моделью: ${e.message}` }, { status: 422 });
    const message = e instanceof Error ? e.message : "Неизвестная ошибка";
    console.error("[recommend]", e);
    return Response.json({ error: message }, { status: 500 });
  }
}
