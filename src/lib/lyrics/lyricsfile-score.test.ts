import { describe, expect, it } from "vitest";
import { selectBest } from "@/lib/lyrics/score";

describe("Lyricsfile records in the scorer", () => {
  const record = {
    trackName: "Rays of Serenity",
    artistName: "DVRST",
    duration: 130,
    syncedLyrics: null,
    plainLyrics: null,
    lyricsfile: "lines:\n  - {text: a, start_ms: 229}\n",
  };

  it("accepts a record whose only body is a Lyricsfile", () => {
    const hit = selectBest(
      { title: "Rays of Serenity", artist: "DVRST", durationSec: 130 },
      [record],
    );
    expect(hit?.record).toBe(record);
  });

  it("accepts a one-artist record for a multi-artist credit", () => {
    const hit = selectBest(
      {
        title: "Rays of Serenity",
        artist: "DVRST, safetypleace, Nia.wave",
        durationSec: 130,
      },
      [record],
    );
    expect(hit?.record).toBe(record);
  });
});
