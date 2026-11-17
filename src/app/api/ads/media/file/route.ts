import { errorResponse } from "@/lib/ads/http";
import { readMediaFile } from "@/lib/ads/media-library";

export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[a-z0-9]+$/.test(id)) return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  try {
    const { record, data } = await readMediaFile(id);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": record.kind === "video" ? "video/mp4" : "image/jpeg",
        "Cache-Control": "private, max-age=86400",
        "Content-Disposition": `inline; filename="${record.file}"`,
      },
    });
  } catch (e) {
    return errorResponse(e);
  }
}
