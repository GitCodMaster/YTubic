import { getVersion } from "@tauri-apps/api/app";
import type { Lyrics } from "@/lib/lyrics/types";
import { parseLRC } from "@/lib/lyrics/parse-lrc";
import { parseLyricsfile } from "@/lib/lyrics/parse-lyricsfile";
import { romanizedArtist } from "@/lib/lyrics/match";
import {
  scoreCandidate,
  selectBest,
  type ScoreQuery,
} from "@/lib/lyrics/score";
import { reattributedFromTitle } from "@/lib/track-meta";
import {
  createDeadline,
  lyricsFetch,
  throwForStatus,
  type Deadline,
} from "@/lib/lyrics/http";

/**
 * LRCLIB (https://lrclib.net) — free, open lyrics database with synced
 * LRC-format lyrics.
 *
 * Tauri's HTTP plugin is required, same as Musixmatch and Genius. LRCLIB
 * itself does send permissive CORS headers, so a webview `fetch()` looks
 * like it should work, and it does in `tauri dev`, which is exactly why
 * this shipped broken. CORS is not the binding constraint: our own
 * `app.security.csp` in `src-tauri/tauri.conf.json` declares an explicit
 * `connect-src` listing only `'self'` and localhost. Tauri injects that CSP
 * when serving `build.frontendDist` and never against `build.devUrl`, so a
 * plain `fetch("https://lrclib.net/...")` succeeds in dev and is blocked in
 * every packaged build, silently taking out the only duration-aware
 * provider and leaving the weaker sources to answer alone.
 *
 * Going through `tauriFetch` sidesteps the CSP (the request is made by Rust,
 * not the webview) and lets us send `Lrclib-Client`, which LRCLIB asks
 * third-party clients for and which the webview forbids from JS.
 * `lrclib.net` must therefore be in `src-tauri/capabilities/default.json`:
 * `tauri-plugin-http` rejects unlisted hosts at the Rust boundary before any
 * network call. `hosts.test.ts` guards both halves of that.
 */

// Resolved once, lazily. Hardcoding the version here would silently go stale
// on the next release bump, and `getVersion` is async, so the header is built
// on first use and reused. Falls back to an unversioned string outside a
// Tauri context.
let cachedHeaders: Record<string, string> | null = null;

async function headers(): Promise<Record<string, string>> {
  if (cachedHeaders) return cachedHeaders;
  let version = "";
  try {
    version = ` v${await getVersion()}`;
  } catch {
    /* not running under Tauri */
  }
  cachedHeaders = {
    Accept: "application/json",
    "Lrclib-Client": `YTubic${version} (https://github.com/ameenalasady/YTubic)`,
  };
  return cachedHeaders;
}

/**
 * Diagnostics, written to the WEBVIEW console (F12 / right-click, Inspect).
 * The terminal that runs `tauri dev` only shows the Rust side, which is why
 * nothing about lyrics ever appeared there.
 */
function log(...args: unknown[]) {
  console.info("[lyrics:lrclib]", ...args);
}

function describeRecord(r: LrclibRecord): string {
  const body = r.lyricsfile
    ? "words"
    : r.syncedLyrics
      ? "synced"
      : r.plainLyrics
        ? "plain"
        : "empty";
  return `"${r.trackName}" by "${r.artistName}" ${r.duration ?? "?"}s [${body}]`;
}

/** The few best-scoring rejects with the reason each was refused. */
function explainRejects(q: ScoreQuery, pool: LrclibRecord[]): string[] {
  return pool
    .map((r) => ({ r, v: scoreCandidate(q, r) }))
    .sort((a, b) => b.v.score - a.v.score)
    .slice(0, 5)
    .map(({ r, v }) => `${describeRecord(r)} -> ${v.reason}`);
}

type LrclibParams = {
  title: string;
  artist?: string;
  album?: string;
  /** Duration in seconds. LRCLIB uses this to disambiguate matches. */
  duration?: number;
  /**
   * The individual credited artists. `artist` is these joined with ", ",
   * which LRCLIB's artist filter cannot match when it stores only one of
   * them. Used for a second round of lookups when the first finds nothing.
   */
  artists?: string[];
};

type LrclibRecord = {
  id?: number;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
  /** Raw YAML Lyricsfile: the only place LRCLIB keeps word timings. */
  lyricsfile?: string | null;
  instrumental?: boolean;
};

export async function fetchLrclibLyrics(
  p: LrclibParams,
  signal?: AbortSignal,
): Promise<Lyrics | null> {
  if (!p.title) return null;

  const deadline = createDeadline(signal);
  try {
    const first = await lookup(p, deadline);
    if (first) return first;

    // Nothing under the ordinary reading. If this looks like a re-upload
    // with the artist in the title and a channel name in the artist field,
    // try it the other way round. Only ever a second attempt, so a wrong
    // guess costs a request rather than a wrong answer.
    const alt = reattributedFromTitle(p.title, p.artist);
    if (!alt) return null;
    return await lookup({ ...p, title: alt.title, artist: alt.artist }, deadline);
  } finally {
    deadline.done();
  }
}

async function lookup(
  p: LrclibParams,
  deadline: Deadline,
): Promise<Lyrics | null> {
  // Race /get against /search. /get is the strict exact-match endpoint
  // (tight title+artist+duration match → fastest path when YT's
  // metadata happens to line up with LRCLIB's record), /search is the
  // fuzzy fallback. Running both concurrently means a /get miss no
  // longer adds the /search latency on top — worst-case becomes
  // max(get, search) ≈ 300 ms instead of get + search ≈ 500 ms. The
  // cost is one extra HTTP request when /get hits, which LRCLIB is
  // explicitly fine with (no advertised rate limit).
  //
  // We still PREFER /get's record when both succeed — it's a tighter
  // match on the same track, while /search may have picked a
  // re-master / live version.
  //
  // `allSettled`, not `all`: with `all`, a 5xx from either endpoint
  // rejected the pair and threw away a perfectly good record from the
  // other. One endpoint answering is enough.
  // A third query when the artist is Cyrillic. The provider filters by
  // artist server-side and by containment, so "Скриптонит" never returns
  // the rows filed as "Skryptonite" no matter how well the scorer would
  // rank them. Both spellings have to be asked for. The scorer still
  // decides, and dedups by lyric body, so the extra rows cost nothing but
  // one request.
  // Title-only, NOT artist-less: p.artist stays set, so the scorer still
  // verifies every row it brings back. Broadening what is RETRIEVED is a
  // different thing from dropping the constraint that VERIFIES.
  const romanized = romanizedArtist(p.artist);
  const [getR, searchR, romanR] = await Promise.allSettled([
    p.artist ? lrclibGet(p, deadline) : Promise.resolve(null),
    lrclibSearch(p, deadline),
    romanized
      ? lrclibSearch({ ...p, artist: undefined }, deadline)
      : Promise.resolve([]),
  ]);

  const get = getR.status === "fulfilled" ? getR.value : null;
  const search = [
    ...(searchR.status === "fulfilled" ? (searchR.value ?? []) : []),
    ...(romanR.status === "fulfilled" ? (romanR.value ?? []) : []),
  ];

  // One scored pool rather than a precedence rule between the endpoints.
  // /get's exact match used to win by default, but its +/-2s window
  // validates the metadata field, not the body: a live probe for a 248s
  // track returned a record whose lyrics run 68s past the end.
  const query: ScoreQuery = {
    title: p.title,
    artist: p.artist,
    durationSec: p.duration,
  };
  const pool = [...(get ? [get] : []), ...search];
  const best = selectBest(query, pool);
  log(
    `"${p.title}" / "${p.artist ?? "-"}" / ${p.duration ?? "?"}s:`,
    `get=${get ? "hit" : "miss"}, search=${search.length} rows,`,
    best ? `picked ${describeRecord(best.record)}` : "nothing accepted",
  );
  if (best) return mapRecord(best.record, best.verdict.suppressSynced);
  if (pool.length > 0) log("closest rejects:", explainRejects(query, pool));

  // Nothing survived scoring. Whether that is an answer depends on whether
  // both endpoints actually answered.
  if (searchR.status === "rejected") throw searchR.reason;
  if (getR.status === "rejected") throw getR.reason;

  // Both answered and nothing matched. With several credited artists that
  // is usually the retrieval, not the song: LRCLIB's /search filters
  // artist_name by containment and /get needs it exact, and most records
  // are filed under just one of the credits ("DVRST" for a track YouTube
  // Music lists as "DVRST, safetypleace, Nia.wave"). So ask again with each
  // artist on its own. The scorer still verifies against the FULL credit
  // (subset credits are free there), so this widens what is fetched
  // without loosening what is accepted.
  const singles = [...new Set(p.artists ?? [])]
    .filter((a) => a && a !== p.artist)
    .slice(0, 3);
  // A single credit was already asked for exactly; asking again would only
  // cost every lyric-less track an extra request.
  if (singles.length === 0) return null;
  const lead = singles[0];

  const extra = await Promise.allSettled([
    lrclibGet({ ...p, artist: lead }, deadline),
    ...singles.map((a) => lrclibSearch({ ...p, artist: a }, deadline)),
    // Free-text search over every field. It does not care how the record
    // splits "DVRST, monrxe - Darling" between title and artist, which is
    // exactly where the structured queries lose it.
    lrclibSearchText(`${p.title} ${lead}`, deadline),
  ]);
  const extraPool: LrclibRecord[] = [];
  let anyFulfilled = false;
  for (const r of extra) {
    if (r.status !== "fulfilled") continue;
    anyFulfilled = true;
    if (Array.isArray(r.value)) extraPool.push(...r.value);
    else if (r.value) extraPool.push(r.value);
  }
  if (!anyFulfilled) {
    const failed = extra.find((r) => r.status === "rejected");
    if (failed && failed.status === "rejected") throw failed.reason;
  }
  const retry = selectBest(query, extraPool);
  log(
    `retry with artists ${JSON.stringify(singles)} and free text:`,
    `${extraPool.length} rows,`,
    retry ? `picked ${describeRecord(retry.record)}` : "nothing accepted",
  );
  if (!retry && extraPool.length > 0) {
    log("closest rejects:", explainRejects(query, extraPool));
  }
  return retry ? mapRecord(retry.record, retry.verdict.suppressSynced) : null;
}

async function lrclibGet(
  p: LrclibParams,
  deadline: Deadline,
): Promise<LrclibRecord | null> {
  const url = new URL("https://lrclib.net/api/get");
  url.searchParams.set("track_name", p.title);
  if (p.artist) url.searchParams.set("artist_name", p.artist);
  if (p.album) url.searchParams.set("album_name", p.album);
  if (p.duration) {
    url.searchParams.set("duration", String(Math.round(p.duration)));
  }
  // Let network errors / 5xx propagate so react-query retries them instead
  // of caching a transient failure as a permanent "no lyrics" for an hour.
  // A 404 is a genuine miss and correctly resolves to null.
  const r = await lyricsFetch(url.toString(), deadline, await headers());
  if (r.status === 404) return null;
  if (!r.ok) throwForStatus(r.status, "LRCLIB /get");
  return (await r.json()) as LrclibRecord;
}

async function lrclibSearch(
  p: LrclibParams,
  deadline: Deadline,
): Promise<LrclibRecord[]> {
  const url = new URL("https://lrclib.net/api/search");
  url.searchParams.set("track_name", p.title);
  if (p.artist) url.searchParams.set("artist_name", p.artist);
  // Album is deliberately NOT sent. Measured: the right album leaves the
  // result count unchanged, a wrong one drops it to zero, and YTM and
  // LRCLIB disagree about albums constantly (compilations, regional
  // releases, single vs album). /get already uses it, where strictness is
  // the point and this is the fallback.
  const r = await lyricsFetch(url.toString(), deadline, await headers());
  if (!r.ok) throwForStatus(r.status, "LRCLIB /search");
  const results = (await r.json()) as LrclibRecord[];
  // Every record goes to the scorer. The old code pre-filtered to records
  // having synced lyrics, which empties the result set for tracks whose
  // only correct records are plain, and on a generic title concentrates
  // the survivors onto strangers.
  return Array.isArray(results) ? results : [];
}

async function lrclibSearchText(
  q: string,
  deadline: Deadline,
): Promise<LrclibRecord[]> {
  const url = new URL("https://lrclib.net/api/search");
  url.searchParams.set("q", q);
  const r = await lyricsFetch(url.toString(), deadline, await headers());
  if (!r.ok) throwForStatus(r.status, "LRCLIB /search?q");
  const results = (await r.json()) as LrclibRecord[];
  return Array.isArray(results) ? results : [];
}

function mapRecord(
  r: LrclibRecord,
  suppressSynced = false,
): Lyrics | null {
  if (r.instrumental) {
    return { kind: "plain", text: "🎵 Instrumental", source: "LRCLIB" };
  }
  // The Lyricsfile wins when there is one: it is the same song with
  // per-word timings, and LRCLIB says clients that understand it should
  // prefer it over the legacy fields it was derived from.
  if (
    !suppressSynced &&
    typeof r.lyricsfile === "string" &&
    r.lyricsfile.trim()
  ) {
    const lines = parseLyricsfile(r.lyricsfile);
    if (lines.length > 0) {
      return { kind: "timed", lines, source: "LRCLIB" };
    }
  }
  if (
    !suppressSynced &&
    typeof r.syncedLyrics === "string" &&
    r.syncedLyrics.trim()
  ) {
    const lines = parseLRC(r.syncedLyrics);
    if (lines.length > 0) {
      return { kind: "timed", lines, source: "LRCLIB" };
    }
  }
  if (typeof r.plainLyrics === "string" && r.plainLyrics.trim()) {
    return { kind: "plain", text: r.plainLyrics, source: "LRCLIB" };
  }
  return null;
}

