import { parse } from "yaml";
import type { TimedLine, TimedWord } from "@/lib/lyrics/types";

/**
 * Parse an LRCLIB "Lyricsfile" (YAML) into timed lines with word timings.
 *
 * LRCLIB returns it as the raw `lyricsfile` string on /api/get and
 * /api/search. Shape (only the parts we use):
 *
 *   lines:
 *     - text: "..."
 *       start_ms: 229
 *       end_ms: 2651          # optional
 *       words:                # optional / may be empty
 *         - { text: "...", start_ms: 229 }
 *
 * Words only have a start; a word ends where the next one starts, and the
 * last word ends with its line. Lines without words stay ordinary
 * line-synced lines, so a file can mix both.
 *
 * Returns [] for anything that is not a usable Lyricsfile.
 */
export function parseLyricsfile(src: string): TimedLine[] {
  let doc: unknown;
  try {
    doc = parse(src);
  } catch {
    return [];
  }
  const rawLines = (doc as { lines?: unknown } | null)?.lines;
  if (!Array.isArray(rawLines)) return [];

  const out: TimedLine[] = [];
  for (const raw of rawLines) {
    if (!raw || typeof raw !== "object") continue;
    const l = raw as Record<string, unknown>;
    const startMs = num(l.start_ms);
    if (startMs === null) continue;
    const text = typeof l.text === "string" ? l.text.trim() : "";
    const endMs = num(l.end_ms);
    const line: TimedLine = { start: startMs / 1000, text };
    if (endMs !== null && endMs >= startMs) line.end = endMs / 1000;

    const words = buildWords(l.words, line.end);
    if (words.length > 0) line.words = words;
    out.push(line);
  }

  out.sort((a, b) => a.start - b.start);
  // Same convention as parseLRC: a line with no end of its own runs until
  // the next one starts.
  for (let i = 0; i < out.length - 1; i++) {
    if (out[i].end === undefined) out[i].end = out[i + 1].start;
  }
  return out;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
}

function buildWords(raw: unknown, lineEnd: number | undefined): TimedWord[] {
  if (!Array.isArray(raw)) return [];
  const parsed: { text: string; start: number }[] = [];
  for (const w of raw) {
    if (!w || typeof w !== "object") continue;
    const o = w as Record<string, unknown>;
    const s = num(o.start_ms);
    if (s === null || typeof o.text !== "string" || o.text === "") continue;
    parsed.push({ text: o.text, start: s / 1000 });
  }
  parsed.sort((a, b) => a.start - b.start);
  return parsed.map((w, i) => {
    const next = parsed[i + 1]?.start;
    // Last word: the line's end, else a short default so it still fills.
    const end = next ?? Math.max(lineEnd ?? 0, w.start + 0.6);
    return { text: w.text, start: w.start, end: Math.max(end, w.start) };
  });
}

/** Start of the last line, in seconds, or null. Used for overhang checks. */
export function lyricsfileLastStart(src: string | null | undefined): number | null {
  if (!src || !src.trim()) return null;
  const lines = parseLyricsfile(src);
  return lines.length ? lines[lines.length - 1].start : null;
}
