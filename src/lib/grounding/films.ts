import { getJson, similar } from "./http";
import type { GroundedRecommendation } from "../types";

type TmdbMovie = { id: number; title: string; original_title: string; release_date?: string };
type WikiHit = { title: string; pageid: number };

/** Кино: TMDB, если задан TMDB_API_KEY; иначе Wikipedia (ru, затем en) как слабая проверка существования. */
export async function verifyFilm(title: string, creator: string, year: number | null): Promise<Pick<GroundedRecommendation, "verification" | "canonical">> {
  const key = process.env.TMDB_API_KEY;
  if (key) {
    const url = `https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(title)}${year ? `&year=${year}` : ""}&language=ru-RU`;
    const data = await getJson<{ results?: TmdbMovie[] }>(url);
    if (data === null) return { verification: "unavailable" };
    const hit = (data.results ?? []).find((m) => similar(m.original_title, title) || similar(m.title, title));
    if (!hit) return { verification: "not_found" };
    return {
      verification: "verified",
      canonical: {
        title: hit.original_title,
        year: hit.release_date ? Number(hit.release_date.slice(0, 4)) : null,
        source: "TMDB",
        url: `https://www.themoviedb.org/movie/${hit.id}`,
      },
    };
  }

  for (const lang of ["ru", "en"]) {
    const q = `${title} ${year ?? ""} ${lang === "ru" ? "фильм" : "film"} ${creator}`.trim();
    const url = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&srlimit=3&format=json&origin=*`;
    const data = await getJson<{ query?: { search?: WikiHit[] } }>(url);
    if (data === null) return { verification: "unavailable" };
    const hit = (data.query?.search ?? []).find((h) => similar(h.title, title));
    if (hit) {
      return {
        verification: "verified",
        canonical: { title: hit.title, year, source: `Wikipedia (${lang})`, url: `https://${lang}.wikipedia.org/?curid=${hit.pageid}` },
      };
    }
  }
  return { verification: "not_found" };
}
