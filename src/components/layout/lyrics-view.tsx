import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { IconMicrophoneFilled } from "@tabler/icons-react";
import { playerIconButton } from "@/components/layout/player-chrome";
import { LyricsReloadButton } from "@/components/layout/lyrics-reload-button";
import {
  resolveActiveSource,
  type LyricsOverride,
} from "@/lib/lyrics/active-source";
// Fork note: IconCheck from upstream's menu restyle is omitted for now —
// this port keeps fork's lyrics on/off toggle + radio group. It will return
// with the shared menu-chrome port (869f271). RotateCw/MicVocal (Lucide)
// were replaced by Tabler IconRefresh/IconMicrophoneFilled in this port.
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  POP_REST_S,
  popTransform,
  popStrength,
} from "@/lib/lyrics/bounce";
import {
  hasWordSync,
  type Lyrics,
  type TimedLine,
  type TimedWord,
} from "@/lib/lyrics/types";
import {
  SOURCE_LABELS,
  SOURCE_ORDER,
  useLyricsSources,
  type LyricsSource,
} from "@/lib/lyrics/sources";
import { usePlaybackStore } from "@/lib/store/playback";
import type { QueueTrack } from "@/lib/store/playback";
import { useScrubStore } from "@/lib/store/scrub";
import {
  useSettingsStore,
  type LyricsWordStyle,
} from "@/lib/store/settings";
import { cn } from "@/lib/utils";

const PREF_KEY = "ytm:lyrics-source";

type Pref = LyricsSource | "auto";
/** "none" means the source answered and has nothing. "error" means it never
 *  answered. Keeping them apart is the whole point of the provider change:
 *  an unreachable source must stay selectable so the user can retry it. */
type Availability = "words" | "lrc" | "plain" | "loading" | "none" | "error";

function loadPref(): Pref {
  try {
    const v = localStorage.getItem(PREF_KEY);
    if (v === "auto") return "auto";
    // Checked against SOURCE_ORDER rather than a hardcoded list of names.
    // The list version silently dropped any source added later: pinning
    // one and restarting reverted you to "auto" with no explanation.
    if (v && (SOURCE_ORDER as string[]).includes(v)) return v as Pref;
  } catch {
    /* noop */
  }
  return "auto";
}

function savePref(p: Pref) {
  try {
    localStorage.setItem(PREF_KEY, p);
  } catch {
    /* noop */
  }
}

export type LyricsViewState = {
  active: Lyrics | null;
  isLoading: boolean;
  hasTrack: boolean;
  pref: Pref;
  setPref: (p: Pref) => void;
  best: LyricsSource | null;
  availability: Record<LyricsSource, Availability>;
  /** Master on/off, mirrored from the persisted `ytm-settings` store —
   *  shared across the side card and the floating window. */
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  /** Sources that failed to answer at all. */
  failed: LyricsSource[];
  /** Re-fetch this track's lyrics from LRCLIB and show them. Sources that
   *  failed to answer are retried alongside. */
  reload: () => void;
  /** A reload is in flight. */
  reloading: boolean;
  /** Counts finished reloads that brought new lyrics, so the panel can play
   *  its entrance animation for exactly those. */
  reloadCount: number;
};

/** One line saying what went wrong, including the underlying cause that a
 *  transport error carries, so a failed reload is diagnosable on screen. */
function describeError(e: unknown): string {
  if (!(e instanceof Error)) return String(e);
  const cause = (e as { cause?: unknown }).cause;
  const why =
    cause instanceof Error
      ? cause.message
      : typeof cause === "string"
        ? cause
        : "";
  return why ? `${e.message} (${why})` : e.message;
}

/** The reload spins at least this long, so a fast answer still reads as a
 *  deliberate action and the entrance does not flash in under the spinner. */
const MIN_RELOAD_MS = 650;

/**
 * Drives the inline lyrics panel: fires queries to all three sources,
 * tracks the user's source preference, and exposes a render-ready
 * state. Auto-pick rule: any timed source > any plain source, ordered
 * by `SOURCE_ORDER`.
 *
 * Used by the player bar to render `<LyricsBody>` (the flowing area)
 * and `<LyricsSourceButton>` (the mic-icon dropdown) from the same
 * state — without running the underlying queries twice.
 *
 * When the user has turned lyrics off, `enabled` gates the underlying
 * `useLyricsSources` queries so the three network fetches don't fire
 * at all, and `LyricsBody` skips rendering `<TimedLyrics>` — which is
 * what actually stops its `requestAnimationFrame` auto-scroll loop and
 * high-frequency playback-position subscription.
 */
export function useLyricsView(track: QueueTrack | undefined): LyricsViewState {
  const [pref, setPrefState] = useState<Pref>(loadPref);
  // Set by "Reload lyrics": pins this track to the LRCLIB copy it just
  // fetched. Dropped when the user picks a source themselves.
  const [override, setOverride] = useState<LyricsOverride | null>(null);
  const setPref = (p: Pref) => {
    setOverride(null);
    setPrefState(p);
    savePref(p);
  };

  const enabled = useSettingsStore((s) => s.lyricsEnabled);
  const setEnabled = useSettingsStore((s) => s.setLyricsEnabled);

  const { queries, best, isLoading, failed } = useLyricsSources(
    track,
    !!track && enabled,
  );

  const availability = useMemo(() => {
    const acc = {} as Record<LyricsSource, Availability>;
    for (const s of SOURCE_ORDER) {
      const q = queries[s];
      acc[s] = q.data
        ? q.data.kind === "timed"
          ? hasWordSync(q.data)
            ? "words"
            : "lrc"
          : "plain"
        : q.isLoading
          ? "loading"
          : q.isError
            ? "error"
            : "none";
    }
    return acc;
  }, [queries]);

  const activeSource = resolveActiveSource({
    pref,
    best,
    override,
    videoId: track?.videoId,
    hasLyrics: (s) => !!queries[s].data,
  });
  const active = activeSource ? (queries[activeSource].data ?? null) : null;

  const [reloading, setReloading] = useState(false);
  const [reloadCount, setReloadCount] = useState(0);
  const reloadingRef = useRef(false);
  const trackIdRef = useRef(track?.videoId);
  useEffect(() => {
    trackIdRef.current = track?.videoId;
  }, [track?.videoId]);
  const refetchLrclib = queries.lrclib.refetch;

  const reload = useCallback(async () => {
    const videoId = track?.videoId;
    if (!videoId || reloadingRef.current) return;
    reloadingRef.current = true;
    setReloading(true);
    console.info(
      `[lyrics] reload requested for "${track?.title}" (${videoId});`,
      `failed sources: ${failed.join(", ") || "none"}`,
    );
    try {
      // `refetch` always goes to the network, whatever the cache holds. A
      // source that failed to answer is tried again in the same go, which
      // is what the old "Try again" button did. The minimum delay only
      // keeps a fast answer from flickering.
      const retryOthers = failed
        .filter((s) => s !== "lrclib")
        .map((s) => queries[s].refetch());
      const [result] = await Promise.all([
        refetchLrclib(),
        new Promise((r) => setTimeout(r, MIN_RELOAD_MS)),
        ...retryOthers,
      ]);
      // The track changed while this was in flight: the answer belongs to
      // the old one, so show nothing and say nothing.
      if (trackIdRef.current !== videoId) return;
      console.info(
        "[lyrics] reload finished:",
        result.isError
          ? "error"
          : result.data
            ? `${result.data.kind} lyrics${hasWordSync(result.data) ? " (word synced)" : ""}`
            : "no lyrics",
      );
      if (result.isError) {
        console.error("[lyrics] LRCLIB reload failed:", result.error);
        toast.error("Couldn't reach LRCLIB", {
          description: describeError(result.error),
        });
      } else if (!result.data) {
        toast.info("LRCLIB has no lyrics for this track");
      } else {
        setOverride({ videoId, source: "lrclib" });
        setReloadCount((n) => n + 1);
      }
    } finally {
      reloadingRef.current = false;
      setReloading(false);
    }
  }, [track?.videoId, track?.title, refetchLrclib, failed, queries]);

  return {
    active,
    isLoading,
    hasTrack: !!track,
    pref,
    setPref,
    best,
    availability,
    enabled,
    setEnabled,
    failed,
    reload: () => void reload(),
    reloading,
    reloadCount,
  };
}

export function LyricsBody({
  state,
  large = false,
}: {
  state: LyricsViewState;
  /** Full-screen sizing: bigger type, same motion. */
  large?: boolean;
}) {
  if (!state.hasTrack) return null;
  if (!state.enabled) return null;
  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col">
      {/* A fresh key per finished reload remounts the column, which both
          restarts its scroll position on the active line and replays the
          entrance. While a reload is running the old lyrics step back.
          Opacity and a translate only: both stay on the compositor, and
          the animation (and its layer) ends with the transition. */}
      <motion.div
        key={state.reloadCount}
        className="flex h-full min-h-0 flex-1 flex-col"
        initial={state.reloadCount > 0 ? { opacity: 0, y: 18 } : false}
        animate={{ opacity: state.reloading ? 0.4 : 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
      >
        <LyricsContent state={state} large={large} />
      </motion.div>
      <LyricsReloadButton reloading={state.reloading} onReload={state.reload} />
      {state.active?.kind === "timed" && state.active.adjusted ? (
        <div
          className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-black/40 px-2.5 py-1 text-[11px] text-muted-foreground backdrop-blur-sm"
          title={`Timings scaled from "${state.active.adjusted.from}" (speed ${state.active.adjusted.ratio.toFixed(2)}x). Only accurate for full slowed versions.`}
        >
          Adjusted from original · Beta
        </div>
      ) : null}
    </div>
  );
}

function LyricsContent({
  state,
  large,
}: {
  state: LyricsViewState;
  large: boolean;
}) {
  if (state.isLoading && !state.active) {
    return (
      <p className="px-4 py-2 text-sm text-muted-foreground">Loading lyrics…</p>
    );
  }
  if (!state.active) {
    // A source that never answered is not a track without lyrics. Say which
    // it was, rather than the flat "No lyrics found." that used to cover
    // both and then sat in the disk cache for 24h. The reload button in the
    // corner is the way to try again.
    if (state.failed.length > 0) {
      return (
        <p className="px-4 py-2 text-sm text-muted-foreground">
          Couldn&apos;t reach{" "}
          {state.failed.map((s) => SOURCE_LABELS[s]).join(", ")}. Use the reload
          button to try again.
        </p>
      );
    }
    return (
      <p className="px-4 py-2 text-sm text-muted-foreground">
        No lyrics found.
      </p>
    );
  }
  if (state.active.kind === "timed") {
    return <TimedLyrics lines={state.active.lines} large={large} />;
  }
  return <PlainLyrics text={state.active.text} large={large} />;
}

/** How long before a line's actual start time we flip it to active.
 *  At this moment the previous line's CSS transition begins fading it
 *  out and the new line's transition begins fading it in. The
 *  `duration-*` value on the line element controls how long that
 *  cross-fade takes — set a touch longer than the lookahead so the
 *  handoff feels smooth rather than crisp. */
const ACTIVE_LOOKAHEAD_S = 0.72;

function findActiveIdx(lines: TimedLine[], position: number): number {
  let active = -1;
  for (let i = 0; i < lines.length; i++) {
    const start = lines[i].start - ACTIVE_LOOKAHEAD_S;
    if (start > position) break;
    const nextStart = lines[i + 1]?.start;
    const end =
      nextStart !== undefined
        ? nextStart - ACTIVE_LOOKAHEAD_S
        : (lines[i].end ?? Infinity);
    if (position < end) {
      active = i;
      break;
    }
    active = i;
  }
  return active;
}

/** How far from the top of the viewport the active line should sit,
 *  as a fraction of the visible height. 0.5 = perfectly centered;
 *  smaller pushes the active line up and reveals more upcoming text. */
const ACTIVE_LINE_VIEWPORT_RATIO = 0.36;

/** Duration of the auto-scroll that re-centers the active line.
 *  Native `scrollTo({ behavior: "smooth" })` is non-configurable in
 *  Chromium (~300 ms regardless of distance), which feels jumpy on
 *  long jumps — we drive the scroll ourselves with rAF instead. */
const SCROLL_DURATION_MS = 720;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Sampler for a CSS-style `cubic-bezier(x1, y1, x2, y2)`, so a scroll we
 *  drive from rAF can share a curve with the CSS transitions running
 *  beside it. Bisection on the x axis: 20 steps resolve the parameter far
 *  finer than a pixel of scroll, and the whole thing runs a few hundred
 *  times per seek, which is nothing. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const axis = (a: number, b: number, s: number) =>
    3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let s = t;
    for (let i = 0; i < 20; i++) {
      s = (lo + hi) / 2;
      if (axis(x1, x2, s) < t) lo = s;
      else hi = s;
    }
    return axis(y1, y2, s);
  };
}

/** Seek curve: hard start, long decelerating tail (the one iOS uses for
 *  sheet transitions). Keep in sync with the `[data-lyrics-seek]` rule in
 *  index.css so the scroll and the line highlight decelerate together. */
const easeOutSeek = cubicBezier(0.32, 0.72, 0, 1);

/** A position change bigger than this is a seek, not playback. The audio
 *  engine pushes the playhead a few times a second, so anything past a
 *  second means it was moved: the progress slider, a click on a line,
 *  media keys, the floating player. */
const SEEK_JUMP_S = 1.2;

/** Auto-scroll duration for a seek. Short enough that dragging the slider
 *  feels like the text is attached to the thumb, long enough to read as
 *  motion rather than a cut. Each new drag step interrupts the previous
 *  animation from wherever it got to, the same way a re-triggered CSS
 *  transition would. */
const SEEK_SCROLL_DURATION_MS = 350;

function TimedLyrics({
  lines,
  large = false,
}: {
  lines: TimedLine[];
  large?: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const seekHoldRef = useRef<number | null>(null);
  const playbackPosition = usePlaybackStore((s) => s.position);
  const seek = usePlaybackStore((s) => s.seek);
  // While the slider is being dragged the store's position still follows
  // the audio element, since the seek lands on release. Preview the drag
  // target so the text tracks the thumb the whole way.
  const scrub = useScrubStore((s) => s.scrub);
  const position = scrub ?? playbackPosition;

  const activeIdx = findActiveIdx(lines, position);
  const prevActiveRef = useRef(activeIdx);
  const prevPositionRef = useRef(position);

  // On mount and whenever the lyric set changes (new track), snap the
  // active line into view without animation. Without this the animated
  // effect below never fires on mount (prevActiveRef starts equal to the
  // initial activeIdx), so opening the panel mid-song — or skipping tracks
  // while it stays mounted — leaves the active line off-screen / stale.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const idx = findActiveIdx(
      lines,
      useScrubStore.getState().scrub ?? usePlaybackStore.getState().position,
    );
    prevActiveRef.current = idx;
    if (idx < 0) {
      container.scrollTop = 0;
      return;
    }
    const el = container.querySelector<HTMLElement>(`[data-line-idx="${idx}"]`);
    if (!el) {
      container.scrollTop = 0;
      return;
    }
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const elTopWithinContent = eRect.top - cRect.top + container.scrollTop;
    const target =
      idx === 0
        ? 0
        : container.clientHeight * ACTIVE_LINE_VIEWPORT_RATIO -
          el.clientHeight / 2;
    container.scrollTop = Math.max(0, elTopWithinContent - target);
  }, [lines]);

  // A layout effect, not a passive one: on a seek the container has to be
  // repositioned and the line cross-fade suppressed *before* the browser
  // paints the frame that already carries the new active line.
  useLayoutEffect(() => {
    const previous = prevPositionRef.current;
    prevPositionRef.current = position;
    // Dragging the slider is a continuous seek, so every step of it
    // counts however small: the thumb can crawl a line at a time.
    const isSeek =
      scrub !== null || Math.abs(position - previous) > SEEK_JUMP_S;

    if (activeIdx === prevActiveRef.current) return;
    prevActiveRef.current = activeIdx;
    if (activeIdx < 0) return;
    const container = scrollRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(
      `[data-line-idx="${activeIdx}"]`,
    );
    if (!el) return;
    // Position the active line above center so more upcoming lines stay
    // visible. getBoundingClientRect avoids depending on offsetParent.
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    const elTopWithinContent = eRect.top - cRect.top + container.scrollTop;
    // The very first line is treated as a special case: we pin it to
    // the top of the viewport instead of the usual ~36% position. For
    // any later line, the active-line-above-center rule applies.
    const target =
      activeIdx === 0
        ? 0
        : container.clientHeight * ACTIVE_LINE_VIEWPORT_RATIO -
          el.clientHeight / 2;
    const targetTop = Math.max(0, elTopWithinContent - target);

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;

    if (isSeek) {
      // `data-lyrics-seek` shortens the per-line color/scale transition to
      // match the scroll (see index.css). Set from a layout effect, so it
      // is in place before the browser styles the frame that already
      // carries the new active line — the slow 1.26s cross-fade never gets
      // a chance to start. Held for the length of the scroll rather than
      // cleared next frame: a running transition keeps its original
      // timing, but the next drag step must find the attribute still on.
      container.dataset.lyricsSeek = "true";
      if (seekHoldRef.current !== null) clearTimeout(seekHoldRef.current);
      seekHoldRef.current = window.setTimeout(() => {
        seekHoldRef.current = null;
        delete container.dataset.lyricsSeek;
      }, SEEK_SCROLL_DURATION_MS);
    }

    const startTop = container.scrollTop;
    const delta = targetTop - startTop;
    if (Math.abs(delta) < 1) return;

    // Seeking gets the short decelerating curve; playback keeps the long
    // symmetric glide.
    const duration = isSeek ? SEEK_SCROLL_DURATION_MS : SCROLL_DURATION_MS;
    const ease = isSeek ? easeOutSeek : easeInOutCubic;
    const startTs = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startTs) / duration);
      container.scrollTop = startTop + delta * ease(t);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        rafRef.current = null;
      }
    };
    rafRef.current = requestAnimationFrame(step);
    // `position` is a dependency even though only `activeIdx` moves the
    // scroll: the seek check has to see every tick, otherwise a jump that
    // lands inside the current line would sit in the ref and snap the
    // *next*, perfectly ordinary line change.
  }, [activeIdx, position, scrub]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (seekHoldRef.current !== null) clearTimeout(seekHoldRef.current);
    };
  }, []);

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        className={cn(
          // The right inset is the room the active line's `scale-[1.06]`
          // needs. Text wraps against the layout box, but the scale is a
          // paint-time transform anchored at `origin-left`, so the active
          // line paints 6% wider than the box it wrapped inside and the
          // tail of the top row fell outside the column (`overflow-y-auto`
          // clips the x axis too). Reserving the overhang here rather than
          // on the active line alone keeps every line wrapping at the same
          // width, so nothing reflows at the moment a line lights up.
          // Percentage, not a fixed inset: the player card is resizable.
          "lyrics-no-scrollbar flex h-full flex-col gap-1 overflow-y-auto pl-1 pr-[6%] pt-0 pb-16",
          // The top fade kicks in only after the karaoke has moved past
          // the first line — that way the first line stays crisp at the
          // top of the column while the song hasn't started or is on
          // line 0. The bottom fade is on throughout: the column runs
          // past the panel edge from the very first line, and without it
          // the last row is sliced through mid-glyph.
          activeIdx >= 1 ? "lyrics-mask" : "lyrics-mask-bottom",
        )}
      >
        {lines.map((line, i) => {
          const isActive = i === activeIdx;
          // A word-synced line is handed over to the next one
          // ACTIVE_LOOKAHEAD_S before that one starts, which is earlier
          // than the last words of a fast line are sung. Cutting the
          // highlight there made the tail of the line vanish at once, so
          // such a line stays lit until its own last word is done.
          const lastWord = line.words?.[line.words.length - 1];
          const finishing =
            !isActive &&
            i < activeIdx &&
            !!lastWord &&
            position >= line.start &&
            position < lastWord.end + WORD_TAIL_S;
          const lit = isActive || finishing;
          const isPast = i < activeIdx && !lit;
          return (
            <button
              key={i}
              type="button"
              data-line-idx={i}
              onClick={() => seek(line.start)}
              className={cn(
                // Same font-size on every line so the active line can't
                // grow into a second row and shove neighbours around.
                // The "active is bigger" feel comes from a transform
                // scale (off the layout flow) plus weight + glow.
                //
                // Cross-fade duration is a touch longer than
                // `ACTIVE_LOOKAHEAD_S` (800 ms) so the highlight is
                // well past the midpoint by the time the new line
                // actually starts, but still feels deliberate rather
                // than abrupt. ease-in-out softens both ends.
                // `scale` lives on its own CSS property in Tailwind v4
                // (not `transform`), so it's listed explicitly in the
                // transition. Both branches set a `scale-*` so the
                // browser has a defined start AND end to interpolate.
                "lyrics-line origin-left cursor-pointer rounded-md px-2 py-1 text-left font-[650] leading-snug transition-[scale,color] duration-[1260ms] ease-in-out hover:bg-black/10 dark:hover:bg-black/30",
                large
                  ? "px-3 py-3.5 text-[31px] font-bold leading-[1.18] tracking-[-0.025em]"
                  : "text-lg",
                lit
                  ? "scale-[1.06] text-foreground"
                  : isPast
                    ? "scale-100 text-muted-foreground/40"
                    : "scale-100 text-muted-foreground/70",
              )}
            >
              {lit && line.words?.length ? (
                <WordLine words={line.words} />
              ) : (
                line.text || "♪"
              )}
            </button>
          );
        })}
      </div>
      {/* Static blur overlay — sits over the top of the lyrics column
          and applies `backdrop-filter` to whatever is visually behind
          it. Lines passing through the strip appear blurred, but the
          blur travels with the viewport, not the content — so when the
          user manually scrolls up to find an earlier line, that line
          becomes clear as it leaves the blurred strip.
          When the very first line is active it sits at viewport top
          (no above-center offset), so we fade the overlay out to keep
          the first line crisp. */}
      <div
        aria-hidden
        className="lyrics-blur-overlay pointer-events-none absolute inset-x-0 top-0 h-[26%] transition-opacity duration-500 ease-in-out"
        style={{ opacity: activeIdx <= 0 ? 0 : 1 }}
      />
      {/* The bottom edge softens the same way as the top, so upcoming
          lines dissolve out of the column instead of stopping on a
          line. */}
      <div
        aria-hidden
        className="lyrics-blur-overlay-bottom pointer-events-none absolute inset-x-0 bottom-0 h-[26%]"
      />
    </div>
  );
}

/**
 * The active line of word-synced lyrics.
 *
 * Every word is drawn twice: a dim base, and a lit copy on top whose mask
 * edge sweeps across it as the word is sung (`--p` goes 0 to 1, see
 * `.lyrics-word-fill` in index.css). Progress is written straight to the
 * DOM from a rAF loop instead of through React state, so the ~10-20 words
 * of a line cost no re-renders.
 *
 * The playback store only reports the position a few times a second
 * (`timeupdate`), far too coarse for a word that lasts 200 ms. Between
 * reports the position is extrapolated from the last one, capped so a
 * stalled stream cannot run the highlight away.
 */
const EXTRAPOLATE_CAP_S = 0.6;

/** How long a finished word-synced line stays in its lit state, so the last
 *  word is seen filling before the line steps back. */
const WORD_TAIL_S = 0.15;

function WordLine({ words }: { words: TimedWord[] }) {
  const mode = useSettingsStore((s) => s.lyricsWordStyle);
  const glow = useSettingsStore((s) => s.lyricsGlow);
  const fills = useRef<(HTMLSpanElement | null)[]>([]);
  const wraps = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    const anchor = {
      pos: useScrubStore.getState().scrub ?? usePlaybackStore.getState().position,
      ts: performance.now(),
    };
    const reanchor = () => {
      anchor.pos =
        useScrubStore.getState().scrub ?? usePlaybackStore.getState().position;
      anchor.ts = performance.now();
    };
    const unsubPlayback = usePlaybackStore.subscribe((s, prev) => {
      if (s.position !== prev.position || s.playing !== prev.playing) {
        reanchor();
      }
    });
    const unsubScrub = useScrubStore.subscribe(reanchor);

    const last: (number | string)[] = [];
    let raf = 0;
    const tick = () => {
      const scrub = useScrubStore.getState().scrub;
      let t = anchor.pos;
      if (scrub === null && usePlaybackStore.getState().playing) {
        t += Math.min((performance.now() - anchor.ts) / 1000, EXTRAPOLATE_CAP_S);
      }
      for (let i = 0; i < words.length; i++) {
        const el = fills.current[i];
        if (!el) continue;
        const w = words[i];
        if (mode === "bounce") {
          // Snap on at the word's start and pop; no sweep.
          const age = t - w.start;
          const on = age >= 0 ? 1 : 0;
          const tf =
            age >= 0 && age < POP_REST_S
              ? popTransform(age, popStrength(w.end - w.start))
              : "";
          const key = `${on}|${tf}`;
          if (last[i] === key) continue;
          last[i] = key;
          el.style.opacity = String(on);
          const wrap = wraps.current[i];
          if (wrap) wrap.style.transform = tf;
          continue;
        }
        const span = Math.max(w.end - w.start, 0.05);
        const p = Math.min(1, Math.max(0, (t - w.start) / span));
        // Skip untouched words (before or after the one being sung).
        if (last[i] === p) continue;
        last[i] = p;
        el.style.setProperty("--p", p.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      unsubPlayback();
      unsubScrub();
    };
  }, [words, mode]);

  return (
    <>
      {words.map((w, i) => {
        const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(w.text);
        const lead = m?.[1] ?? "";
        const core = m?.[2] ?? w.text;
        const trail = m?.[3] ?? "";
        return (
          <Fragment key={i}>
            {lead}
            {core ? (
              <span
                className="relative inline-block whitespace-nowrap"
                ref={(el) => {
                  wraps.current[i] = el;
                }}
                style={{ transformOrigin: "50% 85%" }}
              >
                <span className="opacity-40">{core}</span>
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-0",
                    mode === "bounce" ? "lyrics-word-snap" : "lyrics-word-fill",
                    glow && "lyrics-glow",
                  )}
                  ref={(el) => {
                    fills.current[i] = el;
                  }}
                  style={
                    mode === "bounce"
                      ? { opacity: 0 }
                      : ({ "--p": 0 } as React.CSSProperties)
                  }
                >
                  {core}
                </span>
              </span>
            ) : null}
            {trail}
          </Fragment>
        );
      })}
    </>
  );
}

function PlainLyrics({
  text,
  large = false,
}: {
  text: string;
  large?: boolean;
}) {
  return (
    <div
      className={cn(
        "lyrics-mask app-scroll h-full overflow-y-auto whitespace-pre-wrap px-2 pt-0 pb-12 font-medium leading-relaxed text-foreground/90",
        large ? "text-[26px] leading-normal" : "text-lg",
      )}
    >
      {text}
    </div>
  );
}

export function LyricsSourceButton({
  state,
  className,
}: {
  state: LyricsViewState;
  className?: string;
}) {
  const { pref, setPref, best, availability, enabled, setEnabled } = state;
  const wordStyle = useSettingsStore((s) => s.lyricsWordStyle);
  const setWordStyle = useSettingsStore((s) => s.setLyricsWordStyle);
  const glow = useSettingsStore((s) => s.lyricsGlow);
  const setGlow = useSettingsStore((s) => s.setLyricsGlow);

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Lyrics source"
              className={cn(playerIconButton, className)}
            >
              <IconMicrophoneFilled />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Lyrics source</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuCheckboxItem
          checked={enabled}
          onCheckedChange={setEnabled}
          onSelect={(e) => e.preventDefault()}
        >
          Show lyrics
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {/* `inset` lines the label up with the `pl-8` the checkbox item
            above and the radio items below all reserve for their
            indicator, so every row in this menu starts its text at the
            same left edge instead of three different ones. */}
        <DropdownMenuLabel inset>Lyrics source</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={pref}
          onValueChange={(v) => setPref(v as Pref)}
        >
          <DropdownMenuRadioItem value="auto" disabled={!enabled}>
            <span className="flex-1">
              Auto
              {best ? (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({SOURCE_LABELS[best]})
                </span>
              ) : null}
            </span>
          </DropdownMenuRadioItem>
          <DropdownMenuSeparator />
          {SOURCE_ORDER.map((s) => {
            const a = availability[s];
            // The slowed-version source only exists for slowed uploads.
            if (s === "slowed" && a === "none" && pref !== "slowed") {
              return null;
            }
            const dot =
              a === "lrc" || a === "words"
                ? "bg-brand"
                : a === "plain"
                  ? "bg-muted-foreground/60"
                  : a === "loading"
                    ? "bg-muted-foreground/30 animate-pulse"
                    : a === "error"
                      ? "bg-destructive"
                      : "bg-transparent";
            return (
              <DropdownMenuRadioItem
                key={s}
                value={s}
                // Only a source that answered and had nothing is
                // unselectable. A failed one stays pickable: selecting it
                // is how the user asks for another attempt.
                disabled={!enabled || a === "none"}
              >
                <span className="flex-1">{SOURCE_LABELS[s]}</span>
                {s === "slowed" ? (
                  <span className="ml-2 rounded bg-brand/15 px-1 text-[10px] uppercase tracking-wide text-brand">
                    Beta
                  </span>
                ) : null}
                {a === "words" ? (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                    Words
                  </span>
                ) : null}
                <span
                  className={cn("ml-2 size-1.5 shrink-0 rounded-full", dot)}
                />
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel inset>Word animation</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={wordStyle}
          onValueChange={(v) => setWordStyle(v as LyricsWordStyle)}
        >
          <DropdownMenuRadioItem value="flow" disabled={!enabled}>
            Flow
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="bounce" disabled={!enabled}>
            Bounce
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuCheckboxItem
          checked={glow}
          disabled={!enabled}
          onCheckedChange={setGlow}
          onSelect={(e) => e.preventDefault()}
        >
          Glow
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
