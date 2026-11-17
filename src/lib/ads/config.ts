// Конфигурация кабинета из переменных окружения.

export interface AdsConfig {
  mode: "demo" | "live";
  /** OAuth-токен Яндекс Директа; в демо-режиме отсутствует. */
  token?: string;
  /**
   * Логины клиентов, если список нужно задать вручную. По умолчанию кабинеты
   * определяются автоматически: клиенты агентства или собственный аккаунт.
   */
  clientLogins?: string[];
  apiVersion: "v5" | "v501";
  /** Разрешены ли изменяющие действия. */
  writeEnabled: boolean;
  /** Каталог с файлом состояния; null — хранить только в памяти (тесты). */
  dataDir: string | null;
  /** Ключ API Higgsfield в виде «идентификатор:секрет»; без него генерация недоступна. */
  hfKey?: string;
  /** Потолок расходов на генерацию в день, в долларах. */
  hfDailyLimitUsd: number;
}

/**
 * YD_TOKEN           — токен; без него кабинет работает на демо-данных.
 * YD_CLIENT_LOGINS   — необязательный список логинов клиентов через запятую.
 * YD_API_VERSION     — v501 (по умолчанию, нужна для единых перфоманс-кампаний) или v5.
 * ADS_ALLOW_WRITE=1  — разрешить изменения в боевых кабинетах; без неё только чтение.
 * ADS_DATA_DIR       — каталог для файла состояния (по умолчанию ./data).
 * HF_API_KEY         — ключ Higgsfield «идентификатор:секрет» для генерации изображений и видео.
 * HF_DAILY_LIMIT_USD — потолок расходов на генерацию в день (по умолчанию 3 доллара).
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): AdsConfig {
  const token = env.YD_TOKEN?.trim();
  const dataDir = env.ADS_DATA_DIR === "memory" ? null : (env.ADS_DATA_DIR?.trim() || "data");
  const limit = Number(env.HF_DAILY_LIMIT_USD ?? 3);
  if (!Number.isFinite(limit) || limit < 0) throw new Error("HF_DAILY_LIMIT_USD: ожидается неотрицательное число");
  const media = { hfKey: env.HF_API_KEY?.trim() || undefined, hfDailyLimitUsd: limit };
  if (!token) return { mode: "demo", apiVersion: "v501", writeEnabled: true, dataDir, ...media };

  const version = env.YD_API_VERSION?.trim() || "v501";
  if (version !== "v5" && version !== "v501") throw new Error("YD_API_VERSION: допустимы значения v5 и v501");
  const logins = (env.YD_CLIENT_LOGINS ?? "")
    .split(",")
    .map((l) => l.trim())
    .filter(Boolean);
  return {
    mode: "live",
    token,
    clientLogins: logins.length ? logins : undefined,
    apiVersion: version,
    // Изменения в боевых кабинетах выключены, пока их явно не разрешили.
    writeEnabled: env.ADS_ALLOW_WRITE === "1",
    dataDir,
    ...media,
  };
}
