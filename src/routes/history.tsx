import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  IconHistory,
  IconLoader2,
  IconRefresh,
  IconSortAscending,
  IconSortDescending,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented";
import { ErrorCard } from "@/components/shared/error-card";
import { TrackRowSkeletonList } from "@/components/shared/skeletons";
import { TrackList } from "@/components/shared/track-list";
import { authLoggedInQuery } from "@/lib/store/auth-queries";
import { usePlayLog } from "@/lib/store/play-log";
import { fetchHistoryPage, type HistoryPage } from "@/lib/innertube/history";
import {
  filterHistory,
  HISTORY_LIMIT,
  mergeHistory,
  type SortDirection,
  type SourceFilter,
} from "@/lib/history-merge";

export const Route = createFileRoute("/history")({
  component: HistoryPage,
});

/** Runaway guard: pages fetched at most, whatever the server returns. */
const MAX_PAGES = 100;

const HISTORY_QUERY_KEY = ["history", "account", "v1"] as const;

/**
 * The account's history, fetched page by page. Pages are followed
 * automatically until `HISTORY_LIMIT` plays are in, so the first page shows
 * at once and the rest fills in behind it; filters and search then work on
 * everything loaded so far.
 */
function useAccountHistory(enabled: boolean) {
  const query = useInfiniteQuery<
    HistoryPage,
    Error,
    { pages: HistoryPage[] },
    typeof HISTORY_QUERY_KEY,
    { token?: string; bucket: string } | undefined
  >({
    queryKey: HISTORY_QUERY_KEY,
    initialPageParam: undefined,
    queryFn: ({ pageParam }) =>
      fetchHistoryPage(pageParam?.token, pageParam?.bucket ?? ""),
    getNextPageParam: (last, all) => {
      if (!last.token) return undefined;
      // Rows that come back without a heading belong to the last one seen.
      let bucket = "";
      for (let i = all.length - 1; i >= 0 && !bucket; i--) {
        const e = all[i].entries;
        if (e.length) bucket = e[e.length - 1].bucket;
      }
      return { token: last.token, bucket };
    },
    enabled,
    // The list changes only when something is played; reopening the page
    // within the cache window should not re-walk every page. "Refresh"
    // resets it.
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: 1,
  });

  const entries = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p.entries),
    [query.data?.pages],
  );
  const pageCount = query.data?.pages.length ?? 0;

  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } =
    query;
  useEffect(() => {
    if (!enabled || !hasNextPage || isFetchingNextPage) return;
    if (isFetchNextPageError) return;
    if (entries.length >= HISTORY_LIMIT || pageCount >= MAX_PAGES) return;
    void fetchNextPage();
  }, [
    enabled,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    entries.length,
    pageCount,
    fetchNextPage,
  ]);

  const done =
    !hasNextPage || entries.length >= HISTORY_LIMIT || pageCount >= MAX_PAGES;
  return { query, entries, loadingMore: !done && !isFetchNextPageError, done };
}

function HistoryPage() {
  const loggedIn = useQuery(authLoggedInQuery);
  const signedOut = loggedIn.data === false;
  const qc = useQueryClient();

  const [source, setSource] = useState<SourceFilter>("both");
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [direction, setDirection] = useState<SortDirection>("desc");

  // Without an account only this device's own record exists.
  const effectiveSource: SourceFilter = signedOut ? "local" : source;
  const wantsAccount = !signedOut && effectiveSource !== "local";

  const account = useAccountHistory(!signedOut && loggedIn.data !== undefined);
  const local = usePlayLog((s) => s.entries);

  const merged = useMemo(
    () =>
      mergeHistory({
        account: account.entries,
        local,
        now: Date.now(),
      }),
    [account.entries, local],
  );
  const rows = useMemo(
    () =>
      filterHistory(merged, {
        source: effectiveSource,
        title,
        artist,
        direction,
      }),
    [merged, effectiveSource, title, artist, direction],
  );
  const tracks = useMemo(
    () => rows.map((r) => ({ ...r.item, playCount: r.when })),
    [rows],
  );

  const filtering = title.trim() !== "" || artist.trim() !== "";
  const initialLoading =
    wantsAccount && account.query.isLoading && account.entries.length === 0;
  const accountFailed = wantsAccount && !!account.query.error;

  return (
    <div className="flex flex-col gap-5 px-6 pb-6 pt-3">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">History</h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void qc.resetQueries({ queryKey: ["history"] })}
          disabled={signedOut || account.query.isFetching}
          title="Reload the account history"
        >
          <IconRefresh />
          Refresh
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-44 flex-1">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Search title"
            aria-label="Search by title"
            className="h-9 pr-8"
          />
          {title && (
            <ClearButton label="Clear title search" onClick={() => setTitle("")} />
          )}
        </div>
        <div className="relative min-w-44 flex-1">
          <Input
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            placeholder="Search artist"
            aria-label="Search by artist"
            className="h-9 pr-8"
          />
          {artist && (
            <ClearButton
              label="Clear artist search"
              onClick={() => setArtist("")}
            />
          )}
        </div>
        <SegmentedControl<SourceFilter>
          value={effectiveSource}
          onChange={setSource}
          disabled={signedOut}
          options={[
            { value: "both", label: "Both" },
            { value: "local", label: "This device" },
            { value: "account", label: "Account" },
          ]}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDirection((d) => (d === "desc" ? "asc" : "desc"))}
          title="Change the sort order"
        >
          {direction === "desc" ? <IconSortDescending /> : <IconSortAscending />}
          {direction === "desc" ? "Newest first" : "Oldest first"}
        </Button>
      </div>

      <div className="flex min-h-5 items-center gap-2 text-sm text-muted-foreground">
        {signedOut ? (
          <span>
            Sign in to include the account history. Showing plays from this
            device only.
          </span>
        ) : (
          <>
            <span>
              {filtering || effectiveSource !== "both"
                ? `${rows.length} of ${merged.length} plays`
                : `${rows.length} plays`}
            </span>
            {wantsAccount && account.loadingMore && (
              <span className="flex items-center gap-1">
                <IconLoader2 className="size-3.5 animate-spin" />
                Loading account history…
              </span>
            )}
          </>
        )}
      </div>

      {accountFailed && account.entries.length === 0 ? (
        <ErrorCard
          title="Couldn't load the account history"
          message={(account.query.error as Error).message}
          onRetry={() => void qc.resetQueries({ queryKey: ["history"] })}
        />
      ) : initialLoading ? (
        <TrackRowSkeletonList count={10} showPlays />
      ) : tracks.length === 0 ? (
        <EmptyState filtering={filtering} source={effectiveSource} />
      ) : (
        <>
          {accountFailed && (
            <p className="text-sm text-muted-foreground">
              Part of the account history could not be loaded.{" "}
              <button
                className="underline underline-offset-2"
                onClick={() => void account.query.fetchNextPage()}
              >
                Retry
              </button>
            </p>
          )}
          <TrackList tracks={tracks} showPlays />
        </>
      )}
    </div>
  );
}

function ClearButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
    >
      <IconX className="size-3.5" />
    </button>
  );
}

function EmptyState({
  filtering,
  source,
}: {
  filtering: boolean;
  source: SourceFilter;
}) {
  return (
    <div className="flex flex-col items-center gap-3 p-12 text-center">
      <IconHistory className="size-12 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        {filtering
          ? "No plays match your search."
          : source === "local"
            ? "Nothing played on this device yet. Plays are recorded after about 20 seconds of listening."
            : "No history yet."}
      </p>
    </div>
  );
}
