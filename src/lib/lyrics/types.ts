/**
 * A single line of synchronized lyrics.
 *
 * `start` is the second at which the line becomes active; `end` is when it
 * stops being active. Some lines have no text ("interlude" markers) — we
 * still render them so the highlight glides naturally.
 */
export type TimedLine = {
  start: number;
  end?: number;
  text: string;
  /** Per-word timings, when the source has them (LRCLIB Lyricsfile). */
  words?: TimedWord[];
};

/** One word (or syllable/phrase) of a word-synced line, in seconds. */
export type TimedWord = {
  start: number;
  end: number;
  text: string;
};

/** True when at least one line carries word timings. */
export function hasWordSync(l: Lyrics | null | undefined): boolean {
  return (
    l?.kind === "timed" && l.lines.some((x) => (x.words?.length ?? 0) > 0)
  );
}

export type Lyrics =
  | { kind: "timed"; lines: TimedLine[]; source?: string }
  | { kind: "plain"; text: string; source?: string };
