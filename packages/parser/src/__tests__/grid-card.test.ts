import { describe, it, expect } from "vitest";
import { parseGrid } from "../parsers/grid";
import { parseCard } from "../parsers/card";

describe("parseCard", () => {
  it("should parse card with href", () => {
    const node = {
      type: "mdxJsxFlowElement",
      name: "Card",
      attributes: [
        { type: "mdxJsxAttribute", name: "href", value: "./lesson1.mdx" },
      ],
    };

    const result = parseCard(node);

    expect(result).toEqual({
      type: "card",
      href: "./lesson1.mdx",
    });
  });

  it("should return empty string when href is missing", () => {
    const node = {
      type: "mdxJsxFlowElement",
      name: "Card",
      attributes: [],
    };

    const result = parseCard(node);

    expect(result.href).toBe("");
  });
});

describe("parseGrid", () => {
  it("should parse grid with cards", () => {
    const node = {
      type: "mdxJsxFlowElement",
      name: "Grid",
      attributes: [
        { type: "mdxJsxAttribute", name: "columns", value: "3" },
      ],
      children: [
        {
          type: "mdxJsxFlowElement",
          name: "Card",
          attributes: [
            { type: "mdxJsxAttribute", name: "href", value: "./card1.mdx" },
          ],
        },
        {
          type: "mdxJsxFlowElement",
          name: "Card",
          attributes: [
            { type: "mdxJsxAttribute", name: "href", value: "./card2.mdx" },
          ],
        },
      ],
    };

    const result = parseGrid(node);

    expect(result.type).toBe("grid");
    expect(result.columns).toBe(3);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({ type: "card", href: "./card1.mdx" });
    expect(result.items[1]).toEqual({ type: "card", href: "./card2.mdx" });
  });

  it("should default to 3 columns when not specified", () => {
    const node = {
      type: "mdxJsxFlowElement",
      name: "Grid",
      attributes: [],
      children: [],
    };

    const result = parseGrid(node);

    expect(result.columns).toBe(3);
    expect(result.items).toEqual([]);
  });

  it("should filter non-card children", () => {
    const node = {
      type: "mdxJsxFlowElement",
      name: "Grid",
      attributes: [],
      children: [
        {
          type: "mdxJsxFlowElement",
          name: "Card",
          attributes: [
            { type: "mdxJsxAttribute", name: "href", value: "./card.mdx" },
          ],
        },
        {
          type: "mdxJsxFlowElement",
          name: "div", // não é um Card
          attributes: [],
        },
        {
          type: "paragraph", // também não é Card
          children: [],
        },
      ],
    };

    const result = parseGrid(node);

    expect(result.items).toHaveLength(1);
    expect(result.items[0].href).toBe("./card.mdx");
  });
});
