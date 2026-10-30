import type { Domain } from "./types";

/** Разбор CSV с учётом кавычек. Возвращает строки как массивы ячеек. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

export type ImportResult = { domain: Domain; items: string[]; source: string };

/**
 * Определяет формат экспорта по заголовку и превращает его в список строк вида
 * «Исполнитель — Альбом» / «Фильм (год)» / «Автор — Книга».
 * Поддержка: Letterboxd (watched/ratings/diary), Goodreads, Last.fm (scrobbles CSV),
 * Spotify (StreamingHistory JSON), а также произвольный текст построчно.
 */
export function importFile(name: string, content: string): ImportResult | null {
  const lower = name.toLowerCase();
  const trimmed = content.trim();

  if (lower.endsWith(".json") || trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return importSpotifyJson(trimmed);
  }

  const rows = parseCsv(trimmed);
  if (rows.length < 2) return null;
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (names: string[]) => header.findIndex((h) => names.includes(h));

  // Letterboxd: Date,Name,Year,Letterboxd URI[,Rating]
  if (idx(["name"]) >= 0 && idx(["year"]) >= 0 && header.some((h) => h.includes("letterboxd"))) {
    const n = idx(["name"]), y = idx(["year"]), r = idx(["rating"]);
    const items = rows
      .slice(1)
      .filter((row) => r < 0 || !row[r] || Number(row[r]) >= 3.5)
      .map((row) => `${row[n]} (${row[y]})`);
    return { domain: "film", items: dedupe(items), source: "Letterboxd" };
  }

  // Goodreads: Title, Author, My Rating, Exclusive Shelf ...
  if (idx(["title"]) >= 0 && idx(["author"]) >= 0) {
    const t = idx(["title"]), a = idx(["author"]), r = idx(["my rating"]), s = idx(["exclusive shelf"]);
    const items = rows
      .slice(1)
      .filter((row) => (s < 0 || row[s] === "read") && (r < 0 || !row[r] || Number(row[r]) >= 4))
      .map((row) => `${row[a]} — ${row[t].replace(/\s*\(.*?\)\s*$/, "")}`);
    return { domain: "book", items: dedupe(items), source: "Goodreads" };
  }

  // Last.fm export (например, через lastfm-to-csv): uts,utc_time,artist,artist_mbid,album,album_mbid,track,...
  if (idx(["artist"]) >= 0 && (idx(["album"]) >= 0 || idx(["track"]) >= 0)) {
    const a = idx(["artist"]), al = idx(["album"]), tr = idx(["track"]);
    return { domain: "music", items: topCounts(rows.slice(1).map((row) => al >= 0 && row[al] ? `${row[a]} — ${row[al]}` : `${row[a]} — ${row[tr]}`)), source: "Last.fm" };
  }

  return null;
}

function importSpotifyJson(text: string): ImportResult | null {
  try {
    const data = JSON.parse(text);
    const arr: unknown[] = Array.isArray(data) ? data : [];
    const names = arr
      .map((e) => {
        const o = e as Record<string, unknown>;
        const artist = (o.artistName ?? o.master_metadata_album_artist_name) as string | undefined;
        const album = o.master_metadata_album_album_name as string | undefined;
        const track = (o.trackName ?? o.master_metadata_track_name) as string | undefined;
        if (!artist) return null;
        return album ? `${artist} — ${album}` : track ? `${artist} — ${track}` : artist;
      })
      .filter((x): x is string => !!x);
    if (!names.length) return null;
    return { domain: "music", items: topCounts(names), source: "Spotify" };
  } catch {
    return null;
  }
}

/** Самые частые записи (для историй прослушиваний), максимум 60. */
function topCounts(items: string[], limit = 60): string[] {
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => (v > 1 ? `${k} (×${v})` : k));
}

function dedupe(items: string[]): string[] {
  return [...new Set(items.map((s) => s.trim()).filter(Boolean))];
}

/** Произвольный текст: по строкам, запятым или точкам с запятой. */
export function parseFreeText(text: string): string[] {
  return dedupe(
    text
      .split(/\r?\n|;/)
      .flatMap((line) => (line.includes(" — ") || line.includes(" - ") ? [line] : line.split(/,(?![^()]*\))/)))
      .map((s) => s.replace(/^[\-\*\d\.\)\s]+/, "").trim())
      .filter((s) => s.length > 1)
  ).slice(0, 150);
}
