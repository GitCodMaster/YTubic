import type { HistoryEntry } from "@/lib/innertube/history";
import type { ShelfItem } from "@/lib/innertube/types";
import type { PlayLogEntry } from "@/lib/store/play-log";

/**
 * Builds the History page's list from the two records of what was played:
 * the account's history (every device, but only to the day, and only what
 * was reported to the account) and this device's own play log (exact times,
 * but only this device).
 */

/** The page shows the newest this many plays, as in "last 1000 played". */
export const HISTORY_LIMIT = 1000;

const MINUTE = 60_000;
const DAY = 86_400_000;

export type HistoryOrigin = "local" | "account" | "both";

export type HistoryRow = {
  item: ShelfItem;
  /** Unix ms. Exact for `local` and `both`; for `account` a stand-in that
   *  keeps YouTube's order inside its day. */
  playedAt: number;
  /** True when only the day (or less) is known. */
  approx: boolean;
  origin: HistoryOrigin;
  /** Short label for the time column: "Today", "Nov 12", "October". */
  when: string;
};

/** Which plays to show: "local" is this device's log, "account" is the
 *  account's history, "both" is everything, with duplicates merged. */
export type SourceFilter = "both" | "local" | "account";
export type SortDirection = "desc" | "asc";

// ---------- time buckets ----------

const MONTHS = [
  "january", "february", "march", "april", "may", "june", "july",
  "august", "september", "october", "november", "december",
];
const WEEKDAYS = [
  "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
];

/** Local midnight `offset` days from the day containing `ts`. Built from
 *  calendar fields so daylight-saving changes cannot skew it. */
function dayStart(ts: number, offset = 0): number {
  const d = new Date(ts);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset).getTime();
}

export type TimeRange = { start: number; end: number };

/**
 * The span of time a YouTube Music history heading stands for, or null for
 * a heading it does not recognise. English only: requests are made with
 * `hl: "en"`. `end` never exceeds `now`.
 */
export function bucketRange(label: string, now: number): TimeRange | null {
  const text = label.trim().toLowerCase().replace(/\.$/, "");
  const clamp = (start: number, end: number): TimeRange => ({
    start,
    end: Math.min(end, now),
  });

  if (text === "today") return clamp(dayStart(now), dayStart(now, 1));
  if (text === "yesterday") return clamp(dayStart(now, -1), dayStart(now));
  if (text === "this week") return clamp(dayStart(now, -7), dayStart(now, -1));
  if (text === "last week") return clamp(dayStart(now, -14), dayStart(now, -7));

  const weekday = WEEKDAYS.findIndex((w) => w === text || w.slice(0, 3) === text);
  if (weekday >= 0) {
    // The most recent such day before yesterday (today and yesterday have
    // their own headings).
    for (let k = 2; k <= 7; k++) {
      const s = dayStart(now, -k);
      if (new Date(s).getDay() === weekday) return clamp(s, dayStart(now, -k + 1));
    }
    return null;
  }

  // "October", "October 2025", "Oct 14", "October 14, 2025"
  const m = /^([a-z]+)\.?(?:\s+(\d{1,2}))?(?:,?\s+(\d{4}))?$/.exec(text);
  if (!m) return null;
  const month = MONTHS.findIndex((n) => n === m[1] || n.slice(0, 3) === m[1]);
  if (month < 0) return null;
  const nowDate = new Date(now);
  const day = m[2] ? Number(m[2]) : undefined;
  let year = m[3] ? Number(m[3]) : nowDate.getFullYear();
  const startOf = (y: number) =>
    new Date(y, month, day ?? 1).getTime();
  if (!m[3] && startOf(year) > now) year -= 1;
  const start = startOf(year);
  const end = day
    ? new Date(year, month, day + 1).getTime()
    : new Date(year, month + 1, 1).getTime();
  return clamp(start, end);
}

/**
 * A timestamp for every account entry, given the heading each sat under, in
 * YouTube's order (newest first). Entries under one heading are spread
 * evenly through its span, newest first; a heading that cannot be read
 * places its entries just after the previous one. The result never
 * increases from one entry to the next, so YouTube's order is kept.
 */
export function accountTimes(buckets: string[], now: number): number[] {
  const out: number[] = new Array(buckets.length);
  let i = 0;
  while (i < buckets.length) {
    let j = i;
    while (j < buckets.length && buckets[j] === buckets[i]) j++;
    const range = bucketRange(buckets[i], now);
    const count = j - i;
    for (let k = 0; k < count; k++) {
      const idx = i + k;
      const before = idx > 0 ? out[idx - 1] : now;
      let t: number;
      if (range) {
        const span = Math.max(range.end - range.start, 1);
        t = range.end - ((k + 0.5) / count) * span;
      } else {
        t = before - MINUTE;
      }
      out[idx] = idx > 0 ? Math.min(t, before - 1000) : t;
    }
    i = j;
  }
  return out;
}

// ---------- labels ----------

function sameDay(a: number, b: number): boolean {
  return dayStart(a) === dayStart(b);
}

/** "Today", "Yesterday" or a short date, for an exact or one-day time. */
export function formatWhen(ts: number, now: number): string {
  if (sameDay(ts, now)) return "Today";
  if (sameDay(ts, dayStart(now, -1))) return "Yesterday";
  const sameYear = new Date(ts).getFullYear() === new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  }).format(ts);
}

// ---------- merge ----------

function fromLocal(e: PlayLogEntry): ShelfItem {
  return {
    kind: "song",
    id: e.id,
    title: e.title,
    artists: e.artists,
    album: e.album,
    albumId: e.albumId,
    duration: e.duration,
    thumbnails: e.thumbnails,
  };
}

type Acct = {
  item: ShelfItem;
  bucket: string;
  ts: number;
  range: TimeRange | null;
  matched: boolean;
  order: number;
};

/**
 * Merge both records into one list, newest first, capped at `limit`.
 *
 * A local play and an account entry are the same play when they are the
 * same video and the local time falls in the account entry's day (or, when
 * its heading is unreadable, within a day of its stand-in time). Matching is
 * one to one, so playing a song three times needs three entries on a side
 * to be merged. A merged play keeps the exact local time.
 */
export function mergeHistory(args: {
  account: HistoryEntry[];
  local: PlayLogEntry[];
  now: number;
  limit?: number;
}): HistoryRow[] {
  const { account, local, now, limit = HISTORY_LIMIT } = args;

  const times = accountTimes(
    account.map((e) => e.bucket),
    now,
  );
  const acct: Acct[] = account.map((e, i) => ({
    item: e.item,
    bucket: e.bucket,
    ts: times[i],
    range: bucketRange(e.bucket, now),
    matched: false,
    order: i,
  }));
  const byId = new Map<string, Acct[]>();
  for (const a of acct) {
    const list = byId.get(a.item.id);
    if (list) list.push(a);
    else byId.set(a.item.id, [a]);
  }

  const rows: (HistoryRow & { order: number })[] = [];
  const localSorted = [...local].sort((a, b) => b.playedAt - a.playedAt);

  localSorted.forEach((loc, li) => {
    let best: Acct | undefined;
    let bestDelta = Infinity;
    for (const a of byId.get(loc.id) ?? []) {
      if (a.matched) continue;
      const inWindow = a.range
        ? loc.playedAt >= a.range.start - 5 * MINUTE &&
          loc.playedAt <= a.range.end + 5 * MINUTE
        : Math.abs(a.ts - loc.playedAt) <= DAY;
      if (!inWindow) continue;
      const delta = Math.abs(a.ts - loc.playedAt);
      if (delta < bestDelta) {
        best = a;
        bestDelta = delta;
      }
    }
    if (best) best.matched = true;
    rows.push({
      item: best ? best.item : fromLocal(loc),
      playedAt: loc.playedAt,
      approx: false,
      origin: best ? "both" : "local",
      when: formatWhen(loc.playedAt, now),
      order: best ? best.order : acct.length + li,
    });
  });

  for (const a of acct) {
    if (a.matched) continue;
    const oneDay =
      a.range !== null && a.range.end - a.range.start <= DAY + MINUTE;
    rows.push({
      item: a.item,
      playedAt: a.ts,
      approx: true,
      origin: "account",
      // A heading wider than a day ("October") is shown as is: a date made
      // up from the stand-in time would claim more than is known.
      when: oneDay ? formatWhen(a.ts, now) : a.bucket || "Earlier",
      order: a.order,
    });
  }

  rows.sort((x, y) => y.playedAt - x.playedAt || x.order - y.order);
  return rows.slice(0, limit).map(({ order: _order, ...row }) => row);
}

// ---------- filter and sort ----------

/** Lowercase and strip accents, so "beyonce" finds "Beyoncé". */
export function normalizeQuery(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export type HistoryFilters = {
  source: SourceFilter;
  /** Substring of the title. */
  title: string;
  /** Substring of any credited artist. */
  artist: string;
  direction: SortDirection;
};

function artistNames(item: ShelfItem): string {
  if (item.artists?.length) return item.artists.map((a) => a.name).join(" ");
  return item.subtitle ?? "";
}

export function filterHistory(
  rows: HistoryRow[],
  f: HistoryFilters,
): HistoryRow[] {
  const title = normalizeQuery(f.title);
  const artist = normalizeQuery(f.artist);
  const out = rows.filter((r) => {
    if (f.source === "local" && r.origin === "account") return false;
    if (f.source === "account" && r.origin === "local") return false;
    if (title && !normalizeQuery(r.item.title).includes(title)) return false;
    if (artist && !normalizeQuery(artistNames(r.item)).includes(artist)) {
      return false;
    }
    return true;
  });
  // `rows` arrive newest first.
  return f.direction === "asc" ? out.reverse() : out;
}
