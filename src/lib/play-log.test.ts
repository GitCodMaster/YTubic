import { describe, expect, it } from "vitest";
import {
  PLAY_LOG_LIMIT,
  slimThumbnails,
  usePlayLog,
} from "@/lib/store/play-log";
import { playThreshold } from "@/lib/use-play-logger";

const entry = (id: string, playedAt: number) => ({
  id,
  title: id,
  thumbnails: [],
  playedAt,
});

describe("play log", () => {
  it("records newest first and clears", () => {
    usePlayLog.getState().clear();
    usePlayLog.getState().record(entry("a", 1));
    usePlayLog.getState().record(entry("b", 2));
    expect(usePlayLog.getState().entries.map((e) => e.id)).toEqual(["b", "a"]);
    usePlayLog.getState().clear();
    expect(usePlayLog.getState().entries).toEqual([]);
  });

  it("keeps only the newest PLAY_LOG_LIMIT entries", () => {
    usePlayLog.getState().clear();
    for (let i = 0; i < PLAY_LOG_LIMIT + 5; i++) {
      usePlayLog.getState().record(entry(`t${i}`, i));
    }
    const e = usePlayLog.getState().entries;
    expect(e).toHaveLength(PLAY_LOG_LIMIT);
    expect(e[0].id).toBe(`t${PLAY_LOG_LIMIT + 4}`);
    usePlayLog.getState().clear();
  });

  it("keeps the smallest and largest thumbnail only", () => {
    const t = [
      { url: "m", width: 120 },
      { url: "l", width: 544 },
      { url: "s", width: 60 },
    ];
    expect(slimThumbnails(t).map((x) => x.url)).toEqual(["s", "l"]);
    expect(slimThumbnails(t.slice(0, 1))).toHaveLength(1);
  });
});

describe("playThreshold", () => {
  it("is 20 s for normal tracks and half of a short one, never under 5 s", () => {
    expect(playThreshold(200)).toBe(20);
    expect(playThreshold(30)).toBe(15);
    expect(playThreshold(6)).toBe(5);
    expect(playThreshold(0)).toBe(20);
  });
});
