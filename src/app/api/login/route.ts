import { cookies } from "next/headers";
import { safeEqual, SESSION_COOKIE, sessionToken } from "@/lib/ads/auth";

export async function POST(request: Request) {
  const expected = process.env.ADS_PASSWORD;
  if (!expected) return Response.json({ ok: true });

  const body = (await request.json().catch(() => null)) as { password?: unknown } | null;
  const given = typeof body?.password === "string" ? body.password : "";
  const [a, b] = await Promise.all([sessionToken(given), sessionToken(expected)]);
  if (!safeEqual(a, b)) {
    // Пауза замедляет перебор паролей.
    await new Promise((r) => setTimeout(r, 700));
    return Response.json({ error: "Неверный пароль" }, { status: 401 });
  }
  (await cookies()).set(SESSION_COOKIE, b, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  return Response.json({ ok: true });
}
