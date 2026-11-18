import { describe, expect, it } from "vitest";
import {
  accountTimes,
  bucketRange,
  filterHistory,
  formatWhen,
  mergeHistory,
  type HistoryRow,
} from "@/lib/history-merge";
import type { HistoryEntry } from "@/lib/innertube/history";
import type { PlayLogEntry } from "@/lib/store/play-log";

// Wednesday 18 November 2026, 15:00 local time.
const NOW = new Date(2026, 10, 18, 15, 0).getTime();
const at = (y: number, mo: number, d: number, h = 12, mi = 0) =>
  new Date(y, mo - 1, d, h, mi).getTime();

const item = (id: string, title = id, artist = "Artist") => ({
  kind: "song" as const,
  id,
  title,
  artists: [{ name: artist }],
  thumbnails: [],
});
const acct = (id: string, bucket: string, title?: string, artist?: string): HistoryEntry => ({
  item: item(id, title, artist),
  bucket,
});
const loc = (id: string, playedAt: number, title = id): PlayLogEntry => ({
  id,
  title,
  thumbnails: [],
  playedAt,
});

describe("bucketRange", () => {
  it("reads today and yesterday", () => {
    const t = bucketRange("Today", NOW)!;
    expect(t.start).toBe(at(2026, 11, 18, 0));
    expect(t.end).toBe(NOW);
    const y = bucketRange("Yesterday", NOW)!;
    expect(y.start).toBe(at(2026, 11, 17, 0));
    expect(y.end).toBe(at(2026, 11, 18, 0));
  });
  it("reads weekday names as the most recent such day before yesterday", () => {
    // Today is a Wednesday: Monday is 2 days back, Thursday 6.
    expect(bucketRange("Monday", NOW)!.start).toBe(at(2026, 11, 16, 0));
    expect(bucketRange("Thursday", NOW)!.start).toBe(at(2026, 11, 12, 0));
    // Wednesday itself is a week ago (today has its own heading).
    expect(bucketRange("Wednesday", NOW)!.start).toBe(at(2026, 11, 11, 0));
  });
  it("reads months, with and without a year or a day", () => {
    const oct = bucketRange("October", NOW)!;
    expect(oct.start).toBe(at(2026, 10, 1, 0));
    expect(oct.end).toBe(at(2026, 11, 1, 0));
    expect(bucketRange("December", NOW)!.start).toBe(at(2025, 12, 1, 0));
    expect(bucketRange("October 2024", NOW)!.start).toBe(at(2024, 10, 1, 0));
    const day = bucketRange("Nov 12", NOW)!;
    expect(day.start).toBe(at(2026, 11, 12, 0));
    expect(day.end).toBe(at(2026, 11, 13, 0));
  });
  it("never reaches past now", () => {
    expect(bucketRange("November", NOW)!.end).toBe(NOW);
  });
  it("returns null for headings it does not know", () => {
    expect(bucketRange("Heute", NOW)).toBeNull();
    expect(bucketRange("", NOW)).toBeNull();
  });
});

describe("accountTimes", () => {
  it("keeps YouTube's order and puts entries inside their day", () => {
    const t = accountTimes(["Today", "Today", "Yesterday", "Yesterday", "Monday"], NOW);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeLessThan(t[i - 1]);
    expect(t[0]).toBeGreaterThanOrEqual(at(2026, 11, 18, 0));
    expect(t[2]).toBeLessThan(at(2026, 11, 18, 0));
    expect(t[2]).toBeGreaterThanOrEqual(at(2026, 11, 17, 0));
  });
  it("places an unreadable heading just after the previous entry", () => {
    const t = accountTimes(["Yesterday", "Gestern", "Gestern"], NOW);
    expect(t[1]).toBeLessThan(t[0]);
    expect(t[2]).toBeLessThan(t[1]);
    expect(t[0] - t[1]).toBeLessThanOrEqual(60_000 + 1);
  });
});

describe("mergeHistory", () => {
  it("merges a local play into the account entry for the same video and day", () => {
    const rows = mergeHistory({
      account: [acct("a", "Today"), acct("b", "Today")],
      local: [loc("a", at(2026, 11, 18, 10, 30))],
      now: NOW,
    });
    const a = rows.find((r) => r.item.id === "a")!;
    expect(a.origin).toBe("both");
    expect(a.approx).toBe(false);
    expect(a.playedAt).toBe(at(2026, 11, 18, 10, 30));
    expect(rows.find((r) => r.item.id === "b")!.origin).toBe("account");
    expect(rows).toHaveLength(2);
  });

  it("keeps a local play that never reached the account", () => {
    const rows = mergeHistory({
      account: [acct("a", "Yesterday")],
      local: [loc("z", at(2026, 11, 18, 9, 0))],
      now: NOW,
    });
    expect(rows.map((r) => [r.item.id, r.origin])).toEqual([
      ["z", "local"],
      ["a", "account"],
    ]);
  });

  it("does not merge the same video on a different day", () => {
    const rows = mergeHistory({
      account: [acct("a", "Monday")],
      local: [loc("a", at(2026, 11, 18, 9, 0))],
      now: NOW,
    });
    expect(rows.map((r) => r.origin).sort()).toEqual(["account", "local"]);
  });

  it("merges one to one: three local plays, one account entry", () => {
    const rows = mergeHistory({
      account: [acct("a", "Today")],
      local: [
        loc("a", at(2026, 11, 18, 8)),
        loc("a", at(2026, 11, 18, 9)),
        loc("a", at(2026, 11, 18, 10)),
      ],
      now: NOW,
    });
    expect(rows.filter((r) => r.origin === "both")).toHaveLength(1);
    expect(rows.filter((r) => r.origin === "local")).toHaveLength(2);
  });

  it("sorts newest first and caps at the limit", () => {
    const rows = mergeHistory({
      account: [acct("a", "Today"), acct("b", "Yesterday"), acct("c", "Monday")],
      local: [],
      now: NOW,
      limit: 2,
    });
    expect(rows.map((r) => r.item.id)).toEqual(["a", "b"]);
  });

  it("labels wide headings as given and one-day ones as dates", () => {
    const rows = mergeHistory({
      account: [acct("a", "Yesterday"), acct("b", "October")],
      local: [],
      now: NOW,
    });
    expect(rows[0].when).toBe("Yesterday");
    expect(rows[1].when).toBe("October");
    expect(rows[1].approx).toBe(true);
  });
});

describe("formatWhen", () => {
  it("says Today and Yesterday, otherwise a date", () => {
    expect(formatWhen(at(2026, 11, 18, 1), NOW)).toBe("Today");
    expect(formatWhen(at(2026, 11, 17, 23), NOW)).toBe("Yesterday");
    expect(formatWhen(at(2026, 11, 3), NOW)).not.toMatch(/Today|Yesterday/);
  });
});

describe("filterHistory", () => {
  const rows: HistoryRow[] = [
    { item: item("1", "Darling", "DVRST"), playedAt: 3, approx: false, origin: "local", when: "" },
    { item: item("2", "Beyoncé Song", "Beyoncé"), playedAt: 2, approx: true, origin: "account", when: "" },
    { item: item("3", "Falling Stars", "DVRST"), playedAt: 1, approx: false, origin: "both", when: "" },
  ];
  const base = { source: "both" as const, title: "", artist: "", direction: "desc" as const };

  it("filters by source: both counts as either", () => {
    expect(filterHistory(rows, { ...base, source: "local" }).map((r) => r.item.id)).toEqual(["1", "3"]);
    expect(filterHistory(rows, { ...base, source: "account" }).map((r) => r.item.id)).toEqual(["2", "3"]);
    expect(filterHistory(rows, base)).toHaveLength(3);
  });
  it("filters by title and by artist, ignoring case and accents", () => {
    expect(filterHistory(rows, { ...base, title: "FALL" }).map((r) => r.item.id)).toEqual(["3"]);
    expect(filterHistory(rows, { ...base, artist: "beyonce" }).map((r) => r.item.id)).toEqual(["2"]);
    expect(filterHistory(rows, { ...base, artist: "dvrst", title: "dar" }).map((r) => r.item.id)).toEqual(["1"]);
  });
  it("sorts oldest first without changing what is shown", () => {
    expect(filterHistory(rows, { ...base, direction: "asc" }).map((r) => r.item.id)).toEqual(["3", "2", "1"]);
  });
});
