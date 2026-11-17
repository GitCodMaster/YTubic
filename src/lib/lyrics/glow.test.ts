import { describe, expect, it } from "vitest";
import {
  currentWordIndex,
  GLOW_FADE_S,
  isGlowing,
  lineTailEnd,
} from "@/lib/lyrics/glow";
import { POP_REST_S } from "@/lib/lyrics/bounce";

const W = [
  { text: "a ", start: 1, end: 1.5 },
  { text: "b ", start: 1.5, end: 2 },
  { text: "c", start: 2, end: 3 },
];

describe("currentWordIndex", () => {
  it("is -1 before the first word and follows each word's start", () => {
    expect(currentWordIndex(W, 0.5)).toBe(-1);
    expect(currentWordIndex(W, 1.2)).toBe(0);
    expect(currentWordIndex(W, 1.6)).toBe(1);
    expect(currentWordIndex(W, 2.5)).toBe(2);
  });
  it("stays on the earlier word in the gap between two words", () => {
    expect(currentWordIndex(W, 1.99)).toBe(1);
  });
  it("drops to none once the last word has ended, so the glow fades", () => {
    expect(currentWordIndex(W, 3)).toBe(-1);
    expect(currentWordIndex(W, 4)).toBe(-1);
  });
});

describe("isGlowing", () => {
  it("glows the current word and the one before it only", () => {
    const on = [0, 1, 2, 3].filter((i) => isGlowing(i, 2));
    expect(on).toEqual([1, 2]);
  });
  it("glows nothing before the first word", () => {
    expect([0, 1].some((i) => isGlowing(i, -1))).toBe(false);
  });
  it("on the first word only that word glows", () => {
    expect([0, 1, 2].filter((i) => isGlowing(i, 0))).toEqual([0]);
  });
});

describe("lineTailEnd", () => {
  it("waits for the glow fade after a long last word", () => {
    expect(lineTailEnd(W)).toBeCloseTo(Math.max(3 + GLOW_FADE_S, 2 + POP_REST_S));
  });
  it("waits for the pop to settle after a short last word", () => {
    const short = [{ text: "x", start: 2, end: 2.1 }];
    expect(lineTailEnd(short)).toBeCloseTo(2 + POP_REST_S);
    expect(lineTailEnd(short)).toBeGreaterThan(2.1 + GLOW_FADE_S);
  });
});
