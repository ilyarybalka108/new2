import { getJson, similar } from "./http";
import type { GroundedRecommendation } from "../types";

type RG = { id: string; title: string; "first-release-date"?: string; "artist-credit"?: { name: string }[] };
type Artist = { id: string; name: string; score?: number };

/** Проверка альбома/исполнителя по MusicBrainz. Лимит API — 1 запрос/сек, вызывать последовательно. */
export async function verifyMusic(title: string, creator: string): Promise<Pick<GroundedRecommendation, "verification" | "canonical">> {
  const lucene = (s: string) => s.replace(/[+\-&|!(){}\[\]^"~*?:\\\/]/g, " ").trim();
  const q = `releasegroup:"${lucene(title)}" AND artist:"${lucene(creator)}"`;
  const url = `https://musicbrainz.org/ws/2/release-group?query=${encodeURIComponent(q)}&fmt=json&limit=5`;
  const data = await getJson<{ "release-groups"?: RG[] }>(url);
  if (data === null) return { verification: "unavailable" };
  const hit = (data["release-groups"] ?? []).find(
    (rg) => similar(rg.title, title) && (rg["artist-credit"] ?? []).some((a) => similar(a.name, creator))
  );
  if (hit) {
    return {
      verification: "verified",
      canonical: {
        title: hit.title,
        creator: hit["artist-credit"]?.[0]?.name,
        year: hit["first-release-date"] ? Number(hit["first-release-date"].slice(0, 4)) : null,
        source: "MusicBrainz",
        url: `https://musicbrainz.org/release-group/${hit.id}`,
      },
    };
  }
  // Возможно, рекомендован исполнитель целиком, а не альбом
  const aUrl = `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(`artist:"${lucene(title)}"`)}&fmt=json&limit=3`;
  const artists = await getJson<{ artists?: Artist[] }>(aUrl);
  const a = artists?.artists?.find((x) => similar(x.name, title) && (x.score ?? 0) >= 90);
  if (a) {
    return {
      verification: "verified",
      canonical: { title: a.name, source: "MusicBrainz", url: `https://musicbrainz.org/artist/${a.id}`, year: null },
    };
  }
  return { verification: "not_found" };
}
