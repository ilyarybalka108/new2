import { connection } from "next/server";
import { z } from "zod";
import { createCreative, listCreatives } from "@/lib/ads/creative-library";
import { FORMATS } from "@/lib/ads/creatives";
import { errorResponse } from "@/lib/ads/http";

const Body = z.object({
  accountId: z.string().min(1),
  note: z.string().max(1000).optional(),
  formats: z.array(z.string()).max(20).optional(),
  spec: z.object({
    headline: z.string().min(1).max(120),
    subline: z.string().max(200).optional(),
    cta: z.string().max(40).optional(),
    badge: z.string().max(40).optional(),
    brand: z.string().min(1).max(60),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    style: z.enum(["solid", "light", "dark"]),
  }),
});

export async function GET() {
  await connection();
  try {
    return Response.json({ formats: FORMATS, creatives: await listCreatives() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Некорректное описание креатива" }, { status: 400 });
  try {
    return Response.json(await createCreative(parsed.data));
  } catch (e) {
    return errorResponse(e);
  }
}
