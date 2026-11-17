import type { Lyrics, TimedLine } from "@/lib/lyrics/types";
import { parseLRC } from "@/lib/lyrics/parse-lrc";
import { parseLyricsfile } from "@/lib/lyrics/parse-lyricsfile";
import { fetchLrclibCandidates, type LrclibRecord } from "@/lib/lyrics/lrclib";
import {
  scoreCandidate,
  selectBest,
  type ScoreQuery,
} from "@/lib/lyrics/score";
import { reattributedFromTitle } from "@/lib/track-meta";

/**
 * Lyrics for "slowed + reverb" uploads, derived from the original song's.
 * BETA.
 *
 * A slowed track is the original stretched in time, so every timestamp of
 * the original's lyrics scales by one factor: the ratio of the two
 * durations. Only full-length slowed versions qualify. An edit with a new
 * intro, a cut verse or a longer outro is not a pure stretch, and the
 * scaled lines drift; the sanity checks below reject what they can see,
 * and the UI labels the result as beta for what they cannot.
 */

/**
 * Speed ratios (original duration / slowed duration) we accept. Slowed
 * edits sit around 0.75 to 0.9. Below 0.55 is not a slowed song but a
 * different one; at 0.97 or above there is no slowdown to correct for, so
 * the original's own lyrics should have been found directly.
 */
export const MIN_RATIO = 0.55;
export const MAX_RATIO = 0.97;

const SLOWED_WORD = /\bslowed\b/i;

/**
 * The title of the original, or null when this does not look like a slowed
 * upload. Strips "(Slowed + Reverb)", "[Slowed & Reverb]", "- Slowed Down",
 * "slowed n reverb" and the like. Deliberately only "slowed": sped-up and
 * nightcore versions go the other way and are not handled.
 */
export function slowedBaseTitle(title: string): string | null {
  if (!SLOWED_WORD.test(title)) return null;
  let t = title
    // Any bracketed group that mentions slowed.
    .replace(/\([^)]*\bslowed\b[^)]*\)/gi, " ")
    .replace(/\[[^\]]*\bslowed\b[^\]]*\]/gi, " ")
    // "- Slowed + Reverb" / "| slowed down" tails.
    .replace(/\s[-–—|:]\s*slowed\b.*$/i, " ")
    // A bare "slowed + reverb" left in the middle or at the end.
    .replace(/\bslowed\s*(?:\+|&|and|n|x)?\s*(?:reverb|down|version)?\b/gi, " ")
    .replace(/\breverb(?:ed)?\b/gi, " ");
  t = t
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[-–—|:+&]\s*$/g, "")
    .trim();
  return t.length > 0 ? t : null;
}

/** Multiply every timing by `factor`. Pure; returns new lines. */
export function scaleLines(lines: TimedLine[], factor: number): TimedLine[] {
  return lines.map((l) => ({
    ...l,
    start: l.start * factor,
    end: l.end === undefined ? undefined : l.end * factor,
    words: l.words?.map((w) => ({
      ...w,
      start: w.start * factor,
      end: w.end * factor,
    })),
  }));
}

/**
 * Scale the original's lines onto the slowed recording, or null when the
 * numbers say this is not a plain slowdown.
 */
export function deriveSlowedLyrics(args: {
  slowedDuration: number;
  originalDuration: number;
  lines: TimedLine[];
  from: string;
}): Lyrics | null {
  const { slowedDuration, originalDuration, lines, from } = args;
  if (!(slowedDuration > 0) || !(originalDuration > 0) || lines.length === 0) {
    return null;
  }
  const ratio = originalDuration / slowedDuration;
  if (ratio < MIN_RATIO || ratio > MAX_RATIO) return null;

  const scaled = scaleLines(lines, 1 / ratio);
  // The lyrics cannot start after the track has ended. Catches a record
  // whose duration field disagrees with its own timings.
  const last = scaled[scaled.length - 1];
  if (last.start >= slowedDuration) return null;

  return {
    kind: "timed",
    lines: scaled,
    source: "LRCLIB",
    adjusted: { ratio, from },
  };
}

function linesOf(r: LrclibRecord): TimedLine[] {
  if (typeof r.lyricsfile === "string" && r.lyricsfile.trim()) {
    const l = parseLyricsfile(r.lyricsfile);
    if (l.length > 0) return l;
  }
  if (typeof r.syncedLyrics === "string" && r.syncedLyrics.trim()) {
    return parseLRC(r.syncedLyrics);
  }
  return [];
}

function log(...args: unknown[]) {
  console.info("[lyrics:slowed]", ...args);
}

/** "A, B & C" -> ["A", "B", "C"]. */
function splitCredit(credit: string): string[] {
  return credit
    .split(/\s*(?:,|&|\band\b|\bx\b|\bfeat\.?|\bft\.?)\s*/i)
    .map((a) => a.trim())
    .filter(Boolean);
}

type Reading = { title: string; artist?: string; artists?: string[] };

type Pick = { record: LrclibRecord; score: number; words: boolean };

/**
 * The best original among `pool` for `reading`, or null. Every record is
 * logged with what happened to it, so a miss can be diagnosed from the
 * console instead of guessed at.
 */
function pickOriginal(
  reading: Reading,
  slowedDuration: number,
  pool: LrclibRecord[],
): Pick | null {
  let pick: Pick | null = null;
  const report: string[] = [];
  for (const record of pool) {
    const name = `"${record.trackName}" by "${record.artistName}" ${record.duration ?? "?"}s`;
    const d = record.duration;
    if (typeof d !== "number" || d <= 0) {
      report.push(`${name}: no duration`);
      continue;
    }
    const ratio = d / slowedDuration;
    if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
      report.push(`${name}: speed ${ratio.toFixed(2)} outside ${MIN_RATIO}-${MAX_RATIO}`);
      continue;
    }
    if (linesOf(record).length === 0) {
      report.push(`${name}: no synced lyrics`);
      continue;
    }
    // The scorer judges title and artist. Its duration check has nothing to
    // compare against here (the original's length is unknown until chosen),
    // so each record is scored against its own length and the duration
    // window above does that job.
    const q: ScoreQuery = {
      title: reading.title,
      artist: reading.artist,
      durationSec: d,
    };
    const hit = selectBest(q, [record]);
    if (!hit) {
      report.push(`${name}: rejected (${scoreCandidate(q, record).reason})`);
      continue;
    }
    const words = !!record.lyricsfile?.trim();
    report.push(
      `${name}: candidate, speed ${ratio.toFixed(2)}, ${words ? "word" : "line"} synced`,
    );
    const better =
      !pick ||
      (words && !pick.words) ||
      (words === pick.words && hit.verdict.score > pick.score);
    if (better) pick = { record, score: hit.verdict.score, words };
  }
  log(
    `"${reading.title}" / "${reading.artist ?? "-"}":`,
    `${pool.length} records,`,
    pick ? `picked "${pick.record.trackName}"` : "no usable original",
    report.slice(0, 12),
  );
  return pick;
}

/**
 * Find the original on LRCLIB and derive lyrics for the slowed recording.
 * Returns null for "no usable original", throws when LRCLIB did not answer.
 */
export async function fetchSlowedLyrics(
  p: {
    title: string;
    artist?: string;
    artists?: string[];
    /** Duration of the slowed recording, seconds. */
    duration: number;
  },
  signal?: AbortSignal,
): Promise<Lyrics | null> {
  const base = slowedBaseTitle(p.title);
  if (!base || !(p.duration > 0)) return null;

  // Slowed uploads are mostly re-uploads: the real artist is in the title
  // ("DVRST - Autumn Wind (slowed + reverb)") and the artist field holds
  // the uploader's channel, which no lyrics database knows. When the title
  // reads like that, that reading goes first; the ordinary one (title as
  // given, artist as given) is the fallback, for tracks whose credited
  // artist really is the artist.
  const readings: Reading[] = [];
  const alt = reattributedFromTitle(base, p.artist);
  if (alt) {
    readings.push({
      title: alt.title,
      artist: alt.artist,
      artists: splitCredit(alt.artist),
    });
  }
  readings.push({ title: base, artist: p.artist, artists: p.artists });

  log(
    `looking for the original of "${p.title}" (${p.duration}s) as`,
    readings.map((r) => `"${r.title}" by "${r.artist ?? "-"}"`),
  );

  for (const reading of readings) {
    const pool = await fetchLrclibCandidates(reading, signal);
    const pick = pickOriginal(reading, p.duration, pool);
    if (!pick) continue;
    const derived = deriveSlowedLyrics({
      slowedDuration: p.duration,
      originalDuration: pick.record.duration as number,
      lines: linesOf(pick.record),
      from: `${pick.record.trackName} - ${pick.record.artistName}`,
    });
    if (derived) {
      log(
        "derived lyrics from",
        `"${pick.record.trackName}",`,
        `speed ${(derived.kind === "timed" && derived.adjusted?.ratio.toFixed(3)) || "?"}`,
      );
      return derived;
    }
    log("picked record failed the sanity checks");
  }
  return null;
}
