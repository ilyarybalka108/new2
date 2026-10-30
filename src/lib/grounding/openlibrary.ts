import { getJson, similar } from "./http";
import type { GroundedRecommendation } from "../types";

type Doc = { key: string; title: string; author_name?: string[]; first_publish_year?: number };

export async function verifyBook(title: string, creator: string): Promise<Pick<GroundedRecommendation, "verification" | "canonical">> {
  const url = `https://openlibrary.org/search.json?title=${encodeURIComponent(title)}&author=${encodeURIComponent(creator)}&limit=5&fields=key,title,author_name,first_publish_year`;
  const data = await getJson<{ docs?: Doc[] }>(url);
  if (data === null) return { verification: "unavailable" };
  const hit = (data.docs ?? []).find((d) => similar(d.title, title));
  if (!hit) return { verification: "not_found" };
  return {
    verification: "verified",
    canonical: {
      title: hit.title,
      creator: hit.author_name?.[0],
      year: hit.first_publish_year ?? null,
      source: "Open Library",
      url: `https://openlibrary.org${hit.key}`,
    },
  };
}
