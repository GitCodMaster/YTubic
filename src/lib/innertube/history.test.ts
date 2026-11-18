import { describe, expect, it } from "vitest";
import {
  entriesFromShelves,
  parseHistoryResponse,
} from "./history";
import type { YtNode } from "./shared";

function row(id: string, title: string, artist: string): YtNode {
  return {
    musicResponsiveListItemRenderer: {
      flexColumns: [
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: {
              runs: [
                { text: title, navigationEndpoint: { watchEndpoint: { videoId: id } } },
              ],
            },
          },
        },
        {
          musicResponsiveListItemFlexColumnRenderer: {
            text: {
              runs: [
                {
                  text: artist,
                  navigationEndpoint: {
                    browseEndpoint: {
                      browseId: "UC" + artist,
                      browseEndpointContextSupportedConfigs: {
                        browseEndpointContextMusicConfig: {
                          pageType: "MUSIC_PAGE_TYPE_ARTIST",
                        },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    },
  };
}

function shelf(title: string, rows: YtNode[]): YtNode {
  return {
    musicShelfRenderer: { title: { runs: [{ text: title }] }, contents: rows },
  };
}

const NEXT = {
  nextContinuationData: { continuation: "TOKEN2" },
};

describe("entriesFromShelves", () => {
  it("tags every row with its shelf's heading, in order", () => {
    const e = entriesFromShelves([
      shelf("Today", [row("a", "A", "X"), row("b", "B", "Y")]),
      shelf("Yesterday", [row("c", "C", "X")]),
    ]);
    expect(e.map((x) => [x.item.id, x.bucket])).toEqual([
      ["a", "Today"],
      ["b", "Today"],
      ["c", "Yesterday"],
    ]);
    expect(e[0].item.artists?.[0].name).toBe("X");
  });

  it("files bare rows under the fallback heading", () => {
    const e = entriesFromShelves([row("a", "A", "X")], "Monday");
    expect(e[0].bucket).toBe("Monday");
  });

  it("skips rows that are not playable songs", () => {
    const e = entriesFromShelves([
      shelf("Today", [{ musicResponsiveListItemRenderer: { flexColumns: [] } }, row("a", "A", "X")]),
    ]);
    expect(e.map((x) => x.item.id)).toEqual(["a"]);
  });
});

describe("parseHistoryResponse", () => {
  it("reads the first page and its continuation token", () => {
    const json = {
      contents: {
        singleColumnBrowseResultsRenderer: {
          tabs: [
            {
              tabRenderer: {
                content: {
                  sectionListRenderer: {
                    contents: [shelf("Today", [row("a", "A", "X")])],
                    continuations: [NEXT],
                  },
                },
              },
            },
          ],
        },
      },
    };
    const p = parseHistoryResponse(json);
    expect(p.entries).toHaveLength(1);
    expect(p.token).toBe("TOKEN2");
  });

  it("reads a section-list continuation page", () => {
    const json = {
      continuationContents: {
        sectionListContinuation: {
          contents: [shelf("October", [row("z", "Z", "X")])],
        },
      },
    };
    const p = parseHistoryResponse(json);
    expect(p.entries[0].bucket).toBe("October");
    expect(p.token).toBeUndefined();
  });

  it("reads an appendContinuationItemsAction page and its trailing token", () => {
    const json = {
      onResponseReceivedActions: [
        {
          appendContinuationItemsAction: {
            continuationItems: [
              shelf("Monday", [row("m", "M", "X")]),
              {
                continuationItemRenderer: {
                  continuationEndpoint: { continuationCommand: { token: "TOKEN3" } },
                },
              },
            ],
          },
        },
      ],
    };
    const p = parseHistoryResponse(json);
    expect(p.entries[0].bucket).toBe("Monday");
    expect(p.token).toBe("TOKEN3");
  });

  it("returns an empty page for an unrecognised response", () => {
    expect(parseHistoryResponse({})).toEqual({ entries: [] });
    expect(parseHistoryResponse(undefined)).toEqual({ entries: [] });
  });
});
