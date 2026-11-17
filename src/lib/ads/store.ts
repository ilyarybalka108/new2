import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AccountSettings, ActionLogEntry } from "./types.ts";

// Состояние, которое должно переживать перезапуск: настройки кабинетов и журнал действий.
// Один JSON-файл — достаточно для одного пользователя и не требует базы данных.

interface State {
  settings: Record<string, AccountSettings>;
  log: ActionLogEntry[];
}

const MAX_LOG = 500;
const empty = (): State => ({ settings: {}, log: [] });

interface Slot {
  dir: string | null;
  state: State | null;
  /** Очередь записей: сохраняем строго по одной, чтобы не повредить файл. */
  writing: Promise<void>;
}

const store = globalThis as typeof globalThis & { __adsStore?: Slot };

function slot(dir: string | null): Slot {
  if (!store.__adsStore || store.__adsStore.dir !== dir) {
    store.__adsStore = { dir, state: null, writing: Promise.resolve() };
  }
  return store.__adsStore;
}

async function load(dir: string | null): Promise<State> {
  const s = slot(dir);
  if (s.state) return s.state;
  if (dir === null) return (s.state = empty());
  try {
    const parsed = JSON.parse(await readFile(path.join(dir, "cabinet.json"), "utf8")) as Partial<State>;
    s.state = { settings: parsed.settings ?? {}, log: parsed.log ?? [] };
  } catch (e) {
    // Файла ещё нет — начинаем с пустого состояния. Повреждённый файл молча не затираем.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Не удалось прочитать файл состояния: ${(e as Error).message}`);
    s.state = empty();
  }
  return s.state;
}

function save(dir: string | null): Promise<void> {
  const s = slot(dir);
  if (dir === null) return Promise.resolve();
  s.writing = s.writing
    .catch(() => {})
    .then(async () => {
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, "cabinet.json");
      // Пишем во временный файл и переименовываем: при сбое старый файл остаётся целым.
      await writeFile(`${file}.tmp`, JSON.stringify(s.state, null, 2));
      await rename(`${file}.tmp`, file);
    });
  return s.writing;
}

export async function getSettings(dir: string | null, accountId: string): Promise<AccountSettings> {
  return (await load(dir)).settings[accountId] ?? {};
}

export async function saveSettings(dir: string | null, accountId: string, settings: AccountSettings): Promise<void> {
  const state = await load(dir);
  state.settings[accountId] = settings;
  await save(dir);
}

export async function appendLog(dir: string | null, entry: ActionLogEntry): Promise<void> {
  const state = await load(dir);
  state.log.unshift(entry);
  state.log.length = Math.min(state.log.length, MAX_LOG);
  await save(dir);
}

export async function readLog(dir: string | null, limit = 20): Promise<ActionLogEntry[]> {
  return (await load(dir)).log.slice(0, limit);
}

/** Сбрасывает состояние в памяти — для тестов. */
export function resetStore() {
  store.__adsStore = undefined;
}
