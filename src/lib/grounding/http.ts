export const UA = "TasteDigger-MVP/0.1 (https://github.com/ilyarybalka108/new2)";

export async function getJson<T>(url: string, init?: RequestInit, timeoutMs = 6000): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "User-Agent": UA, Accept: "application/json", ...(init?.headers ?? {}) },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function similar(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[“”"'’`´]/g, "")
      .replace(/\s*[\(\[].*?[\)\]]\s*/g, " ")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}
