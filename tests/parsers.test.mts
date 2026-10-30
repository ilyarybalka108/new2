import test from "node:test";
import assert from "node:assert/strict";
import { parseCsv, importFile, parseFreeText } from "../src/lib/parsers.ts";

test("parseCsv handles quotes and commas", () => {
  const rows = parseCsv('a,b\n"x, y","he said ""hi"""\n');
  assert.deepEqual(rows, [["a", "b"], ["x, y", 'he said "hi"']]);
});

test("Letterboxd export", () => {
  const csv = "Date,Name,Year,Letterboxd URI,Rating\n2024-01-01,Stalker,1979,https://boxd.it/x,5\n2024-01-02,Bad Film,2001,https://boxd.it/y,2\n";
  const r = importFile("ratings.csv", csv);
  assert.equal(r?.domain, "film");
  assert.deepEqual(r?.items, ["Stalker (1979)"]);
});

test("Goodreads export", () => {
  const csv = 'Book Id,Title,Author,My Rating,Exclusive Shelf\n1,"Solaris (Masterworks)",Stanisław Lem,5,read\n2,Skip Me,Someone,5,to-read\n';
  const r = importFile("goodreads_library_export.csv", csv);
  assert.equal(r?.source, "Goodreads");
  assert.deepEqual(r?.items, ["Stanisław Lem — Solaris"]);
});

test("Last.fm scrobbles aggregate", () => {
  const csv = "uts,utc_time,artist,artist_mbid,album,album_mbid,track,track_mbid\n1,t,Burial,,Untrue,,Archangel,\n2,t,Burial,,Untrue,,Near Dark,\n3,t,Grouper,,Ruins,,Clearing,\n";
  const r = importFile("scrobbles.csv", csv);
  assert.equal(r?.domain, "music");
  assert.deepEqual(r?.items, ["Burial — Untrue (×2)", "Grouper — Ruins"]);
});

test("Spotify StreamingHistory json", () => {
  const json = JSON.stringify([{ artistName: "Burial", trackName: "Archangel" }, { artistName: "Burial", trackName: "Archangel" }]);
  const r = importFile("StreamingHistory0.json", json);
  assert.deepEqual(r?.items, ["Burial — Archangel (×2)"]);
});

test("free text splits lines and commas, keeps dashes", () => {
  assert.deepEqual(parseFreeText("1. Burial — Untrue\nGrouper, Portishead\n- Сталкер (1979, Тарковский)"), [
    "Burial — Untrue",
    "Grouper",
    "Portishead",
    "Сталкер (1979, Тарковский)",
  ]);
});
