import { describe, expect, it } from "vitest";
import {
  deriveSlowedLyrics,
  scaleLines,
  slowedBaseTitle,
} from "@/lib/lyrics/slowed";
import type { TimedLine } from "@/lib/lyrics/types";

describe("slowedBaseTitle", () => {
  it.each([
    ["Darling (Slowed + Reverb)", "Darling"],
    ["Darling [Slowed & Reverb]", "Darling"],
    ["Darling - Slowed + Reverb", "Darling"],
    ["Darling (slowed)", "Darling"],
    ["Darling (Slowed Down)", "Darling"],
    ["Darling (Slowed n Reverb) [Official Audio]", "Darling [Official Audio]"],
    ["Darling slowed + reverb", "Darling"],
    ["Rays of Serenity | Slowed", "Rays of Serenity"],
  ])("%s -> %s", (input, expected) => {
    expect(slowedBaseTitle(input)).toBe(expected);
  });

  it("returns null for titles that are not slowed uploads", () => {
    expect(slowedBaseTitle("Darling")).toBeNull();
    expect(slowedBaseTitle("Darling (Sped Up)")).toBeNull();
    expect(slowedBaseTitle("Reverb (Official Video)")).toBeNull();
  });

  it("returns null when nothing would be left", () => {
    expect(slowedBaseTitle("Slowed + Reverb")).toBeNull();
  });
});

const LINES: TimedLine[] = [
  {
    start: 10,
    end: 14,
    text: "a b",
    words: [
      { text: "a ", start: 10, end: 12 },
      { text: "b", start: 12, end: 14 },
    ],
  },
  { start: 14, end: 20, text: "c" },
];

describe("scaleLines", () => {
  it("scales lines and words, keeps text, does not mutate", () => {
    const out = scaleLines(LINES, 2);
    expect(out[0].start).toBe(20);
    expect(out[0].end).toBe(28);
    expect(out[0].words?.[1]).toMatchObject({ start: 24, end: 28, text: "b" });
    expect(out[1].end).toBe(40);
    expect(LINES[0].start).toBe(10);
  });
  it("leaves a missing end missing", () => {
    expect(scaleLines([{ start: 1, text: "x" }], 2)[0].end).toBeUndefined();
  });
});

describe("deriveSlowedLyrics", () => {
  const base = { lines: LINES, from: "Darling - DVRST" };

  it("scales by original/slowed duration", () => {
    // Original 100 s, slowed 125 s: ratio 0.8, timings x1.25.
    const r = deriveSlowedLyrics({
      ...base,
      originalDuration: 100,
      slowedDuration: 125,
    });
    expect(r?.kind).toBe("timed");
    if (r?.kind !== "timed") return;
    expect(r.adjusted?.ratio).toBeCloseTo(0.8);
    expect(r.lines[0].start).toBeCloseTo(12.5);
    expect(r.lines[0].words?.[1].end).toBeCloseTo(17.5);
  });

  it("rejects a ratio that is not a plain slowdown", () => {
    // Same length (ratio 1), longer original (>1), or wildly shorter.
    for (const [o, s] of [
      [100, 100],
      [100, 98],
      [100, 300],
    ]) {
      expect(
        deriveSlowedLyrics({ ...base, originalDuration: o, slowedDuration: s }),
      ).toBeNull();
    }
  });

  it("rejects lyrics that would start after the track ends", () => {
    expect(
      deriveSlowedLyrics({
        lines: [{ start: 90, text: "late" }],
        from: "x",
        originalDuration: 60,
        slowedDuration: 70,
      }),
    ).toBeNull();
  });

  it("rejects empty input", () => {
    expect(
      deriveSlowedLyrics({
        lines: [],
        from: "x",
        originalDuration: 100,
        slowedDuration: 125,
      }),
    ).toBeNull();
  });
});
