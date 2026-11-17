import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type AdsConfig, loadConfig } from "./config.ts";
import { FORMATS, formatByKey, IMAGE_AD_MAX_BYTES, renderCreative } from "./creatives.ts";
import { ActionError, findAccount, providerFor, record, requireWrite } from "./service.ts";
import { mutate, read } from "./store.ts";
import type { Actor, CreativeRecord, CreativeSpec } from "./types.ts";

// Библиотека креативов: отрисованные баннеры хранятся рядом с состоянием кабинета,
// а идентификаторы загруженных на площадку изображений запоминаются, чтобы не грузить их дважды.

const memory = globalThis as typeof globalThis & { __adsCreativeFiles?: Map<string, Buffer> };
const files = (memory.__adsCreativeFiles ??= new Map<string, Buffer>());

const fileKey = (id: string, format: string) => `${id}/${format}.png`;

async function saveFile(config: AdsConfig, id: string, format: string, data: Buffer) {
  if (config.dataDir === null) {
    files.set(fileKey(id, format), data);
    return;
  }
  const dir = path.join(config.dataDir, "creatives", id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${format}.png`), data);
}

export interface CreateCreativeInput {
  accountId: string;
  spec: CreativeSpec;
  /** Ключи форматов; по умолчанию отрисовываются все. */
  formats?: string[];
  note?: string;
}

/** Отрисовывает креатив во всех запрошенных форматах и кладёт его в библиотеку. */
export async function createCreative(input: CreateCreativeInput, config: AdsConfig = loadConfig()): Promise<CreativeRecord> {
  const account = await findAccount(config, input.accountId);
  const formats = (input.formats?.length ? input.formats : FORMATS.map((f) => f.key)).map(formatByKey);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const bytes: Record<string, number> = {};

  for (const format of formats) {
    let png: Buffer;
    try {
      png = await renderCreative(input.spec, format);
    } catch (e) {
      throw new ActionError(e instanceof Error ? e.message : String(e), 400);
    }
    if (format.use === "image_ad" && png.length > IMAGE_AD_MAX_BYTES) {
      throw new ActionError(`Формат ${format.key} получился ${Math.round(png.length / 1024)} КБ — Директ принимает до 512 КБ`, 400);
    }
    await saveFile(config, id, format.key, png);
    bytes[format.key] = png.length;
  }

  const created: CreativeRecord = {
    id,
    createdAt: new Date().toISOString(),
    accountId: account.id,
    accountName: account.name,
    spec: input.spec,
    formats: formats.map((f) => f.key),
    bytes,
    uploads: {},
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  await mutate(config.dataDir, (s) => {
    s.creatives.unshift(created);
  });
  return created;
}

export async function listCreatives(config: AdsConfig = loadConfig(), accountId?: string): Promise<CreativeRecord[]> {
  const all = (await read(config.dataDir)).creatives;
  return accountId ? all.filter((c) => c.accountId === accountId) : all;
}

async function findCreative(config: AdsConfig, id: string, format: string): Promise<CreativeRecord> {
  const found = (await read(config.dataDir)).creatives.find((c) => c.id === id);
  if (!found || !found.formats.includes(format)) throw new ActionError("Креатив или формат не найден", 404);
  return found;
}

export async function readCreativeFile(id: string, format: string, config: AdsConfig = loadConfig()): Promise<Buffer> {
  await findCreative(config, id, format);
  if (config.dataDir === null) {
    const data = files.get(fileKey(id, format));
    if (!data) throw new ActionError("Файл креатива не найден", 404);
    return data;
  }
  return readFile(path.join(config.dataDir, "creatives", id, `${format}.png`));
}

/** Загружает один формат креатива на площадку и возвращает идентификатор изображения для объявлений. */
export async function uploadCreative(
  id: string,
  format: string,
  config: AdsConfig = loadConfig(),
  actor: Actor = "agent",
): Promise<string> {
  requireWrite(config);
  const creative = await findCreative(config, id, format);
  if (creative.uploads[format]) return creative.uploads[format];

  const account = await findAccount(config, creative.accountId);
  const data = await readCreativeFile(id, format, config);
  let hash = "";
  const entry = await record(
    config,
    {
      accountId: account.id,
      accountName: account.name,
      campaignName: "Библиотека креативов",
      description: `Загружено изображение «${creative.spec.headline}», формат ${format}`,
      actor,
      reason: creative.note,
    },
    async () => {
      hash = await providerFor(config, account).uploadImage(`${creative.spec.headline.slice(0, 60)} ${format}`, data);
    },
  );
  if (!entry.ok) throw new ActionError(`Изображение не загружено: ${entry.error}`, 502);
  await mutate(config.dataDir, (s) => {
    const stored = s.creatives.find((c) => c.id === id);
    if (stored) stored.uploads[format] = hash;
  });
  return hash;
}
