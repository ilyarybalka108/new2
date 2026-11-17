import { randomUUID } from "node:crypto";

// Клиент API Higgsfield: генерация изображений и видео для креативов.
// Структуры запросов сверены с официальной документацией (docs.higgsfield.ai).

const API = "https://api.higgsfield.ai";

/** Модели по умолчанию. Адрес модели — это путь запроса; его можно переопределить при вызове. */
export const MODELS = {
  image: "/higgsfield-ai/soul/standard",
  video: "/kling-video/v2.5-turbo/standard/image-to-video",
};

export class HiggsfieldError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "HiggsfieldError";
    this.status = status;
  }
}

export interface HiggsfieldOptions {
  /** Ключ в виде «идентификатор:секрет». */
  key: string;
  fetchImpl?: typeof fetch;
  /** Подменяется в тестах, чтобы не ждать по-настоящему. */
  sleep?: (ms: number) => Promise<void>;
}

export interface Estimate {
  /** Стоимость запроса в долларах; null — API не назвал точную сумму. */
  usd: number | null;
  /** Пояснение API, если вместо суммы пришло описание тарифа. */
  note?: string;
}

export interface Output {
  requestId: string;
  /** Ссылки на результат; действуют ограниченное время, файл нужно скачать к себе. */
  urls: string[];
}

/**
 * Разбирает ответ оценки стоимости. API отвечает либо суммой, либо описанием тарифа
 * («$0.0315 за секунду видео») — во втором случае сумма считается по длительности.
 */
export function parseEstimate(body: unknown, durationSeconds?: number): Estimate {
  const b = (body ?? {}) as { usd?: string | number; pricing_description?: string };
  if (b.usd !== undefined && Number.isFinite(Number(b.usd))) return { usd: Number(b.usd) };
  const note = b.pricing_description;
  if (note) {
    const rates = [...note.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)].map((m) => Number(m[1]));
    // Тарифов может быть несколько (по разрешениям) — берём наибольший, чтобы не занизить оценку.
    if (rates.length && /per (video )?second/i.test(note) && durationSeconds) {
      return { usd: Math.round(Math.max(...rates) * durationSeconds * 10_000) / 10_000, note };
    }
    return { usd: null, note };
  }
  return { usd: null };
}

export function createHiggsfield(opts: HiggsfieldOptions) {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const auth = { Authorization: `Key ${opts.key}` };

  async function request<T>(method: string, url: string, body?: unknown, extra: Record<string, string> = {}): Promise<T> {
    const res = await doFetch(url.startsWith("http") ? url : `${API}${url}`, {
      method,
      headers: { ...auth, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const data = (await res.json().catch(() => null)) as (T & { detail?: unknown }) | null;
    if (!res.ok) {
      const detail = typeof data?.detail === "string" ? data.detail : JSON.stringify(data?.detail ?? data ?? "");
      const hint =
        res.status === 401
          ? "ключ не принят"
          : res.status === 403
            ? "недостаточно средств на балансе API или нет доступа"
            : res.status === 429
              ? "очередь генераций занята, повторите позже"
              : `HTTP ${res.status}`;
      throw new HiggsfieldError(`Higgsfield: ${hint}${detail ? ` (${detail})` : ""}`, res.status);
    }
    return data as T;
  }

  return {
    /** Оценка стоимости — бесплатный запрос с теми же параметрами, что и генерация. */
    async estimate(model: string, params: Record<string, unknown>): Promise<Estimate> {
      return parseEstimate(await request("POST", `/estimate${model}`, params), Number(params.duration) || undefined);
    },

    /** Ставит генерацию в очередь. Ключ идемпотентности защищает от двойного списания при повторе запроса. */
    async submit(model: string, params: Record<string, unknown>): Promise<string> {
      const res = await request<{ request_id?: string }>("POST", model, params, { "Idempotency-Key": randomUUID() });
      if (!res.request_id) throw new HiggsfieldError("Higgsfield не вернул идентификатор запроса");
      return res.request_id;
    },

    /** Ждёт завершения: опрос от двух секунд с плавным ростом интервала до десяти. */
    async wait(requestId: string, timeoutMs = 10 * 60 * 1000): Promise<Output> {
      const started = Date.now();
      for (let interval = 2000; ; interval = Math.min(10_000, Math.round(interval * 1.4))) {
        const s = await request<{ status: string; error?: string | null; images?: { url: string }[]; video?: { url: string } }>(
          "GET",
          `/requests/${requestId}/status`,
        );
        if (s.status === "completed") {
          const urls = [...(s.images ?? []).map((i) => i.url), ...(s.video ? [s.video.url] : [])];
          if (urls.length === 0) throw new HiggsfieldError("Генерация завершена, но результата в ответе нет");
          return { requestId, urls };
        }
        if (s.status === "nsfw") throw new HiggsfieldError("Генерация отклонена модерацией Higgsfield (списание не производится)");
        if (s.status === "failed" || s.status === "canceled") {
          throw new HiggsfieldError(`Генерация не выполнена: ${s.error ?? s.status} (списание не производится)`);
        }
        if (Date.now() - started > timeoutMs) {
          throw new HiggsfieldError(`Генерация ${requestId} не завершилась за отведённое время — результат можно забрать позже`);
        }
        await sleep(interval);
      }
    },

    /** Загружает исходный файл (например, первый кадр) и возвращает ссылку для параметра модели. */
    async upload(data: Buffer, contentType: string): Promise<string> {
      const slot = await request<{ public_url: string; upload_url: string; upload_headers?: Record<string, string> }>(
        "POST",
        "/files/generate-upload-url",
        { content_type: contentType },
      );
      // В хранилище ключ API не передаётся — только заголовки, выданные вместе со ссылкой.
      const res = await doFetch(slot.upload_url, { method: "PUT", headers: slot.upload_headers ?? { "Content-Type": contentType }, body: new Uint8Array(data) });
      if (!res.ok) throw new HiggsfieldError(`Не удалось загрузить исходный файл в хранилище: HTTP ${res.status}`, res.status);
      return slot.public_url;
    },

    async download(url: string): Promise<Buffer> {
      const res = await doFetch(url);
      if (!res.ok) throw new HiggsfieldError(`Не удалось скачать результат: HTTP ${res.status}`, res.status);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

export type Higgsfield = ReturnType<typeof createHiggsfield>;
