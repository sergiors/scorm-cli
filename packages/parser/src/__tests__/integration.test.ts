import { describe, it, expect } from "vitest";
import { parseFile } from "../index";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("parseFile integration", () => {
  const tempDir = join(tmpdir(), "scorm-parser-test-" + Date.now());

  it("should parse markdown with frontmatter", async () => {
    await mkdir(tempDir, { recursive: true });
    const filePath = join(tempDir, "test.mdx");

    const content = `---
title: Test Course
---

# Introduction

This is a test paragraph.

- Item 1
- Item 2
- Item 3
`;

    await writeFile(filePath, content);

    const result = await parseFile(filePath);

    expect(result.metadata).toEqual({ title: "Test Course" });
    expect(result.body).toHaveLength(3);

    expect(result.body[0]).toEqual({
      type: "heading",
      depth: 1,
      text: "Introduction",
    });

    expect(result.body[1]).toEqual({
      type: "paragraph",
      text: "This is a test paragraph.",
    });

    expect(result.body[2]).toEqual({
      type: "list",
      items: ["Item 1", "Item 2", "Item 3"],
    });

    await rm(tempDir, { recursive: true });
  });

  it("should parse video component", async () => {
    await mkdir(tempDir, { recursive: true });
    const filePath = join(tempDir, "video.mdx");

    const content = `---
title: Video Lesson
---

<Video url="https://youtube.com/watch" title="My Video" />
`;

    await writeFile(filePath, content);

    const result = await parseFile(filePath);

    expect(result.body[0]).toEqual({
      type: "video",
      url: "https://youtube.com/watch",
      title: "My Video",
    });

    await rm(tempDir, { recursive: true });
  });

  it("should parse image component", async () => {
    await mkdir(tempDir, { recursive: true });
    const filePath = join(tempDir, "image.mdx");

    const content = `---
title: Image Example
---

<Image src="./photo.png" alt="A photo" />
`;

    await writeFile(filePath, content);

    const result = await parseFile(filePath);

    expect(result.body[0].type).toBe("image");
    expect(result.body[0].src).toBe("./photo.png");
    expect(result.body[0].alt).toBe("A photo");
    expect(result.body[0].resolvedSrc).toBe(join(tempDir, "photo.png"));

    await rm(tempDir, { recursive: true });
  });

  it("should parse question component", async () => {
    await mkdir(tempDir, { recursive: true });
    const filePath = join(tempDir, "question.mdx");

    const content = `---
title: Quiz
---

<Question type="single">
  <Prompt>What is 2+2?</Prompt>
  <Option correct={true}>4</Option>
  <Option correct={false}>5</Option>
</Question>
`;

    await writeFile(filePath, content);

    const result = await parseFile(filePath);

    expect(result.body[0].type).toBe("question");
    expect(result.body[0].questionType).toBe("single");
    expect(result.body[0].prompt).toBe("What is 2+2?");
    expect(result.body[0].options).toHaveLength(2);

    await rm(tempDir, { recursive: true });
  });

  it("should throw on missing frontmatter", async () => {
    await mkdir(tempDir, { recursive: true });
    const filePath = join(tempDir, "invalid.mdx");

    const content = `# No Frontmatter

This file has no frontmatter.
`;

    await writeFile(filePath, content);

    await expect(parseFile(filePath)).rejects.toThrow();

    await rm(tempDir, { recursive: true });
  });

  it("should throw on missing title in frontmatter", async () => {
    await mkdir(tempDir, { recursive: true });
    const filePath = join(tempDir, "invalid.mdx");

    const content = `---
description: Missing title
---

# Content
`;

    await writeFile(filePath, content);

    await expect(parseFile(filePath)).rejects.toThrow();

    await rm(tempDir, { recursive: true });
  });
});
