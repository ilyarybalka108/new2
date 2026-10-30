import type { GroundedRecommendation, Recommendation } from "../types";
import { searchLinks } from "../links";
import { verifyMusic } from "./musicbrainz";
import { verifyBook } from "./openlibrary";
import { verifyFilm } from "./films";
import { sleep } from "./http";

/**
 * Проверяет каждую рекомендацию по открытому каталогу и добавляет ссылки на площадки.
 * Музыка идёт последовательно (лимит MusicBrainz 1 req/s), книги и кино — параллельно.
 */
export async function groundAll(recs: Recommendation[]): Promise<GroundedRecommendation[]> {
  const withLinks = (r: Recommendation, v: Pick<GroundedRecommendation, "verification" | "canonical">): GroundedRecommendation => ({
    ...r,
    ...v,
    links: searchLinks(r.domain, r.title, r.creator),
  });

  const music = recs.filter((r) => r.domain === "music");
  const others = recs.filter((r) => r.domain !== "music");

  const otherResults = Promise.all(
    others.map(async (r) => withLinks(r, r.domain === "book" ? await verifyBook(r.title, r.creator) : await verifyFilm(r.title, r.creator, r.year)))
  );

  const musicResults: GroundedRecommendation[] = [];
  for (let i = 0; i < music.length; i++) {
    if (i > 0) await sleep(1100);
    musicResults.push(withLinks(music[i], await verifyMusic(music[i].title, music[i].creator)));
  }

  const all = [...musicResults, ...(await otherResults)];
  // Сохраняем исходный порядок модели
  return recs.map((r) => all.find((g) => g.title === r.title && g.creator === r.creator)!);
}
