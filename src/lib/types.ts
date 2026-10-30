import { z } from "zod";

export const Domain = z.enum(["music", "film", "book"]);
export type Domain = z.infer<typeof Domain>;

export const Depth = z.enum(["entry", "deep", "obscure"]);
export type Depth = z.infer<typeof Depth>;

export const ConnectionType = z.enum([
  "label",
  "producer",
  "musician",
  "scene",
  "era",
  "mood",
  "theme",
  "adaptation",
  "influence",
  "style",
]);

export const Connection = z.object({
  type: ConnectionType,
  text: z.string().describe("Короткая фраза: через что связано с вкусом пользователя"),
});

export const Recommendation = z.object({
  domain: Domain,
  title: z.string().describe("Название в оригинале (альбом, фильм, книга)"),
  title_ru: z
    .string()
    .nullable()
    .describe("Русское название, если есть устоявшееся; иначе null"),
  creator: z.string().describe("Исполнитель / режиссёр / автор"),
  year: z.number().int().nullable(),
  why: z
    .string()
    .describe("2–4 предложения: почему это подойдёт именно этому человеку, с опорой на его список"),
  connections: z.array(Connection).min(1).max(4),
  depth: Depth.describe("entry = известное, deep = для знающих, obscure = редкость"),
  confidence: z.number().min(0).max(1),
});
export type Recommendation = z.infer<typeof Recommendation>;

export const TasteAxis = z.object({
  name: z.string().describe("Короткое название оси, например «Мрачность»"),
  value: z.number().int().min(0).max(100),
  note: z.string().describe("Одно предложение, что это значит для рекомендаций"),
});

export const TasteProfile = z.object({
  summary: z
    .string()
    .describe("3–5 предложений: портрет вкуса, без лести, конкретно"),
  axes: z.array(TasteAxis).min(3).max(6),
  anchors: z
    .array(z.string())
    .min(2)
    .max(6)
    .describe("Ключевые опоры вкуса: сцены, лейблы, авторы, периоды"),
  blind_spots: z
    .array(z.string())
    .max(3)
    .describe("Куда вкус пока не заходил, но может зайти"),
});

export const RecommendationResponse = z.object({
  profile: TasteProfile,
  recommendations: z.array(Recommendation).min(3).max(15),
});
export type RecommendationResponse = z.infer<typeof RecommendationResponse>;

export const Verification = z.enum(["verified", "not_found", "unavailable", "skipped"]);
export type Verification = z.infer<typeof Verification>;

export type GroundedRecommendation = Recommendation & {
  verification: Verification;
  canonical?: { title: string; creator?: string; year?: number | null; source: string; url: string };
  links: { label: string; url: string }[];
};

export type ApiResult = {
  mode: "live" | "demo";
  model?: string;
  profile: z.infer<typeof TasteProfile>;
  recommendations: GroundedRecommendation[];
  input_summary: { music: number; film: number; book: number };
  warnings: string[];
};

export type UserInput = {
  music: string[];
  film: string[];
  book: string[];
  want: Domain[];
  depth: "balanced" | "digger";
  note?: string;
};
