import { describe, expect, it } from "vitest";
import { selectBest } from "@/lib/lyrics/score";

describe("titles that carry the artist credit", () => {
  const record = {
    trackName: "DVRST, monrxe - Darling",
    artistName: "DVRST",
    duration: 218,
    syncedLyrics: "[00:08.50] DVRST\n[00:19.48] I flip a crumb to a brick",
    plainLyrics: null,
  };
  it("matches 'ARTISTS - Title' stored under one of the artists", () => {
    const hit = selectBest(
      { title: "Darling", artist: "DVRST, monrxe", durationSec: 218 },
      [record],
    );
    expect(hit?.record).toBe(record);
  });
  it("matches when the title only carries one of the credits", () => {
    const r = { ...record, trackName: "monrxe - Darling" };
    const hit = selectBest(
      { title: "Darling", artist: "DVRST, monrxe", durationSec: 218 },
      [r],
    );
    expect(hit?.record).toBe(r);
  });
  it("still rejects a different song by an unrelated artist", () => {
    const r = { ...record, trackName: "Someone Else - Darling", artistName: "Someone Else" };
    const hit = selectBest(
      { title: "Darling", artist: "DVRST, monrxe", durationSec: 218 },
      [r],
    );
    expect(hit).toBeNull();
  });
});
