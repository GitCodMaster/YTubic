import { describe, expect, it } from "vitest";
import {
  POP_REST_S,
  popCurve,
  popStrength,
  popTransform,
} from "@/lib/lyrics/bounce";

describe("bounce curve", () => {
  it("is flat before the word and once the spring has settled", () => {
    expect(popCurve(-0.2)).toBe(0);
    expect(popCurve(0)).toBe(0);
    expect(popCurve(POP_REST_S)).toBe(0);
    expect(popTransform(-1, 1)).toBe("");
    expect(popTransform(5, 1)).toBe("");
  });
  it("peaks near 1 quickly, then undershoots", () => {
    let peak = 0;
    let peakAt = 0;
    let low = 0;
    for (let a = 0; a < POP_REST_S; a += 0.005) {
      const v = popCurve(a);
      if (v > peak) {
        peak = v;
        peakAt = a;
      }
      low = Math.min(low, v);
    }
    expect(peak).toBeGreaterThan(0.9);
    expect(peak).toBeLessThan(1.1);
    expect(peakAt).toBeLessThan(0.15);
    expect(low).toBeLessThan(-0.05);
  });
  it("pops short words more gently, capped for long ones", () => {
    expect(popStrength(0.05)).toBeCloseTo(0.45);
    expect(popStrength(0.15)).toBeCloseTo(0.5);
    expect(popStrength(2)).toBe(1);
  });
});
