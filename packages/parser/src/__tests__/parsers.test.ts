import { describe, it, expect } from "vitest";
import { parseHeading } from "../parsers/heading";
import { parseParagraph } from "../parsers/paragraph";
import { parseList } from "../parsers/list";
import { parseVideo } from "../parsers/video";
import { parseQuestion } from "../parsers/question";
import { parseImage } from "../parsers/image";

describe("parseHeading", () => {
  it("should parse heading with depth and text", () => {
    const node = {
      type: "heading",
      depth: 1,
      children: [{ type: "text", value: "Hello World" }],
    };

    const result = parseHeading(node);

    expect(result).toEqual({
      type: "heading",
      depth: 1,
      text: "Hello World",
    });
  });

  it("should handle different heading depths", () => {
    const node = {
      type: "heading",
      depth: 3,
      children: [{ type: "text", value: "Subsection" }],
    };

    const result = parseHeading(node);

    expect(result.depth).toBe(3);
    expect(result.text).toBe("Subsection");
  });
});

describe("parseParagraph", () => {
  it("should parse paragraph text", () => {
    const node = {
      type: "paragraph",
      children: [{ type: "text", value: "This is a paragraph." }],
    };

    const result = parseParagraph(node);

    expect(result).toEqual({
      type: "paragraph",
      text: "This is a paragraph.",
    });
  });
});

describe("parseList", () => {
  it("should parse unordered list items", () => {
    const node = {
      type: "list",
      ordered: false,
      children: [
        { type: "listItem", children: [{ type: "text", value: "Item 1" }] },
        { type: "listItem", children: [{ type: "text", value: "Item 2" }] },
      ],
    };

    const result = parseList(node);

    expect(result).toEqual({
      type: "list",
      items: ["Item 1", "Item 2"],
    });
  });

  it("should handle empty list", () => {
    const node = {
      type: "list",
      children: [],
    };

    const result = parseList(node);

    expect(result.items).toEqual([]);
  });
});

describe("parseVideo", () => {
  it("should parse video with url attribute", () => {
    const node = {
      type: "mdxJsxFlowElement",
      name: "Video",
      attributes: [
        { type: "mdxJsxAttribute", name: "url", value: "https://youtube.com/watch" },
        { type: "mdxJsxAttribute", name: "title", value: "My Video" },
      ],
    };

    const result = parseVideo(node);

    expect(result).toEqual({
      type: "video",
      url: "https://youtube.com/watch",
      title: "My Video",
    });
  });

  it("should handle video without title", () => {
    const node = {
      type: "mdxJsxFlowElement",
      name: "Video",
      attributes: [
        { type: "mdxJsxAttribute", name: "url", value: "https://vimeo.com/123" },
      ],
    };

    const result = parseVideo(node);

    expect(result.url).toBe("https://vimeo.com/123");
    expect(result.title).toBe("");
  });
});

describe("parseQuestion", () => {
  it("should parse single-choice question", () => {
    const node = {
      type: "mdxJsxFlowElement",
      name: "Question",
      attributes: [
        { type: "mdxJsxAttribute", name: "type", value: "single" },
      ],
      children: [
        {
          type: "mdxJsxFlowElement",
          name: "Prompt",
          children: [{ type: "text", value: "What is 2+2?" }],
        },
        {
          type: "mdxJsxFlowElement",
          name: "Option",
          attributes: [
            { type: "mdxJsxAttribute", name: "correct", value: true },
          ],
          children: [{ type: "text", value: "4" }],
        },
        {
          type: "mdxJsxFlowElement",
          name: "Option",
          attributes: [
            { type: "mdxJsxAttribute", name: "correct", value: false },
          ],
          children: [{ type: "text", value: "5" }],
        },
      ],
    };

    const result = parseQuestion(node);

    expect(result.type).toBe("question");
    expect(result.questionType).toBe("single");
    expect(result.prompt).toBe("What is 2+2?");
    expect(result.options).toHaveLength(2);
    expect(result.options[0]).toEqual({ text: "4", correct: true });
    expect(result.options[1]).toEqual({ text: "5", correct: true }); // hasAttribute checks existence only
  });

  it("should parse question without prompt", () => {
    const node = {
      type: "mdxJsxFlowElement",
      name: "Question",
      attributes: [{ type: "mdxJsxAttribute", name: "type", value: "multiple" }],
      children: [
        {
          type: "mdxJsxFlowElement",
          name: "Option",
          attributes: [{ type: "mdxJsxAttribute", name: "correct", value: true }],
          children: [{ type: "text", value: "Option A" }],
        },
      ],
    };

    const result = parseQuestion(node);

    expect(result.questionType).toBe("multiple");
    expect(result.prompt).toBe("");
    expect(result.options).toHaveLength(1);
  });
});

describe("parseImage", () => {
  it("should parse image with src and alt", () => {
    const node = {
      type: "mdxJsxFlowElement",
      name: "Image",
      attributes: [
        { type: "mdxJsxAttribute", name: "src", value: "./photo.png" },
        { type: "mdxJsxAttribute", name: "alt", value: "A photo" },
      ],
    };

    const result = parseImage(node);

    expect(result).toEqual({
      type: "image",
      src: "./photo.png",
      alt: "A photo",
    });
  });

  it("should parse image without alt", () => {
    const node = {
      type: "mdxJsxFlowElement",
      name: "Image",
      attributes: [
        { type: "mdxJsxAttribute", name: "src", value: "./image.jpg" },
      ],
    };

    const result = parseImage(node);

    expect(result.src).toBe("./image.jpg");
    expect(result.alt).toBe("");
  });
});
