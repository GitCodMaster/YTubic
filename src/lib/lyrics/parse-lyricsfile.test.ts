import { describe, expect, it } from "vitest";
import { parseLyricsfile } from "@/lib/lyrics/parse-lyricsfile";

const SAMPLE = `version: "1.0"
metadata:
  title: T
lines:
  - text: In a daze
    words:
      - text: "In "
        start_ms: 19128
      - text: "a "
        start_ms: 19341
      - text: daze
        start_ms: 19441
    start_ms: 19128
    end_ms: 21258
  - text: no words here
    words: []
    start_ms: 21258
    end_ms: 23718
  - text: last line
    start_ms: 23718
`;

describe("parseLyricsfile", () => {
  it("reads lines, word timings and ends", () => {
    const l = parseLyricsfile(SAMPLE);
    expect(l).toHaveLength(3);
    expect(l[0].start).toBeCloseTo(19.128);
    expect(l[0].words?.map((w) => w.text)).toEqual(["In ", "a ", "daze"]);
    expect(l[0].words?.[0].end).toBeCloseTo(19.341);
    // last word ends with its line
    expect(l[0].words?.[2].end).toBeCloseTo(21.258);
  });
  it("keeps lines without words as plain synced lines", () => {
    const l = parseLyricsfile(SAMPLE);
    expect(l[1].words).toBeUndefined();
    expect(l[1].end).toBeCloseTo(23.718);
  });
  it("fills a missing end from the next line", () => {
    const l = parseLyricsfile("lines:\n  - {text: a, start_ms: 1000}\n  - {text: b, start_ms: 2500}\n");
    expect(l[0].end).toBeCloseTo(2.5);
  });
  it("returns [] for junk", () => {
    expect(parseLyricsfile("not: [valid")).toEqual([]);
    expect(parseLyricsfile("hello")).toEqual([]);
    expect(parseLyricsfile("lines: 3")).toEqual([]);
  });
});
