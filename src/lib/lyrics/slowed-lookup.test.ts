import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-http", () => ({ fetch: vi.fn() }));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("0.0.0"),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const YAML = `version: "1.0"
lines:
  - text: hello there
    start_ms: 10000
    end_ms: 14000
    words:
      - text: "hello "
        start_ms: 10000
      - text: there
        start_ms: 12000
`;

const ORIGINAL = {
  trackName: "Darling",
  artistName: "DVRST",
  duration: 100,
  lyricsfile: YAML,
  syncedLyrics: null,
  plainLyrics: null,
};
// Same song, but a record whose length is nowhere near a slowdown.
const LONG_VERSION = { ...ORIGINAL, duration: 300 };

async function setup(records: unknown[]) {
  const http = await import("@tauri-apps/plugin-http");
  vi.mocked(http.fetch).mockReset();
  vi.mocked(http.fetch).mockImplementation(() =>
    Promise.resolve(json(records)),
  );
  return await import("./slowed");
}

describe("fetchSlowedLyrics", () => {
  beforeEach(() => vi.resetModules());

  it("finds the original and scales its word timings", async () => {
    const { fetchSlowedLyrics } = await setup([LONG_VERSION, ORIGINAL]);
    const r = await fetchSlowedLyrics({
      title: "Darling (Slowed + Reverb)",
      artist: "DVRST",
      artists: ["DVRST"],
      duration: 125,
    });
    expect(r?.kind).toBe("timed");
    if (r?.kind !== "timed") return;
    expect(r.adjusted?.ratio).toBeCloseTo(0.8);
    // 10 s of the original is 12.5 s of the slowed track.
    expect(r.lines[0].start).toBeCloseTo(12.5);
    expect(r.lines[0].words?.[1].start).toBeCloseTo(15);
  });

  it("returns null when no record fits the slowdown window", async () => {
    const { fetchSlowedLyrics } = await setup([LONG_VERSION]);
    expect(
      await fetchSlowedLyrics({
        title: "Darling (Slowed + Reverb)",
        artist: "DVRST",
        duration: 125,
      }),
    ).toBeNull();
  });

  it("does nothing for a title that is not a slowed upload", async () => {
    const { fetchSlowedLyrics } = await setup([ORIGINAL]);
    expect(
      await fetchSlowedLyrics({ title: "Darling", artist: "DVRST", duration: 125 }),
    ).toBeNull();
  });
});

describe("fetchSlowedLyrics on re-uploads (artist in the title)", () => {
  beforeEach(() => vi.resetModules());

  /** Answers only a search whose track_name is exactly `title`, like LRCLIB
   *  does for a title that matches nothing else. */
  async function setupRouted(title: string, records: unknown[]) {
    const http = await import("@tauri-apps/plugin-http");
    vi.mocked(http.fetch).mockReset();
    vi.mocked(http.fetch).mockImplementation((input: unknown) => {
      const u = new URL(String(input));
      const name = u.searchParams.get("track_name")?.toLowerCase();
      return Promise.resolve(json(name === title ? records : []));
    });
    return await import("./slowed");
  }

  it("finds Autumn Wind under the artist in the title, not the channel", async () => {
    const lrc = "[00:10.00] first\n[01:00.00] second";
    const { fetchSlowedLyrics } = await setupRouted("autumn wind", [
      { trackName: "Autumn Wind", artistName: "DVRST", duration: 265, syncedLyrics: lrc },
      { trackName: "Autumn Wind", artistName: "DVRST", duration: 129, syncedLyrics: lrc },
      { trackName: "Autumn Wind", artistName: "DVRST", duration: 0, syncedLyrics: lrc },
    ]);
    const r = await fetchSlowedLyrics({
      title: "DVRST - Autumn Wind (slowed + reverb)",
      artist: "TheGoldenYami",
      artists: ["TheGoldenYami"],
      duration: 147,
    });
    expect(r?.kind).toBe("timed");
    if (r?.kind !== "timed") return;
    expect(r.adjusted?.ratio).toBeCloseTo(129 / 147, 3);
    expect(r.lines[0].start).toBeCloseTo(10 * (147 / 129), 2);
  });

  it("finds Darling when the title holds both artists and the record title does too", async () => {
    const { fetchSlowedLyrics } = await setupRouted("darling", [
      {
        trackName: "DVRST, monrxe - Darling",
        artistName: "DVRST",
        duration: 218,
        lyricsfile: YAML,
      },
    ]);
    const r = await fetchSlowedLyrics({
      title: "dvrst, monrxe - darling (slowed + reverb)",
      artist: "dawn",
      artists: ["dawn"],
      duration: 242,
    });
    expect(r?.kind).toBe("timed");
    if (r?.kind !== "timed") return;
    expect(r.adjusted?.ratio).toBeCloseTo(218 / 242, 3);
    expect(r.lines[0].words?.length).toBe(2);
  });

  it("finds Falling Stars with two artists in the title", async () => {
    const { fetchSlowedLyrics } = await setupRouted("falling stars", [
      { trackName: "Falling Stars", artistName: "DVRST", duration: 154, lyricsfile: YAML },
    ]);
    const r = await fetchSlowedLyrics({
      title: "DVRST, polnalyubvi - Falling Stars (slowed + reverb)",
      artist: "TheGoldenYami",
      artists: ["TheGoldenYami"],
      duration: 197,
    });
    expect(r?.kind).toBe("timed");
  });
});
