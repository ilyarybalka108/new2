import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type AdsConfig, loadConfig } from "./config.ts";
import { readCreativeFile } from "./creative-library.ts";
import { createHiggsfield, type Higgsfield, HiggsfieldError, MODELS } from "./higgsfield.ts";
import { todayMoscow } from "./metrics.ts";
import { ActionError, findAccount, providerFor, record, requireWrite } from "./service.ts";
import { mutate, read } from "./store.ts";
import type { Account, Actor, MediaRecord } from "./types.ts";

// Генерация изображений и роликов через Higgsfield. Каждый запуск стоит денег, поэтому:
// перед запуском берётся оценка стоимости, действует дневной потолок расходов,
// а оплаченный результат не теряется, даже если файл не удалось скачать сразу.

const memory = globalThis as typeof globalThis & { __adsMediaFiles?: Map<string, Buffer> };
const files = (memory.__adsMediaFiles ??= new Map<string, Buffer>());

async function saveFile(config: AdsConfig, name: string, data: Buffer) {
  if (config.dataDir === null) {
    files.set(name, data);
    return;
  }
  const dir = path.join(config.dataDir, "media");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), data);
}

/** Путь к файлу в библиотеке — им можно воспользоваться как фоном креатива (`backgroundFile`). */
export function mediaPath(config: AdsConfig, file: string): string | null {
  return config.dataDir === null ? null : path.join(config.dataDir, "media", file);
}

export async function readMediaFile(id: string, config: AdsConfig = loadConfig()): Promise<{ record: MediaRecord; data: Buffer }> {
  const found = (await read(config.dataDir)).media.find((m) => m.id === id);
  if (!found) throw new ActionError("Файл не найден", 404);
  if (found.status !== "ready") throw new ActionError("Файл сгенерирован, но ещё не скачан — выполните media-fetch", 409);
  if (config.dataDir === null) {
    const data = files.get(found.file);
    if (!data) throw new ActionError("Файл не найден", 404);
    return { record: found, data };
  }
  return { record: found, data: await readFile(path.join(config.dataDir, "media", found.file)) };
}

export async function listMedia(config: AdsConfig = loadConfig()): Promise<MediaRecord[]> {
  return (await read(config.dataDir)).media;
}

/** Сколько уже потрачено на генерацию сегодня (по оценкам на момент запуска). */
export async function spentToday(config: AdsConfig, today: string = todayMoscow()): Promise<number> {
  return (await read(config.dataDir)).media.filter((m) => m.date === today).reduce((s, m) => s + (m.costUsd ?? 0), 0);
}

export type ClientFactory = (key: string) => Higgsfield;
const defaultClient: ClientFactory = (key) => createHiggsfield({ key });

function client(config: AdsConfig, factory: ClientFactory): Higgsfield {
  if (!config.hfKey) throw new ActionError("Генерация недоступна: не задан ключ Higgsfield (HF_API_KEY)", 400);
  return factory(config.hfKey);
}

interface RunInput {
  kind: "image" | "video";
  account: Account;
  model: string;
  params: Record<string, unknown>;
  prompt: string;
  extension: string;
  note?: string;
  sourceCreativeId?: string;
  actor: Actor;
  /** Разовое разрешение потратить больше остатка дневного лимита или запустить без точной оценки. */
  maxUsd?: number;
}

async function run(config: AdsConfig, hf: Higgsfield, input: RunInput): Promise<MediaRecord> {
  const today = todayMoscow();
  const estimate = await hf.estimate(input.model, input.params);
  const spent = await spentToday(config, today);
  const allowed = input.maxUsd ?? config.hfDailyLimitUsd - spent;
  if (estimate.usd === null && input.maxUsd === undefined) {
    throw new ActionError(`Higgsfield не назвал точную стоимость (${estimate.note ?? "нет данных"}). Запуск возможен только с явным потолком расхода.`, 400);
  }
  if (estimate.usd !== null && estimate.usd > allowed + 1e-9) {
    throw new ActionError(
      `Генерация стоит $${estimate.usd}, а доступно $${Math.max(0, allowed).toFixed(2)}: сегодня потрачено $${spent.toFixed(2)} из дневного лимита $${config.hfDailyLimitUsd}.`,
      400,
    );
  }

  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const requestId = await hf.submit(input.model, input.params);
  const base: MediaRecord = {
    id,
    createdAt: new Date().toISOString(),
    date: today,
    accountId: input.account.id,
    accountName: input.account.name,
    kind: input.kind,
    model: input.model,
    prompt: input.prompt,
    costUsd: estimate.usd,
    requestId,
    url: "",
    status: "pending",
    file: `${id}.${input.extension}`,
    bytes: 0,
    ...(input.sourceCreativeId ? { sourceCreativeId: input.sourceCreativeId } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  // Запрос принят и будет оплачен — запоминаем его до ожидания, чтобы результат не потерялся при сбое.
  await mutate(config.dataDir, (s) => {
    s.media.unshift(base);
  });

  const cost = estimate.usd === null ? "стоимость не названа" : `$${estimate.usd}`;
  let terminal = false;
  const entry = await record(
    config,
    {
      accountId: input.account.id,
      accountName: input.account.name,
      campaignName: "Библиотека креативов",
      description: `${input.kind === "video" ? "Сгенерирован ролик" : "Сгенерировано изображение"} (${cost})`,
      actor: input.actor,
      reason: input.note ?? input.prompt,
    },
    async () => {
      let output;
      try {
        output = await hf.wait(requestId);
      } catch (e) {
        // Отказ, модерация или отмена — окончательный исход без списания; превышение времени ожидания — нет.
        terminal = e instanceof HiggsfieldError && /списание не производится/.test(e.message);
        throw e;
      }
      await mutate(config.dataDir, (s) => {
        const stored = s.media.find((m) => m.id === id);
        if (stored) stored.url = output.urls[0];
      });
    },
  );
  if (!entry.ok) {
    // Неудачная генерация не оплачивается — убираем запись, чтобы она не съедала дневной лимит.
    if (terminal) {
      await mutate(config.dataDir, (s) => {
        s.media = s.media.filter((m) => m.id !== id);
      });
    }
    throw new ActionError(entry.error ?? "Генерация не выполнена", 502);
  }
  return fetchMedia(id, config, () => hf);
}

/** Оценка стоимости генерации без запуска — бесплатный запрос. */
export async function estimateGeneration(
  kind: "image" | "video",
  config: AdsConfig = loadConfig(),
  opts: { duration?: number; model?: string } = {},
  factory: ClientFactory = defaultClient,
) {
  const hf = client(config, factory);
  const model = opts.model ?? MODELS[kind];
  const params = kind === "image" ? { prompt: "estimate" } : { prompt: "estimate", image_url: "https://example.com/frame.png", duration: opts.duration ?? 5 };
  const estimate = await hf.estimate(model, params).catch(asActionError);
  return { model, ...estimate, spentTodayUsd: await spentToday(config), dailyLimitUsd: config.hfDailyLimitUsd };
}

/** Скачивает оплаченный результат в библиотеку. Безопасно повторять: уже скачанное не трогается. */
export async function fetchMedia(id: string, config: AdsConfig = loadConfig(), factory: ClientFactory = defaultClient): Promise<MediaRecord> {
  const hf = client(config, factory);
  const found = (await read(config.dataDir)).media.find((m) => m.id === id);
  if (!found) throw new ActionError("Запись не найдена", 404);
  if (found.status === "ready") return found;

  let url = found.url;
  if (!url) url = (await hf.wait(found.requestId)).urls[0];
  let data: Buffer;
  try {
    data = await hf.download(url);
  } catch (e) {
    await mutate(config.dataDir, (s) => {
      const stored = s.media.find((m) => m.id === id);
      if (stored) stored.url = url;
    });
    const why = e instanceof Error ? e.message : String(e);
    throw new ActionError(`Результат готов и оплачен, но скачать его не удалось: ${why}. Повторите позже командой media-fetch ${id}.`, 502);
  }
  await saveFile(config, found.file, data);
  await mutate(config.dataDir, (s) => {
    const stored = s.media.find((m) => m.id === id);
    if (stored) Object.assign(stored, { url, status: "ready", bytes: data.length });
  });
  return { ...found, url, status: "ready", bytes: data.length };
}

function asActionError(e: unknown): never {
  if (e instanceof ActionError) throw e;
  if (e instanceof HiggsfieldError) throw new ActionError(e.message, 502);
  throw e;
}

export interface GenerateImageInput {
  accountId: string;
  prompt: string;
  aspectRatio?: "1:1" | "4:3" | "3:4" | "16:9" | "9:16";
  note?: string;
  model?: string;
  maxUsd?: number;
}

/** Генерирует изображение — например, фон для баннера. */
export async function generateImage(
  input: GenerateImageInput,
  config: AdsConfig = loadConfig(),
  actor: Actor = "agent",
  factory: ClientFactory = defaultClient,
): Promise<MediaRecord> {
  if (!input.prompt.trim()) throw new ActionError("Опишите, что должно быть на изображении", 400);
  const hf = client(config, factory);
  const account = await findAccount(config, input.accountId);
  return run(config, hf, {
    kind: "image",
    account,
    model: input.model ?? MODELS.image,
    params: { prompt: input.prompt.trim(), aspect_ratio: input.aspectRatio ?? "1:1" },
    prompt: input.prompt.trim(),
    extension: "jpg",
    note: input.note,
    actor,
    maxUsd: input.maxUsd,
  }).catch(asActionError);
}

export interface GenerateVideoInput {
  accountId: string;
  /** Что должно происходить в кадре: движение камеры, действие. */
  prompt: string;
  /** Первый кадр: отрисованный креатив нужного формата... */
  creativeId?: string;
  format?: string;
  /** ...или ранее сгенерированное изображение из библиотеки. */
  imageMediaId?: string;
  duration?: 5 | 10;
  note?: string;
  model?: string;
  maxUsd?: number;
}

/** Генерирует ролик из первого кадра: баннера или сгенерированного изображения. */
export async function generateVideo(
  input: GenerateVideoInput,
  config: AdsConfig = loadConfig(),
  actor: Actor = "agent",
  factory: ClientFactory = defaultClient,
): Promise<MediaRecord> {
  if (!input.prompt.trim()) throw new ActionError("Опишите, что должно происходить в ролике", 400);
  if (Boolean(input.creativeId) === Boolean(input.imageMediaId)) {
    throw new ActionError("Укажите первый кадр: либо креатив (creativeId), либо изображение из библиотеки (imageMediaId)", 400);
  }
  const hf = client(config, factory);
  const account = await findAccount(config, input.accountId);

  let frame: Buffer;
  let contentType: string;
  if (input.creativeId) {
    frame = await readCreativeFile(input.creativeId, input.format ?? "wide", config);
    contentType = "image/png";
  } else {
    const image = await readMediaFile(input.imageMediaId!, config);
    if (image.record.kind !== "image") throw new ActionError("Первым кадром может быть только изображение", 400);
    frame = image.data;
    contentType = "image/jpeg";
  }

  try {
    const imageUrl = await hf.upload(frame, contentType);
    return await run(config, hf, {
      kind: "video",
      account,
      model: input.model ?? MODELS.video,
      params: { prompt: input.prompt.trim(), image_url: imageUrl, duration: input.duration ?? 5 },
      prompt: input.prompt.trim(),
      extension: "mp4",
      note: input.note,
      sourceCreativeId: input.creativeId,
      actor,
      maxUsd: input.maxUsd,
    });
  } catch (e) {
    return asActionError(e);
  }
}

/** Загружает ролик на рекламную площадку и возвращает идентификатор видеодополнения для объявления. */
export async function uploadVideoToPlatform(id: string, config: AdsConfig = loadConfig(), actor: Actor = "agent"): Promise<string> {
  requireWrite(config);
  const { record: media, data } = await readMediaFile(id, config);
  if (media.kind !== "video") throw new ActionError("На площадку как видеодополнение загружается только ролик", 400);
  if (media.uploads) return media.uploads.creativeId;

  const account = await findAccount(config, media.accountId);
  let uploads: NonNullable<MediaRecord["uploads"]> | undefined;
  const entry = await record(
    config,
    { accountId: account.id, accountName: account.name, campaignName: "Библиотека креативов", description: "Ролик загружен на площадку как видеодополнение", actor, reason: media.note },
    async () => {
      uploads = await providerFor(config, account).uploadVideo(media.prompt.slice(0, 200), data);
    },
  );
  if (!entry.ok || !uploads) throw new ActionError(`Ролик не загружен: ${entry.error}`, 502);
  const done = uploads;
  await mutate(config.dataDir, (s) => {
    const stored = s.media.find((m) => m.id === id);
    if (stored) stored.uploads = done;
  });
  return done.creativeId;
}
