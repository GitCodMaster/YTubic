import type { TimedWord } from "@/lib/lyrics/types";
import { POP_REST_S } from "@/lib/lyrics/bounce";

/** How long the glow takes to fade out; keep in step with `.lyrics-glow-host`. */
export const GLOW_FADE_S = 0.35;

/**
 * Index of the word that is being sung at `t`, meaning the last word whose
 * start has passed, or -1 before the first word and once the line's last
 * word has ended (so the glow fades out there instead of sticking on the
 * last two words). Between two words it stays on the earlier one, so the
 * glow does not drop out in the gap.
 */
export function currentWordIndex(words: TimedWord[], t: number): number {
  const last = words[words.length - 1];
  if (!last || t >= last.end) return -1;
  let k = -1;
  for (let i = 0; i < words.length; i++) {
    if (words[i].start <= t) k = i;
    else break;
  }
  return k;
}

/**
 * Whether word `i` carries the glow while word `current` is being sung:
 * the current word and the one before it, nothing else.
 */
export function isGlowing(i: number, current: number): boolean {
  return current >= 0 && (i === current || i === current - 1);
}

/**
 * When a line's words are finished being drawn: after the last word's end
 * (so its glow can fade) and after the last word's pop has settled. Until
 * then the line must stay mounted, or its final words are cut off.
 */
export function lineTailEnd(words: TimedWord[]): number {
  const last = words[words.length - 1];
  if (!last) return -Infinity;
  return Math.max(last.end + GLOW_FADE_S, last.start + POP_REST_S);
}
