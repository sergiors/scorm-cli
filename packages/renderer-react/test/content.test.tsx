import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContentRenderer } from "../app/components/ContentRenderer";
import type { ContentNode } from "../app/types";

function render(nodes: ContentNode[], headingOffset?: number): string {
  return renderToStaticMarkup(
    <ContentRenderer nodes={nodes} headingOffset={headingOffset} />,
  );
}

describe("ContentRenderer", () => {
  it("renders headings at the source depth", () => {
    const html = render([{ type: "heading", depth: 2, text: "Welcome" }]);
    expect(html).toContain("<h2");
    expect(html).toContain("Welcome");
  });

  it("applies a heading offset so content nests under player headings", () => {
    const html = render([{ type: "heading", depth: 1, text: "Deep" }], 2);
    expect(html).toContain("<h3");
  });

  it("clamps heading depth to the 1-6 range", () => {
    expect(render([{ type: "heading", depth: 9, text: "Big" }])).toContain(
      "<h6",
    );
    expect(render([{ type: "heading", depth: 0, text: "Small" }])).toContain(
      "<h1",
    );
  });

  it("renders paragraphs", () => {
    const html = render([{ type: "paragraph", text: "Hello world" }]);
    expect(html).toContain("<p");
    expect(html).toContain("Hello world");
  });

  it("renders unordered and ordered lists", () => {
    const unordered = render([
      { type: "list", ordered: false, items: ["One", "Two"] },
    ]);
    expect(unordered).toContain("<ul");
    expect(unordered).toContain("list-disc");
    expect(unordered).toContain("One");

    const ordered = render([
      { type: "list", ordered: true, items: ["First"] },
    ]);
    expect(ordered).toContain("<ol");
    expect(ordered).toContain("list-decimal");
  });

  it("renders links and marks external ones", () => {
    const html = render([
      { type: "link", href: "https://example.com", text: "Docs" },
    ]);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).toContain("Docs");
  });

  it("renders images with alt text", () => {
    const html = render([
      { type: "image", src: "./a.png", alt: "A picture" },
    ]);
    expect(html).toContain('src="./a.png"');
    expect(html).toContain('alt="A picture"');
    expect(html).toContain('loading="lazy"');
  });

  it("renders videos with an accessible name and caption", () => {
    const html = render([
      { type: "video", src: "./v.mp4", title: "Intro video" },
    ]);
    expect(html).toContain("<video");
    expect(html).toContain('src="./v.mp4"');
    expect(html).toContain('aria-label="Intro video"');
    expect(html).toContain("<figcaption");
  });

  it("falls back to a generic video label when no title is provided", () => {
    const html = render([{ type: "video", src: "./v.mp4" }]);
    expect(html).toContain('aria-label="Video"');
    expect(html).not.toContain("<figcaption");
  });

  it("renders a single-choice question as radios without grading", () => {
    const html = render([
      {
        type: "question",
        questionType: "single-choice",
        question: "Pick one",
        answers: [
          { text: "Yes", correct: true },
          { text: "No", correct: false },
        ],
      },
    ]);
    expect(html).toContain("<fieldset");
    expect(html).toContain("<legend");
    expect(html).toContain("Pick one");
    expect(html).toContain('type="radio"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain("Yes");
    expect(html).toContain("No");
    expect(html).toContain("not graded");
  });

  it("renders a multiple-choice question as checkboxes", () => {
    const html = render([
      {
        type: "question",
        questionType: "multiple-choice",
        question: "Pick many",
        answers: [
          { text: "A", correct: true },
          { text: "B", correct: false },
        ],
      },
    ]);
    expect(html).toContain('type="checkbox"');
    expect(html).not.toContain('type="radio"');
  });

  it("renders code blocks with an optional language class", () => {
    const html = render([
      { type: "code", value: "const x = 1 < 2;", language: "ts" },
    ]);
    expect(html).toContain("<pre");
    expect(html).toContain("language-ts");
    expect(html).toContain("const x = 1 &lt; 2;");
  });

  it("renders quotes", () => {
    const html = render([{ type: "quote", text: "Stay curious." }]);
    expect(html).toContain("<blockquote");
    expect(html).toContain("Stay curious.");
  });

  it("ignores unknown node types without throwing", () => {
    const html = render([
      { type: "mystery" } as unknown as ContentNode,
      { type: "paragraph", text: "Still here" },
    ]);
    expect(html).toContain("Still here");
  });

  it("escapes unsafe text", () => {
    const html = render([
      { type: "paragraph", text: "<script>alert(1)</script>" },
    ]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
