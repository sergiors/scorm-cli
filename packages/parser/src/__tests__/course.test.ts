import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCourse } from '../index';

let temp: string;
afterEach(async () => {
  if (temp) await rm(temp, { recursive: true, force: true });
});

describe('parseCourse', () => {
  it('parses course structure and static item content into the core schema', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'course-parse-'));
    await mkdir(path.join(temp, 'lessons'));
    await mkdir(path.join(temp, 'assets'));
    await writeFile(path.join(temp, 'assets', 'diagram.svg'), '<svg/>');
    await writeFile(
      path.join(temp, 'index.mdx'),
      `---\ntitle: TypeScript\ndescription: Learn the basics\n---
<Item src="lessons/intro.mdx" />
<Section title="Practice" layout="grid" columns={2}>
  <Item src="lessons/quiz.mdx" />
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

    const course = await parseCourse(temp);
    expect(course.metadata).toEqual({
      title: 'TypeScript',
      description: 'Learn the basics',
    });
    expect(course.children).toHaveLength(2);
    expect(course.children[0]).toMatchObject({
      type: 'item',
      id: 'item:lessons/intro.mdx',
      source: 'lessons/intro.mdx',
      metadata: { title: 'Introduction', thumbnail: 'assets/diagram.svg' },
    });
    expect(course.children[0]).toMatchObject({
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
    expect(course.children[1]).toMatchObject({
      type: 'section',
      id: 'section:1',
      presentation: { layout: 'grid', columns: 2 },
    });
  });

  it('rejects entry markdown, unknown components, and imports with a source location', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'course-parse-'));
    await writeFile(
      path.join(temp, 'index.mdx'),
      `---\ntitle: Course\n---\n\n# Disallowed`,
    );
    await expect(parseCourse(temp)).rejects.toThrow(
      /index\.mdx:\d+: entry structure/,
    );
    await writeFile(
      path.join(temp, 'index.mdx'),
      `---\ntitle: Course\n---\n<Unknown />`,
    );
    await expect(parseCourse(temp)).rejects.toThrow(
      /unknown MDX component <Unknown>/,
    );
    await writeFile(
      path.join(temp, 'index.mdx'),
      `---\ntitle: Course\n---\n\nimport { Item } from "./components";\n\n<Item src="lesson.mdx" />`,
    );
    await expect(parseCourse(temp)).rejects.toThrow(
      /MDX JavaScript and imports are not supported/,
    );
  });

  it('rejects imports in item content', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'course-parse-'));
    await mkdir(path.join(temp, 'lesson'));
    await writeFile(
      path.join(temp, 'index.mdx'),
      `---\ntitle: Course\n---\n<Item src="lesson/one.mdx" />`,
    );
    await writeFile(
      path.join(temp, 'lesson', 'one.mdx'),
      `---\ntitle: One\n---\n\nimport Video from "./Video";\n\n<Video src="lesson.mp4" />`,
    );
    await expect(parseCourse(temp)).rejects.toThrow(
      /MDX JavaScript and imports are not supported/,
    );
  });

  it('rejects missing local assets and preserves false boolean attributes', async () => {
    temp = await mkdtemp(path.join(os.tmpdir(), 'course-parse-'));
    await mkdir(path.join(temp, 'lesson'));
    await writeFile(
      path.join(temp, 'index.mdx'),
      `---\ntitle: Course\n---\n<Item src="lesson/one.mdx" />`,
    );
    await writeFile(
      path.join(temp, 'lesson', 'one.mdx'),
      `---\ntitle: One\n---\n<Image src="missing.png" />`,
    );
    await expect(parseCourse(temp)).rejects.toThrow(
      /asset "missing\.png" does not exist/,
    );
    await writeFile(
      path.join(temp, 'lesson', 'one.mdx'),
      `---\ntitle: One\n---\n<Question questionType="single-choice" question="Q"><Answer correct={false}>A</Answer><Answer correct={true}>B</Answer></Question>`,
    );
    const course = await parseCourse(temp);
    const item = course.children[0];
    if (item?.type !== 'item') throw new Error('Expected an item');
    const question = item.content.find((node) => node.type === 'question');
    if (question?.type !== 'question') throw new Error('Expected a question');
    expect(question.answers[0].correct).toBe(false);
  });
});
