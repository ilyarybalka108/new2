// Форматирование чисел для интерфейса (ru-RU).

const DASH = "—";

export function fmtInt(value: number): string {
  return Math.round(value).toLocaleString("ru-RU");
}

export function fmtMoney(value: number | null, currency = "RUB", digits = 0): string {
  if (value === null) return DASH;
  return new Intl.NumberFormat("ru-RU", {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export function fmtPct(value: number | null, digits = 2): string {
  if (value === null) return DASH;
  return `${(value * 100).toFixed(digits).replace(".", ",")}%`;
}

/** «12 нояб.» */
export function fmtDay(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("ru-RU", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Компактная запись для оси: 12 400 → «12,4 тыс.» */
export function fmtCompact(value: number): string {
  return new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
