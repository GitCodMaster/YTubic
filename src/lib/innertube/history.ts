import type { ShelfItem } from "./types";
import {
  mapResponsiveListItem,
  rawBrowse,
  rawBrowseContinuation,
  readPagingToken,
  readRuns,
  type YtNode,
} from "./shared";

/**
 * The account's YouTube Music listening history (`FEmusic_history`).
 *
 * It is what the web client's History page shows: plays from every device
 * signed in to the account, newest first, grouped under a time bucket
 * ("Today", "Yesterday", "Monday", "October", ...). YouTube gives only the
 * bucket, never a timestamp, so a play is known to the day at best.
 */

/** One play. The same song played twice is two entries. */
export type HistoryEntry = {
  item: ShelfItem;
  /** The bucket heading the entry sat under, e.g. "Yesterday". */
  bucket: string;
};

export type HistoryPage = {
  entries: HistoryEntry[];
  /** Continuation token for the next (older) page, absent on the last. */
  token?: string;
};

/**
 * Map shelves to entries. A shelf is one bucket (`musicShelfRenderer`, its
 * title is the bucket). Bare rows, which continuation pages sometimes
 * return without their shelf, inherit `fallbackBucket`. Only songs and
 * videos are kept; podcast episodes and the like are not playable here.
 */
export function entriesFromShelves(
  nodes: YtNode[],
  fallbackBucket = "",
): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  let bucket = fallbackBucket;

  const take = (row: YtNode | undefined, heading: string) => {
    const renderer: YtNode | undefined = row?.musicResponsiveListItemRenderer;
    if (!renderer) return;
    const item = mapResponsiveListItem(renderer);
    if (!item || (item.kind !== "song" && item.kind !== "video")) return;
    out.push({ item, bucket: heading });
  };

  for (const node of nodes) {
    const shelf: YtNode | undefined =
      node?.musicShelfRenderer ?? node?.musicCarouselShelfRenderer;
    if (shelf) {
      const heading = readRuns(shelf.title).trim();
      if (heading) bucket = heading;
      for (const row of shelf.contents ?? []) take(row, bucket);
    } else {
      take(node, bucket);
    }
  }
  return out;
}

/** Parse a first-page browse response or a continuation response. */
export function parseHistoryResponse(
  json: YtNode | undefined,
  fallbackBucket = "",
): HistoryPage {
  const sectionList: YtNode | undefined =
    json?.contents?.singleColumnBrowseResultsRenderer?.tabs?.[0]?.tabRenderer
      ?.content?.sectionListRenderer;
  if (sectionList) {
    return {
      entries: entriesFromShelves(sectionList.contents ?? [], fallbackBucket),
      token: readPagingToken(sectionList),
    };
  }

  const cc: YtNode | undefined = json?.continuationContents;
  const container: YtNode | undefined =
    cc?.sectionListContinuation ?? cc?.musicShelfContinuation;
  if (container) {
    const nodes: YtNode[] = container.contents ?? container.items ?? [];
    return {
      entries: entriesFromShelves(nodes, fallbackBucket),
      token: readPagingToken(container),
    };
  }

  // Newer responses append through an action instead.
  for (const a of json?.onResponseReceivedActions ?? []) {
    const appended: YtNode[] | undefined =
      a?.appendContinuationItemsAction?.continuationItems;
    if (!appended?.length) continue;
    return {
      entries: entriesFromShelves(appended, fallbackBucket),
      token: readPagingToken({ items: appended }),
    };
  }
  return { entries: [] };
}

/**
 * One page of history. Pass the previous page's `token` for the next one
 * and its last bucket as `fallbackBucket`, so rows that come back without
 * a heading are filed under the right day.
 */
export async function fetchHistoryPage(
  token?: string,
  fallbackBucket = "",
): Promise<HistoryPage> {
  const json = token
    ? await rawBrowseContinuation(token)
    : await rawBrowse("FEmusic_history");
  return parseHistoryResponse(json, fallbackBucket);
}
