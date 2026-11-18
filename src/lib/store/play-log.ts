import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Thumbnail } from "@/lib/innertube/types";
import { dropLegacyLocalStorageKey, safeIdbStorage } from "./idb-storage";

/**
 * What was played on THIS device, with exact times. The account history
 * YouTube keeps has no timestamps and shows only what was reported to the
 * account; this is the app's own record, so the History page can show
 * "this device only" and place plays that never reached the account.
 *
 * Usage-driven and growing, so it lives in IndexedDB (see `idb-storage`)
 * and is capped.
 */

/** Newest entries kept. Matches the History page's own limit. */
export const PLAY_LOG_LIMIT = 1000;

export type PlayLogEntry = {
  id: string;
  title: string;
  artists?: { id?: string; name: string }[];
  album?: string;
  albumId?: string;
  duration?: number;
  thumbnails: Thumbnail[];
  /** Unix ms when the play started. */
  playedAt: number;
};

type PlayLogState = {
  /** Newest first. */
  entries: PlayLogEntry[];
  record: (entry: PlayLogEntry) => void;
  clear: () => void;
};

/** Two thumbnails (smallest and largest) are enough to draw a row and keep
 *  a thousand entries small. */
export function slimThumbnails(thumbs: Thumbnail[]): Thumbnail[] {
  if (thumbs.length <= 2) return thumbs;
  const sorted = [...thumbs].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  return [sorted[0], sorted[sorted.length - 1]];
}

export const usePlayLog = create<PlayLogState>()(
  persist(
    (set) => ({
      entries: [],
      record: (entry) =>
        set((s) => ({
          entries: [
            { ...entry, thumbnails: slimThumbnails(entry.thumbnails) },
            ...s.entries,
          ].slice(0, PLAY_LOG_LIMIT),
        })),
      clear: () => set({ entries: [] }),
    }),
    {
      name: "ytm-play-log",
      storage: createJSONStorage(() => safeIdbStorage),
      version: 1,
    },
  ),
);

dropLegacyLocalStorageKey("ytm-play-log");
