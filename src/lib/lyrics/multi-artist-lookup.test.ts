import { describe, expect, it, vi } from "vitest";

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

const RECORD = {
  trackName: "DVRST, monrxe - Darling",
  artistName: "DVRST",
  duration: 218,
  syncedLyrics: "[00:08.50] DVRST\n[00:19.48] I flip a crumb to a brick",
};

describe("lookup for a multi-artist track", () => {
  it("retries with each artist and finds the record the joined credit misses", async () => {
    const calls: string[] = [];
    const http = await import("@tauri-apps/plugin-http");
    vi.mocked(http.fetch).mockReset();
    vi.mocked(http.fetch).mockImplementation((input: unknown) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/api/get")) return Promise.resolve(json({}, 404));
      const u = new URL(url);
      const artist = u.searchParams.get("artist_name");
      // The joined credit matches nothing; a single artist or free text does.
      if (artist === "DVRST, monrxe") return Promise.resolve(json([]));
      return Promise.resolve(json([RECORD]));
    });
    const { fetchLrclibLyrics } = await import("./lrclib");

    const res = await fetchLrclibLyrics({
      title: "Darling",
      artist: "DVRST, monrxe",
      artists: ["DVRST", "monrxe"],
      duration: 218,
    });

    expect(res).toMatchObject({ kind: "timed" });
    expect(calls.some((u) => u.includes("artist_name=DVRST&"))).toBe(true);
    expect(calls.some((u) => u.includes("q=Darling"))).toBe(true);
  });
});
