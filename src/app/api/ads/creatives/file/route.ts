import { readCreativeFile } from "@/lib/ads/creative-library";
import { errorResponse } from "@/lib/ads/http";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const format = params.get("format") ?? "";
  // Идентификатор и формат попадают в путь к файлу — пропускаем только буквы, цифры и «x».
  if (!/^[a-z0-9]+$/.test(id) || !/^[a-z0-9]+$/.test(format)) return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  try {
    const data = await readCreativeFile(id, format);
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=86400", "Content-Disposition": `inline; filename="${id}-${format}.png"` },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
