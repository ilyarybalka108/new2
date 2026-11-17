// Вход по паролю. Работает и в прокси, и в маршрутах: используется только Web Crypto.

export const SESSION_COOKIE = "ads_session";

/** Значение сессионной куки: по нему нельзя восстановить пароль. */
export async function sessionToken(password: string): Promise<string> {
  const data = new TextEncoder().encode(`ads-session:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Сравнение строк за постоянное время, чтобы по задержке ответа нельзя было подбирать значение. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
