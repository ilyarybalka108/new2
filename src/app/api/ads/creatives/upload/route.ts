import { z } from "zod";
import { uploadCreative } from "@/lib/ads/creative-library";
import { errorResponse } from "@/lib/ads/http";

const Body = z.object({ id: z.string().regex(/^[a-z0-9]+$/), format: z.string().regex(/^[a-z0-9]+$/) });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректный запрос" }, { status: 400 });
  try {
    return Response.json({ imageHash: await uploadCreative(parsed.data.id, parsed.data.format, undefined, "human") });
  } catch (e) {
    return errorResponse(e);
  }
}
