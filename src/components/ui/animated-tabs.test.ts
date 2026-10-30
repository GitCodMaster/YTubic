import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnimatedTabs } from "./animated-tabs";

describe("themed tab controls", () => {
  it.each(["pill", "segment"] as const)(
    "%s uses rounded rectangles and retains selection semantics",
    (variant) => {
      const html = renderToStaticMarkup(
        createElement(AnimatedTabs, {
          variant,
          activeTab: "songs",
          tabs: [
            { id: "songs", label: "Songs" },
            { id: "albums", label: "Albums" },
          ],
        }),
      );
      expect(html).toContain("rounded-lg");
      expect(html).toContain("rounded-md");
      expect(html).not.toContain("rounded-full");
      expect(html).toContain("bg-w050");
      expect(html).toContain('aria-selected="true"');
      expect(html).toContain('aria-selected="false"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('tabindex="-1"');
    },
  );

  it("keeps the default underline treatment", () => {
    const html = renderToStaticMarkup(
      createElement(AnimatedTabs, {
        tabs: [{ id: "queue", label: "Queue" }],
      }),
    );
    expect(html).toContain("border-b");
    expect(html).toContain("h-0.5 bg-brand");
    expect(html).not.toContain("bg-w050");
  });
});
