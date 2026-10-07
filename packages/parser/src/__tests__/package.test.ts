import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parsePackage } from '../index';

let temp: string;
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});

async function makePackage(entry: string): Promise<string> {
  temp = await mkdtemp(path.join(os.tmpdir(), 'content-package-'));
  await writeFile(path.join(temp, 'index.mdx'), entry);
  return temp;
}

describe('parsePackage', () => {
  it('parses the package structure and supported static item content', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'content-package-'));
    await mkdir(path.join(temp, 'lessons'));
    await mkdir(path.join(temp, 'assets'));
    await writeFile(path.join(temp, 'assets', 'diagram.svg'), '<svg/>');
    await writeFile(
      path.join(temp, 'index.mdx'),
      `---\ntitle: TypeScript\ndescription: Learn the basics\n---
<Item src="lessons/intro.mdx" />
<Section title="Practice" layout="grid" columns={2}>
  <Item src="lessons/quiz.mdx" open="modal" />
</Section>`,
    );
    await writeFile(
      path.join(temp, 'lessons', 'intro.mdx'),
      `---\ntitle: Introduction\nthumbnail: ../assets/diagram.svg\n---
# Welcome
This is **static** content.
- One
- Two
<Image src="../assets/diagram.svg" alt="Diagram" />
<Video src="https://cdn.example.test/lesson.mp4" title="Lesson" />
<Question questionType="single-choice" question="Choose one">
  <Answer correct={false}>Wrong</Answer>
  <Answer correct={true}>Right</Answer>
</Question>`,
    );
    await writeFile(
      path.join(temp, 'lessons', 'quiz.mdx'),
      `---\ntitle: Quiz\n---\n> Remember to review.`,
    );

    const contentPackage = await parsePackage(temp);
    expect(contentPackage.metadata).toEqual({
      title: 'TypeScript',
      description: 'Learn the basics',
    });
    expect(contentPackage.children).toHaveLength(2);
    expect(contentPackage.children[0]).toMatchObject({
      type: 'item',
      id: 'item:lessons/intro.mdx',
      source: 'lessons/intro.mdx',
      presentation: { open: 'page' },
      metadata: { title: 'Introduction', thumbnail: 'assets/diagram.svg' },
      content: [
        { type: 'heading', depth: 1, text: 'Welcome' },
        { type: 'paragraph', text: 'This is static content.' },
        { type: 'list', ordered: false, items: ['One', 'Two'] },
        { type: 'image', src: 'assets/diagram.svg', alt: 'Diagram' },
        { type: 'video', src: 'https://cdn.example.test/lesson.mp4' },
        {
          type: 'question',
          questionType: 'single-choice',
          answers: [
            { text: 'Wrong', correct: false },
            { text: 'Right', correct: true },
          ],
        },
      ],
    });
    expect(contentPackage.children[1]).toMatchObject({
      type: 'section',
      id: 'section:1',
      presentation: { layout: 'grid', columns: 2 },
      children: [{ type: 'item', presentation: { open: 'modal' } }],
    });
  });

  it('supports sequence sections and rejects columns unless layout is grid', async () => {
    const root = await makePackage(
      `---\ntitle: Package\n---
<Section layout="sequence"><Item src="lesson.mdx" /></Section>`,
    );
    await writeFile(path.join(root, 'lesson.mdx'), '---\ntitle: Lesson\n---');
    const contentPackage = await parsePackage(root);
    expect(contentPackage.children[0]).toMatchObject({
      type: 'section',
      presentation: { layout: 'sequence' },
    });

    await writeFile(
      path.join(root, 'index.mdx'),
      `---\ntitle: Package\n---
<Section layout="sequence" columns={2}><Item src="lesson.mdx" /></Section>`,
    );
    await expect(parsePackage(root)).rejects.toThrow(
      /index\.mdx:\d+: Section "columns" is only valid with layout="grid"/,
    );
  });

  it('rejects invalid open and layout values with source locations', async () => {
    const root = await makePackage(
      `---\ntitle: Package\n---\n<Item src="lesson.mdx" open="new-window" />`,
    );
    await expect(parsePackage(root)).rejects.toThrow(
      /index\.mdx:\d+: Item "open" must be "page" or "modal"/,
    );
    await writeFile(
      path.join(root, 'index.mdx'),
      `---\ntitle: Package\n---\n<Section layout="carousel" />`,
    );
    await expect(parsePackage(root)).rejects.toThrow(
      /index\.mdx:\d+: Section "layout" must be "list", "grid", or "sequence"/,
    );
  });

  it('rejects nested sections and entry markdown with source locations', async () => {
    const root = await makePackage(
      `---\ntitle: Package\n---\n<Section><Section /></Section>`,
    );
    await expect(parsePackage(root)).rejects.toThrow(
      /index\.mdx:\d+: Section children may only contain <Item> components/,
    );
    await writeFile(
      path.join(root, 'index.mdx'),
      `---\ntitle: Package\n---\n\n# Disallowed`,
    );
    await expect(parsePackage(root)).rejects.toThrow(
      /index\.mdx:\d+: entry structure/,
    );
  });

  it('rejects unknown components, imports, and imports in item content', async () => {
    const root = await makePackage(`---\ntitle: Package\n---\n<Unknown />`);
    await expect(parsePackage(root)).rejects.toThrow(
      /unknown MDX component <Unknown>/,
    );
    await writeFile(
      path.join(root, 'index.mdx'),
      `---\ntitle: Package\n---\nimport { Item } from "./components";`,
    );
    await expect(parsePackage(root)).rejects.toThrow(
      /MDX JavaScript and imports are not supported/,
    );
    await writeFile(
      path.join(root, 'index.mdx'),
      `---\ntitle: Package\n---\n<Item src="lesson.mdx" />`,
    );
    await writeFile(
      path.join(root, 'lesson.mdx'),
      `---\ntitle: Lesson\n---\nimport Video from "./Video";`,
    );
    await expect(parsePackage(root)).rejects.toThrow(
      /MDX JavaScript and imports are not supported/,
    );
  });

  it('rejects missing local assets and preserves false boolean attributes', async () => {
    const root = await makePackage(
      `---\ntitle: Package\n---\n<Item src="lesson.mdx" />`,
    );
    await writeFile(
      path.join(root, 'lesson.mdx'),
      `---\ntitle: Lesson\n---\n<Image src="missing.png" />`,
    );
    await expect(parsePackage(root)).rejects.toThrow(
      /asset "missing\.png" does not exist/,
    );
    await writeFile(
      path.join(root, 'lesson.mdx'),
      `---\ntitle: Lesson\n---\n<Question questionType="single-choice" question="Q"><Answer correct={false}>A</Answer><Answer correct={true}>B</Answer></Question>`,
    );
    const contentPackage = await parsePackage(root);
    const item = contentPackage.children[0];
    if (item?.type !== 'item') throw new Error('Expected an item');
    const question = item.content.find((node) => node.type === 'question');
    if (question?.type !== 'question') throw new Error('Expected a question');
    expect(question.answers[0].correct).toBe(false);
  });
});
