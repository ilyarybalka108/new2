import { readFile } from "node:fs/promises";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import type { CreativeSpec } from "./types.ts";

// Статичные креативы: баннер собирается из текста и фирменного цвета по шаблону
// и отрисовывается в PNG нужного Директу размера. Браузер для этого не нужен.

export interface Format {
  key: string;
  label: string;
  width: number;
  height: number;
  /** Куда подходит: картинка текстово-графического объявления или графическое объявление. */
  use: "text_ad" | "image_ad";
}

/**
 * Форматы из требований API Директа. Для графических объявлений берём удвоенные размеры
 * из разрешённого списка — они выглядят чётко на экранах с высокой плотностью.
 */
export const FORMATS: Format[] = [
  { key: "square", label: "Квадрат 1:1", width: 1080, height: 1080, use: "text_ad" },
  { key: "wide", label: "Широкий 16:9", width: 1920, height: 1080, use: "text_ad" },
  { key: "300x250", label: "Баннер 300×250", width: 600, height: 500, use: "image_ad" },
  { key: "336x280", label: "Баннер 336×280", width: 672, height: 560, use: "image_ad" },
  { key: "240x400", label: "Баннер 240×400", width: 480, height: 800, use: "image_ad" },
  { key: "300x600", label: "Баннер 300×600", width: 600, height: 1200, use: "image_ad" },
  { key: "728x90", label: "Баннер 728×90", width: 1456, height: 180, use: "image_ad" },
  { key: "970x250", label: "Баннер 970×250", width: 1940, height: 500, use: "image_ad" },
];

/** Ограничение Директа на файл графического объявления. */
export const IMAGE_AD_MAX_BYTES = 512 * 1024;

export function formatByKey(key: string): Format {
  const format = FORMATS.find((f) => f.key === key);
  if (!format) throw new Error(`Неизвестный формат «${key}». Доступны: ${FORMATS.map((f) => f.key).join(", ")}`);
  return format;
}

// --- цвет -------------------------------------------------------------------------

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Цвет должен быть в формате #RRGGBB, получено «${hex}»`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Смешивает цвет с чёрным (amount < 0) или белым (amount > 0). */
export function shade(hex: string, amount: number): string {
  const target = amount < 0 ? 0 : 255;
  const t = Math.abs(amount);
  return `#${parseHex(hex)
    .map((c) => Math.round(c + (target - c) * t).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Относительная яркость по WCAG: по ней выбирается цвет текста поверх заливки. */
function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export const readableOn = (hex: string) => (luminance(hex) > 0.45 ? "#0b0b0b" : "#ffffff");

// --- подгонка текста --------------------------------------------------------------

/** Примерная ширина символа в долях кегля для жирного Inter. */
function charWidth(ch: string): number {
  if (ch === " ") return 0.27;
  if (/[.,:;!'"|]/.test(ch)) return 0.3;
  if (/[0-9]/.test(ch)) return 0.64;
  if (/[%₽—–\-+]/.test(ch)) return 0.7;
  if (/[ШЩЖМЫЮ]/.test(ch)) return 0.95;
  if (/[шщжмыю]/.test(ch)) return 0.82;
  if (/[A-ZА-ЯЁ]/.test(ch)) return 0.72;
  return 0.6;
}

export const textWidth = (text: string) => [...text].reduce((w, ch) => w + charWidth(ch), 0);

/**
 * Подбирает кегль и разбивку на строки так, чтобы текст уместился в заданную ширину
 * и число строк. Строки выравниваются по длине, чтобы не оставалось висящих слов.
 */
export function fitText(text: string, maxWidth: number, maxLines: number, maxSize: number, minSize: number) {
  const words = text.trim().split(/\s+/);
  for (let size = maxSize; size >= minSize; size -= Math.max(1, Math.round(maxSize / 40))) {
    const limit = maxWidth / size;
    if (words.some((w) => textWidth(w) > limit)) continue;
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (textWidth(next) <= limit) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
    if (lines.length <= maxLines) return { size, lines: balance(words, lines.length, limit) ?? lines };
  }
  // Не помещается даже минимальным кеглем — отдаём как есть, обрезать смысл нельзя.
  return { size: minSize, lines: [text] };
}

/** Перераспределяет слова по тому же числу строк так, чтобы самая длинная строка была короче. */
function balance(words: string[], lineCount: number, limit: number): string[] | null {
  if (lineCount < 2) return null;
  const target = textWidth(words.join(" ")) / lineCount;
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next) > target * 1.12 && lines.length < lineCount - 1) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  lines.push(line);
  return lines.length === lineCount && lines.every((l) => textWidth(l) <= limit) ? lines : null;
}

// --- вёрстка ----------------------------------------------------------------------

type Style = Record<string, string | number>;
interface Node {
  type: string;
  props: { style: Style; children?: (Node | string)[] | string; src?: string };
}
const box = (style: Style, ...children: (Node | string | null | false | undefined)[]): Node => ({
  type: "div",
  props: { style: { display: "flex", ...style }, children: children.filter((c): c is Node | string => Boolean(c)) },
});

const FONT_FAMILY = "Inter-latin, Inter-cyrillic, Inter-latin-ext, Inter-cyrillic-ext";

function textBlock(text: string, width: number, maxLines: number, maxSize: number, minSize: number, style: Style): Node {
  const fit = fitText(text, width, maxLines, maxSize, minSize);
  return box(
    { flexDirection: "column", fontSize: fit.size, lineHeight: 1.08, ...style },
    ...fit.lines.map((line) => box({ whiteSpace: "nowrap" }, line)),
  );
}

function palette(spec: CreativeSpec) {
  const color = spec.color || "#1c5cab";
  if (spec.style === "light") {
    return { background: "#fbfaf7", backgroundEnd: shade(color, 0.86), ink: "#0b0b0b", soft: "#52514e", accent: color, onAccent: readableOn(color), shape: color };
  }
  if (spec.style === "dark") {
    return { background: "#0f0f10", backgroundEnd: shade(color, -0.72), ink: "#ffffff", soft: "#c9c8c2", accent: color, onAccent: readableOn(color), shape: color };
  }
  const ink = readableOn(color);
  const accent = ink === "#ffffff" ? "#ffffff" : "#0b0b0b";
  return { background: color, backgroundEnd: shade(color, -0.38), ink, soft: ink === "#ffffff" ? "rgba(255,255,255,0.86)" : "rgba(11,11,11,0.78)", accent, onAccent: readableOn(accent === "#ffffff" ? "#ffffff" : "#0b0b0b"), shape: "#ffffff" };
}

/** Дерево элементов баннера. Вёрстка зависит от пропорций: полоса, вертикаль или обычный блок. */
export function layout(spec: CreativeSpec, width: number, height: number, background?: string): Node {
  const p = palette(spec);
  const ratio = width / height;
  const u = Math.min(width, height) / 100;
  const strip = ratio >= 3;
  const tall = ratio <= 0.7;
  const pad = strip ? Math.min(height, width / 8) * 0.16 : u * (tall ? 8 : 7);

  const decor: Node[] = background
    ? [
        { type: "img", props: { src: background, style: { position: "absolute", top: 0, left: 0, width, height, objectFit: "cover" } } },
        // Затемнение, чтобы текст читался на любой фотографии.
        box({ position: "absolute", top: 0, left: 0, width, height, background: "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.72) 100%)" }),
      ]
    : [
        box({ position: "absolute", top: -height * 0.35, right: -height * 0.2, width: height * 0.95, height: height * 0.95, borderRadius: height, background: p.shape, opacity: 0.1 }),
        box({ position: "absolute", bottom: -height * 0.3, right: height * 0.25, width: height * 0.6, height: height * 0.6, borderRadius: height, background: p.shape, opacity: 0.07 }),
      ];
  const ink = background ? "#ffffff" : p.ink;
  const soft = background ? "rgba(255,255,255,0.88)" : p.soft;

  const brand = (size: number) => box({ fontSize: size, fontWeight: 700, color: soft, letterSpacing: size * 0.02, whiteSpace: "nowrap" }, spec.brand);
  const cta = (size: number) =>
    spec.cta
      ? box(
          { fontSize: size, fontWeight: 700, color: p.onAccent, background: p.accent, borderRadius: size * 0.6, padding: `${size * 0.62}px ${size * 1.25}px`, whiteSpace: "nowrap" },
          spec.cta,
        )
      : null;
  const badge = (size: number) =>
    spec.badge
      ? box(
          { fontSize: size, fontWeight: 800, color: ink, border: `${Math.max(2, size * 0.09)}px solid ${ink}`, borderRadius: size * 0.5, padding: `${size * 0.35}px ${size * 0.8}px`, whiteSpace: "nowrap", alignSelf: "flex-start" },
          spec.badge,
        )
      : null;

  const base: Style = {
    width,
    height,
    position: "relative",
    overflow: "hidden",
    fontFamily: FONT_FAMILY,
    color: ink,
    background: `linear-gradient(135deg, ${p.background} 0%, ${p.backgroundEnd} 100%)`,
  };

  if (strip) {
    // Полоса бывает очень вытянутой (728×90) и умеренной (970×250): кегли считаем от меньшей из мер.
    const sh = Math.min(height, width / 8);
    const ctaSize = sh * 0.2;
    const ctaWidth = spec.cta ? textWidth(spec.cta) * ctaSize * 1.08 + ctaSize * 2.5 : 0;
    const brandSize = sh * 0.17;
    const brandWidth = textWidth(spec.brand) * brandSize * 1.1;
    const textArea = Math.max(sh, width - pad * 2 - ctaWidth - brandWidth - pad * (spec.cta ? 2 : 1));
    return box(
      base,
      ...decor,
      // Отступы задаются размерами внутреннего блока: движок прибавляет padding к размеру холста.
      box(
        { position: "absolute", top: 0, left: pad, width: width - pad * 2, height, alignItems: "center", gap: pad },
        brand(brandSize),
        box(
          { flexDirection: "column", width: textArea, justifyContent: "center", gap: sh * 0.06 },
          textBlock(spec.headline, textArea, 2, sh * 0.34, sh * 0.16, { fontWeight: 800 }),
          spec.subline && height >= 300 ? textBlock(spec.subline, textArea, 2, sh * 0.15, sh * 0.09, { fontWeight: 400, color: soft }) : null,
        ),
        cta(ctaSize),
      ),
    );
  }

  const inner = width - pad * 2;
  const headline = textBlock(spec.headline, inner, tall ? 6 : 4, u * (tall ? 13 : 11.5), u * 5.5, { fontWeight: 800 });
  const subline = spec.subline ? textBlock(spec.subline, inner, 3, u * 5, u * 3.4, { fontWeight: 400, color: soft, lineHeight: 1.25 }) : null;

  return box(
    base,
    ...decor,
    box(
      { position: "absolute", top: pad, left: pad, width: inner, height: height - pad * 2, flexDirection: "column", justifyContent: "space-between" },
      box({ alignItems: "center" }, brand(u * 4.2)),
      box({ flexDirection: "column", gap: u * 3.2 }, badge(u * 5), headline, subline),
      box({ alignItems: "center" }, cta(u * 4.6)),
    ),
  );
}

// --- отрисовка --------------------------------------------------------------------

type FontList = { name: string; data: Buffer; weight: 400 | 700 | 800; style: "normal" }[];
let fontsPromise: Promise<FontList> | null = null;

/**
 * Inter из пакета @fontsource/inter. Наборы символов подключаются под разными именами:
 * так движок перебирает их по очереди и находит и кириллицу, и латиницу с цифрами.
 */
function loadFonts(): Promise<FontList> {
  fontsPromise ??= (async () => {
    const dir = path.join(process.cwd(), "node_modules", "@fontsource", "inter", "files");
    const out: FontList = [];
    for (const subset of ["latin", "cyrillic", "latin-ext", "cyrillic-ext"]) {
      for (const weight of [400, 700, 800] as const) {
        out.push({ name: `Inter-${subset}`, data: await readFile(path.join(dir, `inter-${subset}-${weight}-normal.woff`)), weight, style: "normal" });
      }
    }
    return out;
  })();
  return fontsPromise;
}

/** Размер PNG из заголовка файла — для проверки результата. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

async function toDataUri(file: string): Promise<string> {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${(await readFile(file)).toString("base64")}`;
}

/** Отрисовывает баннер заданного формата в PNG. */
export async function renderCreative(spec: CreativeSpec, format: Format): Promise<Buffer> {
  if (!spec.headline.trim()) throw new Error("У креатива должен быть заголовок");
  if (!spec.brand.trim()) throw new Error("Укажите название бренда");
  const background = spec.backgroundFile ? await toDataUri(spec.backgroundFile) : undefined;
  const svg = await satori(layout(spec, format.width, format.height, background) as never, {
    width: format.width,
    height: format.height,
    fonts: await loadFonts(),
  });
  return Buffer.from(new Resvg(svg).render().asPng());
}
