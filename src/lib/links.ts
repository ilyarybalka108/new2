import type { Domain } from "./types";

const q = (s: string) => encodeURIComponent(s.trim());

export function searchLinks(domain: Domain, title: string, creator: string) {
  const full = `${creator} ${title}`.trim();
  switch (domain) {
    case "music":
      return [
        { label: "Яндекс Музыка", url: `https://music.yandex.ru/search?text=${q(full)}` },
        { label: "Bandcamp", url: `https://bandcamp.com/search?q=${q(full)}` },
        { label: "Discogs", url: `https://www.discogs.com/search/?q=${q(full)}&type=all` },
        { label: "RateYourMusic", url: `https://rateyourmusic.com/search?searchterm=${q(full)}` },
      ];
    case "film":
      return [
        { label: "Кинопоиск", url: `https://www.kinopoisk.ru/index.php?kp_query=${q(title)}` },
        { label: "Letterboxd", url: `https://letterboxd.com/search/${q(title)}/` },
      ];
    case "book":
      return [
        { label: "Литрес", url: `https://www.litres.ru/search/?q=${q(full)}` },
        { label: "Букмейт", url: `https://bookmate.ru/search?query=${q(full)}` },
        { label: "Goodreads", url: `https://www.goodreads.com/search?q=${q(full)}` },
      ];
  }
}
