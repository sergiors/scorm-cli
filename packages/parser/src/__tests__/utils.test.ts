import { describe, it, expect } from "vitest";
import {
  getText,
  hasAttribute,
  getAttribute,
  flattenChildren,
  isMdxNode,
} from "../parsers/utils";

describe("getText", () => {
  it("should extract text from node", () => {
    const node = {
      type: "paragraph",
      children: [{ type: "text", value: "Hello world" }],
    };

    expect(getText(node)).toBe("Hello world");
  });

  it("should handle empty node", () => {
    const node = { type: "paragraph" };
    expect(getText(node)).toBe("");
  });
});

describe("hasAttribute", () => {
  it("should return true when attribute exists", () => {
    const node = {
      type: "mdxJsxFlowElement",
      attributes: [
        { name: "title", value: "My Title" },
        { name: "class", value: "my-class" },
      ],
    };

    expect(hasAttribute(node, "title")).toBe(true);
    expect(hasAttribute(node, "class")).toBe(true);
  });

  it("should return false when attribute does not exist", () => {
    const node = {
      type: "mdxJsxFlowElement",
      attributes: [{ name: "title", value: "My Title" }],
    };

    expect(hasAttribute(node, "class")).toBe(false);
  });

  it("should return false when node has no attributes", () => {
    const node = { type: "paragraph" };
    expect(hasAttribute(node, "title")).toBe(false);
  });
});

describe("getAttribute", () => {
  it("should return attribute value when exists", () => {
    const node = {
      type: "mdxJsxFlowElement",
      attributes: [
        { name: "url", value: "https://example.com" },
        { name: "title", value: "Example" },
      ],
    };

    expect(getAttribute(node, "url")).toBe("https://example.com");
    expect(getAttribute(node, "title")).toBe("Example");
  });

  it("should return undefined when attribute does not exist", () => {
    const node = {
      type: "mdxJsxFlowElement",
      attributes: [{ name: "title", value: "My Title" }],
    };

    expect(getAttribute(node, "url")).toBeUndefined();
  });

  it("should return undefined when node has no attributes", () => {
    const node = { type: "paragraph" };
    expect(getAttribute(node, "title")).toBeUndefined();
  });
});

describe("flattenChildren", () => {
  it("should flatten paragraph children", () => {
    const children = [
      {
        type: "paragraph",
        children: [{ type: "text", value: "Text 1" }],
      },
      {
        type: "text",
        value: "Text 2",
      },
    ];

    const result = flattenChildren(children);

    expect(result).toEqual([
      { type: "text", value: "Text 1" },
      { type: "text", value: "Text 2" },
    ]);
  });

  it("should handle empty array", () => {
    const result = flattenChildren([]);
    expect(result).toEqual([]);
  });
});

describe("isMdxNode", () => {
  it("should return true for mdxJsxFlowElement", () => {
    const node = { type: "mdxJsxFlowElement", name: "Grid" };
    expect(isMdxNode(node)).toBe(true);
  });

  it("should return true for mdxJsxTextElement", () => {
    const node = { type: "mdxJsxTextElement", name: "Card" };
    expect(isMdxNode(node)).toBe(true);
  });

  it("should return false for non-mdx nodes", () => {
    const node = { type: "paragraph" };
    expect(isMdxNode(node)).toBe(false);
  });

  it("should check specific mdx node name when provided", () => {
    const node = { type: "mdxJsxFlowElement", name: "Grid" };
    expect(isMdxNode(node, "Grid")).toBe(true);
    expect(isMdxNode(node, "Card")).toBe(false);
  });
});
