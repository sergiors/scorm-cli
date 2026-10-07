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

async function makeLesson(content: string): Promise<string> {
  const root = await makePackage(
    `---\ntitle: Package\n---\n<Item src="lesson.mdx" />`,
  );
  await writeFile(
    path.join(root, 'lesson.mdx'),
    `---\ntitle: Lesson\n---\n${content}`,
  );
  return root;
}

async function asset(root: string, name: string): Promise<void> {
  await mkdir(path.dirname(path.join(root, name)), { recursive: true });
  await writeFile(path.join(root, name), 'asset');
}

async function lessonContent(root: string) {
  const contentPackage = await parsePackage(root);
  const item = contentPackage.children[0];
  if (item?.type !== 'item') throw new Error('Expected an item');
  return item.content;
}

describe('parsePackage', () => {
  it('preserves Markdown inline semantics and nested formatting', async () => {
    const root = await makeLesson(
      '# Hello **bold *nested*** and [a *rich* link](https://example.test) with `code`\n\n' +
        'First  \nsecond, plus ![diagram](assets/diagram.svg).',
    );
    await asset(root, 'assets/diagram.svg');
    expect(await lessonContent(root)).toEqual([
      {
        type: 'heading',
        depth: 1,
        children: [
          { type: 'text', value: 'Hello ' },
          {
            type: 'strong',
            children: [
              { type: 'text', value: 'bold ' },
              {
                type: 'emphasis',
                children: [{ type: 'text', value: 'nested' }],
              },
            ],
          },
          { type: 'text', value: ' and ' },
          {
            type: 'link',
            href: 'https://example.test',
            children: [
              { type: 'text', value: 'a ' },
              { type: 'emphasis', children: [{ type: 'text', value: 'rich' }] },
              { type: 'text', value: ' link' },
            ],
          },
          { type: 'text', value: ' with ' },
          { type: 'inlineCode', value: 'code' },
        ],
      },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'First' },
          { type: 'break' },
          { type: 'text', value: 'second, plus ' },
          { type: 'image', src: 'assets/diagram.svg', alt: 'diagram' },
          { type: 'text', value: '.' },
        ],
      },
    ]);
  });

  it('preserves nested lists, blockquotes, ordered starts, and fenced code languages', async () => {
    const root = await makeLesson(
      '3. First\n   - nested **item**\n4. Second\n\n> A quote\n>\n> - quoted list\n\n```ts\nconst answer: number = 42;\n```',
    );
    expect(await lessonContent(root)).toEqual([
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [
          {
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'First' }],
              },
              {
                type: 'list',
                ordered: false,
                items: [
                  {
                    children: [
                      {
                        type: 'paragraph',
                        children: [
                          { type: 'text', value: 'nested ' },
                          {
                            type: 'strong',
                            children: [{ type: 'text', value: 'item' }],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          {
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'Second' }],
              },
            ],
          },
        ],
      },
      {
        type: 'quote',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'A quote' }] },
          {
            type: 'list',
            ordered: false,
            items: [
              {
                children: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'quoted list' }],
                  },
                ],
              },
            ],
          },
        ],
      },
      { type: 'code', value: 'const answer: number = 42;', language: 'ts' },
    ]);
  });

  it('resolves standard reference-style Markdown links and images', async () => {
    const root = await makeLesson(
      '[Read *the guide*][guide] and ![reference image][diagram].\n\n' +
        '[guide]: https://example.test/guide\n' +
        '[diagram]: assets/diagram.svg',
    );
    await asset(root, 'assets/diagram.svg');
    expect(await lessonContent(root)).toEqual([
      {
        type: 'paragraph',
        children: [
          {
            type: 'link',
            href: 'https://example.test/guide',
            children: [
              { type: 'text', value: 'Read ' },
              {
                type: 'emphasis',
                children: [{ type: 'text', value: 'the guide' }],
              },
            ],
          },
          { type: 'text', value: ' and ' },
          { type: 'image', src: 'assets/diagram.svg', alt: 'reference image' },
          { type: 'text', value: '.' },
        ],
      },
    ]);
  });

  it('parses standard and semantic images in flow and inline contexts', async () => {
    const root = await makeLesson(
      '![Markdown](assets/pic.svg)\n\nBefore <Image src="assets/pic.svg" alt="" caption="A caption" /> after.\n\n<Image src="assets/pic.svg" alt="Semantic" />',
    );
    await asset(root, 'assets/pic.svg');
    expect(await lessonContent(root)).toEqual([
      {
        type: 'paragraph',
        children: [{ type: 'image', src: 'assets/pic.svg', alt: 'Markdown' }],
      },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Before ' },
          {
            type: 'image',
            src: 'assets/pic.svg',
            alt: '',
            caption: 'A caption',
          },
          { type: 'text', value: ' after.' },
        ],
      },
      { type: 'image', src: 'assets/pic.svg', alt: 'Semantic' },
    ]);
  });

  it('parses semantic video, callout, example, and steps recursively', async () => {
    const root = await makeLesson(
      `<Video src="https://cdn.example.test/lesson.mp4" title="Lesson" poster="assets/poster.svg" captions="assets/captions.vtt" />\n\n` +
        `<Callout type="tip">\nUse **types**.\n\n<Example title="Try it">\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n</Example>\n</Callout>\n\n` +
        `<Steps>\n<Step title="Start">\nRead *carefully*.\n</Step>\n<Step>\nPractice.\n</Step>\n</Steps>`,
    );
    await asset(root, 'assets/poster.svg');
    await asset(root, 'assets/captions.vtt');
    expect(await lessonContent(root)).toMatchObject([
      {
        type: 'video',
        src: 'https://cdn.example.test/lesson.mp4',
        title: 'Lesson',
        poster: 'assets/poster.svg',
        captions: 'assets/captions.vtt',
      },
      {
        type: 'callout',
        variant: 'tip',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Use ' },
              { type: 'strong', children: [{ type: 'text', value: 'types' }] },
              { type: 'text', value: '.' },
            ],
          },
          {
            type: 'example',
            title: 'Try it',
            children: [{ type: 'code', value: 'const x = 1;' }],
          },
        ],
      },
      {
        type: 'steps',
        steps: [
          {
            title: 'Start',
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'text', value: 'Read ' },
                  {
                    type: 'emphasis',
                    children: [{ type: 'text', value: 'carefully' }],
                  },
                  { type: 'text', value: '.' },
                ],
              },
            ],
          },
          {
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'Practice.' }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('parses rich question prompts and options and preserves boolean false', async () => {
    const root = await makeLesson(
      `<Question type="single-choice">\n` +
        `  <Prompt>\nWhat does \`string\` represent?\n\nChoose **one**.\n</Prompt>\n` +
        `  <Option value="number" correct={false}>\nA *numeric* value\n\n\`\`\`\n42\n\`\`\`\n</Option>\n` +
        `  <Option value="text" correct={true}>\nText\n\n\`\`\`\n"hello"\n\`\`\`\n</Option>\n` +
        `</Question>`,
    );
    expect(await lessonContent(root)).toEqual([
      {
        type: 'question',
        questionType: 'single-choice',
        prompt: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'What does ' },
              { type: 'inlineCode', value: 'string' },
              { type: 'text', value: ' represent?' },
            ],
          },
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Choose ' },
              { type: 'strong', children: [{ type: 'text', value: 'one' }] },
              { type: 'text', value: '.' },
            ],
          },
        ],
        options: [
          {
            value: 'number',
            correct: false,
            content: [
              {
                type: 'paragraph',
                children: [
                  { type: 'text', value: 'A ' },
                  {
                    type: 'emphasis',
                    children: [{ type: 'text', value: 'numeric' }],
                  },
                  { type: 'text', value: ' value' },
                ],
              },
              { type: 'code', value: '42' },
            ],
          },
          {
            value: 'text',
            correct: true,
            content: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'Text' }],
              },
              { type: 'code', value: '"hello"' },
            ],
          },
        ],
      },
    ]);
  });

  it('validates Prompt counts with a source line and count', async () => {
    for (const [inside, count] of [
      ['<Option value="a"/><Option value="b"/>', 0],
      [
        '<Prompt>One</Prompt><Prompt>Two</Prompt><Option value="a"/><Option value="b"/>',
        2,
      ],
    ] as const) {
      const root = await makeLesson(
        `<Question type="single-choice">${inside}</Question>`,
      );
      await expect(parsePackage(root)).rejects.toThrow(
        new RegExp(
          `lesson\\.mdx:\\d+: Question must contain exactly 1 Prompt; found ${count}`,
        ),
      );
      await rm(root, { recursive: true, force: true });
      temp = '';
    }
  });

  it('validates unique required option values and answer rules for all question types', async () => {
    const cases = [
      [
        `<Question type="single-choice"><Prompt>Q</Prompt><Option value="x"/><Option value="y"/></Question>`,
        /single-choice Question must have exactly one correct Option/,
      ],
      [
        `<Question type="single-choice"><Prompt>Q</Prompt><Option value="x" correct/><Option value="x"/></Question>`,
        /Option value "x" must be unique/,
      ],
      [
        `<Question type="multiple-choice"><Prompt>Q</Prompt><Option value="x"/><Option value="y"/></Question>`,
        /multiple-choice Question must have at least one correct Option/,
      ],
      [
        `<Question type="true-false"><Prompt>Q</Prompt><Option value="t" correct/><Option value="f"/><Option value="m"/></Question>`,
        /true-false Question must have exactly 2 Options/,
      ],
      [
        `<Question type="true-false"><Prompt>Q</Prompt><Option value="t"/><Option value="f"/></Question>`,
        /true-false Question must have exactly one correct Option/,
      ],
      [
        `<Question type="true-false"><Prompt>Q</Prompt><Option value="t" correct/><Option value="f" correct/></Question>`,
        /true-false Question must have exactly one correct Option/,
      ],
      [
        `<Question type="multiple-choice"><Prompt>Q</Prompt><Option/><Option value="y" correct/></Question>`,
        /"value" must be a non-empty string/,
      ],
    ] as const;
    for (const [content, error] of cases) {
      const root = await makeLesson(content);
      await expect(parsePackage(root)).rejects.toThrow(error);
      await rm(root, { recursive: true, force: true });
      temp = '';
    }
  });

  it('accepts valid multiple-choice and true-false questions', async () => {
    const root = await makeLesson(
      `<Question type="multiple-choice"><Prompt>Choose all</Prompt><Option value="a" correct={true}>A</Option><Option value="b" correct={false}>B</Option><Option value="c" correct={true}>C</Option></Question>\n` +
        `<Question type="true-false"><Prompt>It is true</Prompt><Option value="true" correct={true}>True</Option><Option value="false" correct={false}>False</Option></Question>`,
    );
    expect(await lessonContent(root)).toMatchObject([
      {
        type: 'question',
        questionType: 'multiple-choice',
        options: [{ correct: true }, { correct: false }, { correct: true }],
      },
      {
        type: 'question',
        questionType: 'true-false',
        options: [{ correct: true }, { correct: false }],
      },
    ]);
  });

  it('rejects standalone Prompt, Option, and Step, unknown components, and invalid inline blocks', async () => {
    for (const [content, error] of [
      ['<Prompt>Text</Prompt>', /unknown MDX component <Prompt>/],
      ['<Option value="x">Text</Option>', /unknown MDX component <Option>/],
      ['<Step>Text</Step>', /unknown MDX component <Step>/],
      ['<Mystery />', /unknown MDX component <Mystery>/],
      [
        'Before <Callout type="info">Nope</Callout> after.',
        /component <Callout> is block-only and cannot be used inline/,
      ],
    ] as const) {
      const root = await makeLesson(content);
      await expect(parsePackage(root)).rejects.toThrow(error);
      await rm(root, { recursive: true, force: true });
      temp = '';
    }
  });

  it('rejects unknown attributes, dynamic values, and invalid semantic variants', async () => {
    for (const [content, error] of [
      ['<Image src="x" alt="" extra="no" />', /unknown attribute "extra"/],
      ['<Image src="x" />', /explicit string "alt" attribute/],
      ['<Video src="x" autoplay />', /unknown attribute "autoplay"/],
      ['<Video title="Missing source" />', /"src" must be a non-empty string/],
      ['<Callout type="success">Hi</Callout>', /Callout "type" must be/],
      [
        '<Example dynamic={someValue}>Hi</Example>',
        /dynamic value for attribute "dynamic" is not supported/,
      ],
      [
        '<Image src="x" alt="" {...props} />',
        /spread\/dynamic component attributes are not supported/,
      ],
      [
        '<Question type="unsupported"><Prompt>Q</Prompt><Option value="a"/><Option value="b"/></Question>',
        /Question "type" must be/,
      ],
    ] as const) {
      const root = await makeLesson(content);
      await expect(parsePackage(root)).rejects.toThrow(error);
      await rm(root, { recursive: true, force: true });
      temp = '';
    }
  });

  it('enforces Steps children and minimum count', async () => {
    for (const [content, error] of [
      ['<Steps />', /Steps must contain at least one Step/],
      [
        '<Steps><p>Not a step</p></Steps>',
        /Steps may contain only <Step> components/,
      ],
      ['<Steps><Step foo="x">Text</Step></Steps>', /unknown attribute "foo"/],
    ] as const) {
      const root = await makeLesson(content);
      await expect(parsePackage(root)).rejects.toThrow(error);
      await rm(root, { recursive: true, force: true });
      temp = '';
    }
  });

  it('resolves all local assets relative to the declaring file and rejects missing assets', async () => {
    const root = await makeLesson(
      `![missing](assets/missing.svg)\n\n<Video src="media/video.mp4" poster="assets/poster.svg" captions="assets/captions.vtt" />`,
    );
    await expect(parsePackage(root)).rejects.toThrow(
      /asset "assets\/missing\.svg" does not exist/,
    );
    await asset(root, 'assets/missing.svg');
    await expect(parsePackage(root)).rejects.toThrow(
      /asset "media\/video\.mp4" does not exist/,
    );
  });

  it('rejects unsupported Markdown nodes and MDX imports with locations', async () => {
    const root = await makeLesson('<span>Unsupported raw HTML</span>');
    await expect(parsePackage(root)).rejects.toThrow(
      /lesson\.mdx:\d+: unknown MDX component <span>/,
    );
    await writeFile(
      path.join(root, 'lesson.mdx'),
      '---\ntitle: Lesson\n---\nimport Video from "./Video";',
    );
    await expect(parsePackage(root)).rejects.toThrow(
      /MDX JavaScript and imports are not supported/,
    );
  });

  it('parses package sections and retains package/item frontmatter metadata', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'content-package-'));
    temp = root;
    await mkdir(path.join(root, 'lessons'));
    await writeFile(
      path.join(root, 'index.mdx'),
      `---\ntitle: TypeScript\ndescription: Learn the basics\n---\n<Item src="lessons/intro.mdx" />\n<Section title="Practice" layout="grid" columns={2}><Item src="lessons/quiz.mdx" open="modal" /></Section>`,
    );
    await writeFile(
      path.join(root, 'lessons/intro.mdx'),
      '---\ntitle: Intro\ndescription: First lesson\n---\n# Hello',
    );
    await writeFile(
      path.join(root, 'lessons/quiz.mdx'),
      '---\ntitle: Quiz\n---',
    );
    const parsed = await parsePackage(root);
    expect(parsed.metadata).toEqual({
      title: 'TypeScript',
      description: 'Learn the basics',
    });
    expect(parsed.children).toMatchObject([
      {
        type: 'item',
        source: 'lessons/intro.mdx',
        metadata: { title: 'Intro', description: 'First lesson' },
      },
      {
        type: 'section',
        presentation: { layout: 'grid', columns: 2 },
        children: [{ presentation: { open: 'modal' } }],
      },
    ]);
  });
});
