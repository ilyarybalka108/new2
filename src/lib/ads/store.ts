import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AccountSettings, ActionLogEntry, AdTest, DailyReport } from "./types.ts";

// Состояние, которое должно переживать перезапуск: настройки кабинетов, журнал изменений,
// отчёты ежедневных обходов и тесты объявлений. Один JSON-файл — достаточно для одного
// пользователя и не требует базы данных.

export interface State {
  settings: Record<string, AccountSettings>;
  log: ActionLogEntry[];
  reports: DailyReport[];
  tests: AdTest[];
}

const MAX_LOG = 2000;
const MAX_REPORTS = 90;
const empty = (): State => ({ settings: {}, log: [], reports: [], tests: [] });

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

/** Текущее состояние. Возвращаемый объект менять нельзя — для этого есть `mutate`. */
export async function read(dir: string | null): Promise<State> {
  const s = slot(dir);
  if (s.state) return s.state;
  if (dir === null) return (s.state = empty());
  try {
    const parsed = JSON.parse(await readFile(path.join(dir, "cabinet.json"), "utf8")) as Partial<State>;
    s.state = { ...empty(), ...parsed };
  } catch (e) {
    // Файла ещё нет — начинаем с пустого состояния. Повреждённый файл молча не затираем.
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Не удалось прочитать файл состояния: ${(e as Error).message}`);
    s.state = empty();
  }
  return s.state;
}

/** Меняет состояние и сохраняет его на диск. */
export async function mutate(dir: string | null, change: (state: State) => void): Promise<void> {
  const state = await read(dir);
  change(state);
  state.log.length = Math.min(state.log.length, MAX_LOG);
  state.reports.length = Math.min(state.reports.length, MAX_REPORTS);
  const s = slot(dir);
  if (dir === null) return;
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
  return (await read(dir)).settings[accountId] ?? {};
}

export function saveSettings(dir: string | null, accountId: string, settings: AccountSettings): Promise<void> {
  return mutate(dir, (state) => {
    state.settings[accountId] = settings;
  });
}

export function appendLog(dir: string | null, entry: ActionLogEntry): Promise<void> {
  return mutate(dir, (state) => {
    state.log.unshift(entry);
  });
}

export async function readLog(dir: string | null, limit = 30): Promise<ActionLogEntry[]> {
  return (await read(dir)).log.slice(0, limit);
}

/** Сбрасывает состояние в памяти — для тестов. */
export function resetStore() {
  store.__adsStore = undefined;
}
