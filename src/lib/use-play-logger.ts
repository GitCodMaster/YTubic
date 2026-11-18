import { useEffect, useRef } from "react";
import { useShallow } from "zustand/react/shallow";
import { usePlaybackStore } from "@/lib/store/playback";
import { usePlayLog } from "@/lib/store/play-log";

/**
 * Records plays into the local play log. Mount once in the main window.
 *
 * A play counts once it has been actually listened to for a while, with
 * the same accumulate-while-playing approach the Last.fm scrobbler uses, so
 * skipping through a queue does not fill the log: the smaller of 20 s and
 * half the track's length (never under 5 s). The entry is stamped with
 * when the play STARTED.
 */

const LISTEN_SECONDS = 20;
const MIN_LISTEN_SECONDS = 5;

/** Seconds of listening that make a play of a track of this length count. */
export function playThreshold(durationSec: number): number {
  if (!(durationSec > 0)) return LISTEN_SECONDS;
  return Math.max(MIN_LISTEN_SECONDS, Math.min(LISTEN_SECONDS, durationSec / 2));
}

export function usePlayLogger(): void {
  const { videoId, index } = usePlaybackStore(
    useShallow((s) => ({
      videoId: s.index >= 0 ? s.queue[s.index]?.videoId : undefined,
      index: s.index,
    })),
  );

  const session = useRef({
    videoId: undefined as string | undefined,
    index: -1,
    startedAt: 0,
    listened: 0,
    logged: false,
  });

  // A new current track starts a fresh session.
  useEffect(() => {
    const s = session.current;
    s.videoId = videoId;
    s.index = index;
    s.startedAt = Date.now();
    s.listened = 0;
    s.logged = false;
  }, [videoId, index]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const p = usePlaybackStore.getState();
      if (!p.playing) return;
      const t = p.index >= 0 ? p.queue[p.index] : undefined;
      const s = session.current;
      // The store moved on before the effect above re-synced: skip a tick.
      if (!t || t.videoId !== s.videoId || p.index !== s.index) return;

      // Repeat-one: the slot jumped back to the start after a full listen,
      // so this is a new play.
      if (s.logged && p.position < 1.5 && s.listened > LISTEN_SECONDS) {
        s.startedAt = Date.now();
        s.listened = 0;
        s.logged = false;
        return;
      }

      s.listened += 1;
      if (s.logged) return;
      const duration = p.duration > 0 ? p.duration : (t.duration ?? 0);
      if (s.listened < playThreshold(duration)) return;
      s.logged = true;
      usePlayLog.getState().record({
        id: t.videoId,
        title: t.title,
        artists: t.artists,
        album: t.album,
        albumId: t.albumId,
        duration: duration > 0 ? Math.round(duration) : undefined,
        thumbnails: t.thumbnails,
        playedAt: s.startedAt,
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, []);
}
