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
    `---\ntitle: Package\n---\n<Scroll><Page src="lesson.mdx" /></Scroll>`,
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
  if (contentPackage.presentation.type !== 'scroll')
    throw new Error('Expected a scroll presentation');
  const page = contentPackage.presentation.pages[0];
  if (!page) throw new Error('Expected a page');
  return page.content;
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

  it('parses semantic video with poster and captions', async () => {
    const root = await makeLesson(
      `<Video src="https://cdn.example.test/lesson.mp4" title="Lesson" poster="assets/poster.svg" captions="assets/captions.vtt" />\n\n` +
        `## Next steps\n\nUse **types** to model your data.\n\n- Describe each value\n- Let the editor check usage\n\n\`\`\`ts\nconst x: number = 1;\n\`\`\``,
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
        type: 'heading',
        depth: 2,
        children: [{ type: 'text', value: 'Next steps' }],
      },
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Use ' },
          { type: 'strong', children: [{ type: 'text', value: 'types' }] },
          { type: 'text', value: ' to model your data.' },
        ],
      },
      {
        type: 'list',
        ordered: false,
        items: [
          {
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'Describe each value' }],
              },
            ],
          },
          {
            children: [
              {
                type: 'paragraph',
                children: [
                  { type: 'text', value: 'Let the editor check usage' },
                ],
              },
            ],
          },
        ],
      },
      { type: 'code', value: 'const x: number = 1;', language: 'ts' },
    ]);
  });

  it('parses rich question prompts and options and preserves boolean false', async () => {
    const root = await makeLesson(
      `<Questionnaire>\n<Question type="single-choice">\n` +
        `  <Prompt>\nWhat does \`string\` represent?\n\nChoose **one**.\n</Prompt>\n` +
        `  <Option value="number" correct={false}>\nA *numeric* value\n\n\`\`\`\n42\n\`\`\`\n</Option>\n` +
        `  <Option value="text" correct={true}>\nText\n\n\`\`\`\n"hello"\n\`\`\`\n</Option>\n` +
        `</Question>\n</Questionnaire>`,
    );
    expect(await lessonContent(root)).toEqual([
      {
        type: 'questionnaire',
        id: 'questionnaire:lesson.mdx:4:1',
        questions: [
          {
            type: 'question',
            id: 'question:lesson.mdx:5:1',
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
                  {
                    type: 'strong',
                    children: [{ type: 'text', value: 'one' }],
                  },
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
        `<Questionnaire><Question type="single-choice">${inside}</Question></Questionnaire>`,
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
        `<Questionnaire><Question type="single-choice"><Prompt>Q</Prompt><Option value="x"/><Option value="y"/></Question></Questionnaire>`,
        /single-choice Question must have exactly one correct Option/,
      ],
      [
        `<Questionnaire><Question type="single-choice"><Prompt>Q</Prompt><Option value="x" correct/><Option value="x"/></Question></Questionnaire>`,
        /Option value "x" must be unique/,
      ],
      [
        `<Questionnaire><Question type="multiple-choice"><Prompt>Q</Prompt><Option value="x"/><Option value="y"/></Question></Questionnaire>`,
        /multiple-choice Question must have at least one correct Option/,
      ],
      [
        `<Questionnaire><Question type="true-false"><Prompt>Q</Prompt><Option value="t" correct/><Option value="f"/><Option value="m"/></Question></Questionnaire>`,
        /true-false Question must have exactly 2 Options/,
      ],
      [
        `<Questionnaire><Question type="true-false"><Prompt>Q</Prompt><Option value="t"/><Option value="f"/></Question></Questionnaire>`,
        /true-false Question must have exactly one correct Option/,
      ],
      [
        `<Questionnaire><Question type="true-false"><Prompt>Q</Prompt><Option value="t" correct/><Option value="f" correct/></Question></Questionnaire>`,
        /true-false Question must have exactly one correct Option/,
      ],
      [
        `<Questionnaire><Question type="multiple-choice"><Prompt>Q</Prompt><Option/><Option value="y" correct/></Question></Questionnaire>`,
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
      `<Questionnaire>\n<Question type="multiple-choice"><Prompt>Choose all</Prompt><Option value="a" correct={true}>A</Option><Option value="b" correct={false}>B</Option><Option value="c" correct={true}>C</Option></Question>\n` +
        `<Question type="true-false"><Prompt>It is true</Prompt><Option value="true" correct={true}>True</Option><Option value="false" correct={false}>False</Option></Question>\n</Questionnaire>`,
    );
    expect(await lessonContent(root)).toMatchObject([
      {
        type: 'questionnaire',
        questions: [
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
        ],
      },
    ]);
  });

  it('requires a non-empty questionnaire containing only direct Questions', async () => {
    for (const [content, error] of [
      [
        '<Questionnaire />',
        /Questionnaire must contain at least one direct <Question>/,
      ],
      [
        '<Questionnaire title="Quiz"><Question /></Questionnaire>',
        /unknown attribute "title"/,
      ],
      [
        '<Questionnaire><Video src="missing.mp4" /></Questionnaire>',
        /Questionnaire may contain only direct <Question> children; found <Video>/,
      ],
      [
        '<Questionnaire>stray text</Questionnaire>',
        /Questionnaire may contain only direct <Question> children/,
      ],
    ] as const) {
      const root = await makeLesson(content);
      await expect(parsePackage(root)).rejects.toThrow(error);
      await rm(root, { recursive: true, force: true });
      temp = '';
    }
  });

  it('rejects standalone Questions with a source-located wrapper hint', async () => {
    for (const content of [
      '<Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question>',
      'Inline <Question type="single-choice" /> is not supported.',
    ]) {
      const root = await makeLesson(content);
      await expect(parsePackage(root)).rejects.toThrow(
        /lesson\.mdx:\d+: <Question> must be inside <Questionnaire>/,
      );
      await rm(root, { recursive: true, force: true });
      temp = '';
    }
  });

  it('keeps questionnaire and question ids stable across package directories', async () => {
    const source =
      '<Questionnaire><Question type="single-choice"><Prompt>Q</Prompt><Option value="a" correct/><Option value="b"/></Question></Questionnaire>';
    const firstRoot = await makeLesson(source);
    const firstContent = await lessonContent(firstRoot);
    const firstId =
      firstContent[0]?.type === 'questionnaire' ? firstContent[0].id : '';
    const firstQuestionId =
      firstContent[0]?.type === 'questionnaire'
        ? firstContent[0].questions[0]?.id
        : '';
    await rm(firstRoot, { recursive: true, force: true });

    const secondRoot = await makeLesson(source);
    const secondContent = await lessonContent(secondRoot);
    const secondId =
      secondContent[0]?.type === 'questionnaire' ? secondContent[0].id : '';
    const secondQuestionId =
      secondContent[0]?.type === 'questionnaire'
        ? secondContent[0].questions[0]?.id
        : '';

    expect(firstId).toBe('questionnaire:lesson.mdx:4:1');
    expect(secondId).toBe(firstId);
    expect(firstQuestionId).toBe('question:lesson.mdx:4:16');
    expect(secondQuestionId).toBe(firstQuestionId);
  });

  it('collects assets nested in questionnaire prompts and options', async () => {
    const root = await makeLesson(
      '<Questionnaire><Question type="single-choice"><Prompt>Pick the diagram <Image src="assets/prompt.svg" alt="Prompt" /></Prompt><Option value="a" correct><Image src="assets/option.svg" alt="Option" /></Option><Option value="b">Text</Option></Question></Questionnaire>',
    );
    await asset(root, 'assets/prompt.svg');
    await asset(root, 'assets/option.svg');
    const content = await lessonContent(root);
    expect(content).toMatchObject([
      {
        type: 'questionnaire',
        questions: [
          {
            prompt: [
              {
                type: 'paragraph',
                children: [
                  { type: 'text', value: 'Pick the diagram ' },
                  { type: 'image', src: 'assets/prompt.svg', alt: 'Prompt' },
                ],
              },
            ],
            options: [
              {
                content: [
                  {
                    type: 'paragraph',
                    children: [
                      {
                        type: 'image',
                        src: 'assets/option.svg',
                        alt: 'Option',
                      },
                    ],
                  },
                ],
              },
              {
                content: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'Text' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it('rejects standalone Prompt, Option, and removed or unknown components', async () => {
    for (const [content, error] of [
      ['<Prompt>Text</Prompt>', /unknown MDX component <Prompt>/],
      ['<Option value="x">Text</Option>', /unknown MDX component <Option>/],
      [
        '<Callout type="info">Text</Callout>',
        /unknown MDX component <Callout>/,
      ],
      ['<Example>Text</Example>', /unknown MDX component <Example>/],
      ['<Steps><Step>Text</Step></Steps>', /unknown MDX component <Steps>/],
      ['<Step>Text</Step>', /unknown MDX component <Step>/],
      ['<Mystery />', /unknown MDX component <Mystery>/],
      [
        'Before <Example>Nope</Example> after.',
        /unknown MDX component <Example>/,
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
      [
        '<Image src="x" alt="" {...props} />',
        /spread\/dynamic component attributes are not supported/,
      ],
      [
        '<Questionnaire><Question type="unsupported"><Prompt>Q</Prompt><Option value="a"/><Option value="b"/></Question></Questionnaire>',
        /Question "type" must be/,
      ],
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

  it('parses Scroll Pages and Grid Items as distinct root modes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'content-package-'));
    temp = root;
    await mkdir(path.join(root, 'lessons'));
    await writeFile(
      path.join(root, 'index.mdx'),
      `---\ntitle: TypeScript\n---\n<Scroll>\n  <Page src="lessons/intro.mdx" />\n  <Page src="lessons/quiz.mdx" />\n</Scroll>`,
    );
    await writeFile(
      path.join(root, 'lessons/intro.mdx'),
      '---\ntitle: Intro\n---\n# Hello',
    );
    await writeFile(
      path.join(root, 'lessons/quiz.mdx'),
      '---\ntitle: Quiz\n---',
    );
    const parsedScroll = await parsePackage(root);
    expect(parsedScroll.metadata).toEqual({ title: 'TypeScript' });
    expect(parsedScroll.presentation).toMatchObject({
      type: 'scroll',
      pages: [
        {
          type: 'page',
          source: 'lessons/intro.mdx',
          id: 'page:lessons/intro.mdx',
          metadata: { title: 'Intro' },
        },
        {
          type: 'page',
          source: 'lessons/quiz.mdx',
          id: 'page:lessons/quiz.mdx',
          metadata: { title: 'Quiz' },
        },
      ],
    });

    await writeFile(
      path.join(root, 'index.mdx'),
      `---\ntitle: Practice\n---\n<Grid columns={2}><Item src="lessons/intro.mdx" /><Item src="lessons/quiz.mdx" /></Grid>`,
    );
    const parsedGrid = await parsePackage(root);
    expect(parsedGrid.presentation).toMatchObject({
      type: 'grid',
      columns: 2,
      items: [
        {
          type: 'item',
          source: 'lessons/intro.mdx',
          id: 'item:lessons/intro.mdx',
        },
        {
          type: 'item',
          source: 'lessons/quiz.mdx',
          id: 'item:lessons/quiz.mdx',
        },
      ],
    });
    await writeFile(
      path.join(root, 'index.mdx'),
      '---\ntitle: Practice\n---\n<Grid><Item src="lessons/intro.mdx" /></Grid>',
    );
    const defaultGrid = (await parsePackage(root)).presentation;
    expect(defaultGrid.type).toBe('grid');
    if (defaultGrid.type === 'grid')
      expect(defaultGrid).not.toHaveProperty('columns');
  });

  it('requires exactly one supported root presentation and a root title', async () => {
    for (const [source, error] of [
      [
        '---\ntitle: Package\n---\n',
        /exactly one <Scroll> or <Grid> presentation; found 0/,
      ],
      [
        '---\ntitle: Package\n---\n<Grid><Item src="a.mdx" /></Grid><Scroll><Page src="a.mdx" /></Scroll>',
        /exactly one <Scroll> or <Grid> presentation; found 2/,
      ],
      [
        '---\ntitle: Package\n---\n<Item src="a.mdx" />',
        /exactly one <Scroll> or <Grid> presentation; found 1 direct node \(<Item>\)/,
      ],
      [
        '---\ntitle: Package\n---\n<Page src="a.mdx" />',
        /exactly one <Scroll> or <Grid> presentation; found 1 direct node \(<Page>\)/,
      ],
      [
        '---\ntitle: Package\n---\nA root paragraph is not allowed.',
        /exactly one <Scroll> or <Grid> presentation; found 1 direct node \(paragraph\)/,
      ],
      [
        '---\n---\n<Scroll><Page src="a.mdx" /></Scroll>',
        /"title" must be a non-empty string/,
      ],
      [
        '---\ntitle: Package\ndescription: Not supported\n---\n<Scroll><Page src="a.mdx" /></Scroll>',
        /unknown frontmatter field "description"/,
      ],
    ] as const) {
      const root = await makePackage(source);
      await expect(parsePackage(root)).rejects.toThrow(error);
      await rm(root, { recursive: true, force: true });
      temp = '';
    }
  });

  it('validates presentation children, nesting, attributes, and Grid columns', async () => {
    for (const [rootContent, error] of [
      [
        '<Scroll><Item src="a.mdx" /></Scroll>',
        /Scroll> children may only contain direct <Page/,
      ],
      [
        '<Grid><Page src="a.mdx" /></Grid>',
        /Grid> children may only contain direct <Item/,
      ],
      [
        '<Scroll title="bad"><Page src="a.mdx" /></Scroll>',
        /unknown attribute "title"/,
      ],
      [
        '<Grid rows={2}><Item src="a.mdx" /></Grid>',
        /unknown attribute "rows"/,
      ],
      [
        '<Grid columns={0}><Item src="a.mdx" /></Grid>',
        /columns.*integer from 1 to 12/,
      ],
      [
        '<Grid columns={13}><Item src="a.mdx" /></Grid>',
        /columns.*integer from 1 to 12/,
      ],
      [
        '<Grid columns="2"><Item src="a.mdx" /></Grid>',
        /columns.*integer from 1 to 12/,
      ],
      [
        '<Scroll><Page src="a.mdx"><Item src="b.mdx" /></Page></Scroll>',
        /Page> must be self-closing/,
      ],
      [
        '<Scroll><Scroll><Page src="a.mdx" /></Scroll></Scroll>',
        /Scroll> children may only contain direct <Page/,
      ],
      ['<Scroll />', /Scroll> must contain at least one <Page>; found 0/],
      ['<Grid />', /Grid> must contain at least one <Item>; found 0/],
    ] as const) {
      const root = await makePackage(
        `---\ntitle: Package\n---\n${rootContent}`,
      );
      await expect(parsePackage(root)).rejects.toThrow(error);
      await rm(root, { recursive: true, force: true });
      temp = '';
    }
  });

  it('resolves references and assets relative to each source file', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'content-package-'));
    temp = root;
    await mkdir(path.join(root, 'lessons'), { recursive: true });
    await asset(root, 'assets/shared.svg');
    await writeFile(
      path.join(root, 'index.mdx'),
      '---\ntitle: Package\n---\n<Scroll><Page src="lessons/page.mdx" /></Scroll>',
    );
    await writeFile(
      path.join(root, 'lessons/page.mdx'),
      '---\ntitle: Page\n---\n![shared](../assets/shared.svg)',
    );
    const pagePackage = await parsePackage(root);
    expect(pagePackage.presentation).toMatchObject({
      type: 'scroll',
      pages: [
        {
          id: 'page:lessons/page.mdx',
          source: 'lessons/page.mdx',
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'image', src: 'assets/shared.svg' }],
            },
          ],
        },
      ],
    });
    await writeFile(
      path.join(root, 'index.mdx'),
      '---\ntitle: Package\n---\n<Grid><Item src="lessons/page.mdx" /></Grid>',
    );
    expect((await parsePackage(root)).presentation).toMatchObject({
      type: 'grid',
      items: [{ id: 'item:lessons/page.mdx', source: 'lessons/page.mdx' }],
    });
  });

  it('rejects description, thumbnail, and id frontmatter on referenced docs', async () => {
    for (const kind of ['page', 'item'] as const) {
      for (const field of [
        'description: Not supported',
        'thumbnail: cover.svg',
        'id: custom',
      ]) {
        const reference =
          kind === 'page'
            ? '<Scroll><Page src="lesson.mdx" /></Scroll>'
            : '<Grid><Item src="lesson.mdx" /></Grid>';
        const root = await makePackage(
          `---\ntitle: Package\n---\n${reference}`,
        );
        await writeFile(
          path.join(root, 'lesson.mdx'),
          `---\ntitle: Lesson\n${field}\n---`,
        );
        await expect(parsePackage(root)).rejects.toThrow(
          /unknown frontmatter field/,
        );
        await rm(root, { recursive: true, force: true });
        temp = '';
      }
    }
  });
});
