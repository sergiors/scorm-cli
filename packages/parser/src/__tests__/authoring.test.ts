import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import * as authoring from 'scorm-cli/authoring';
import type {
  AuthoringComponentName,
  GridProps,
  OptionProps,
  PageProps,
  QuestionProps,
  QuestionType,
  ScrollProps,
} from 'scorm-cli/authoring';
import { authoringComponentNames, parsePackage } from '../index';

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(
    temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function makePackage(entry: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'authoring-package-'));
  temps.push(root);
  await writeFile(path.join(root, 'index.mdx'), entry);
  return root;
}

/** Builds a package whose root is `entry` and writes `lesson.mdx` content. */
async function scrollPackage(entry: string, lesson = ''): Promise<string> {
  const root = await makePackage(`---\ntitle: Package\n---\n${entry}`);
  await writeFile(
    path.join(root, 'lesson.mdx'),
    `---\ntitle: Lesson\n---${lesson ? `\n${lesson}` : ''}`,
  );
  return root;
}

const canonicalScroll = `---\ntitle: Package\n---\n<Scroll>\n  <Page src='lesson.mdx' />\n</Scroll>`;

describe('scorm-cli/authoring', () => {
  it('exports every canonical marker as a stub that throws when executed', () => {
    const markers = authoring as unknown as Record<
      string,
      (props: Record<string, unknown>) => unknown
    >;
    for (const name of authoringComponentNames) {
      expect(typeof markers[name]).toBe('function');
      expect(() => markers[name]!({})).toThrowError(`<${name}>`);
    }
  });

  it('keeps exported markers aligned with the parser canonical list', () => {
    const canonical: readonly AuthoringComponentName[] =
      authoringComponentNames;
    const markers = authoring as unknown as Record<string, unknown>;
    expect(
      Object.keys(markers)
        .filter((key) => typeof markers[key] === 'function')
        .sort(),
    ).toEqual([...canonical].sort());
  });

  it('types marker props against the parser contract', () => {
    expectTypeOf<QuestionType>().toEqualTypeOf<
      'single-choice' | 'multiple-choice' | 'true-false'
    >();
    const sourcePage: PageProps = { src: 'lesson.mdx' };
    const referencePage: PageProps = { ref: 'lesson.mdx' };
    const scroll: ScrollProps = { children: null };
    const grid: GridProps = { columns: 2 };
    expect([sourcePage, referencePage, scroll, grid]).toHaveLength(4);
  });

  it('enforces authoring marker prop constraints at compile time', () => {
    // Accepted shapes compile; a bare JSX `correct` attribute passes `true`.
    const sourcePage = { src: 'lesson.mdx' } satisfies PageProps;
    const referencePage = { ref: 'lesson.mdx' } satisfies PageProps;
    const grid = { columns: 2 } satisfies GridProps;
    const singleChoice = { type: 'single-choice' } satisfies QuestionProps;
    const multipleChoice = { type: 'multiple-choice' } satisfies QuestionProps;
    const trueFalse = { type: 'true-false' } satisfies QuestionProps;
    const option = { value: 'a' } satisfies OptionProps;
    const correctOption = { value: 'a', correct: true } satisfies OptionProps;
    const incorrectOption = {
      value: 'a',
      correct: false,
    } satisfies OptionProps;

    // @ts-expect-error <Page> requires either src or ref.
    const neitherPage: PageProps = {};
    // @ts-expect-error <Page> rejects src and ref together.
    const bothPage: PageProps = { src: 'lesson.mdx', ref: 'lesson.mdx' };
    // @ts-expect-error <Grid columns> must be a number.
    const stringColumns: GridProps = { columns: '2' };
    // @ts-expect-error <Question type> must be a supported kind.
    const invalidQuestion: QuestionProps = { type: 'unsupported' };
    // @ts-expect-error <Option correct> must be a boolean.
    const stringCorrect: OptionProps = { value: 'a', correct: 'yes' };
    // @ts-expect-error <Option value> is required.
    const missingValue: OptionProps = { correct: true };

    expect([
      sourcePage,
      referencePage,
      grid,
      singleChoice,
      multipleChoice,
      trueFalse,
      option,
      correctOption,
      incorrectOption,
      neitherPage,
      bothPage,
      stringColumns,
      invalidQuestion,
      stringCorrect,
      missingValue,
    ]).toHaveLength(15);
  });

  it('declares the scorm-cli/authoring subpath for runtime and types', async () => {
    const root = JSON.parse(
      await readFile(
        new URL('../../../../package.json', import.meta.url),
        'utf8',
      ),
    ) as { name: string; exports: Record<string, unknown> };
    expect(root.name).toBe('scorm-cli');
    expect(root.exports).toEqual({
      './authoring': {
        types: './authoring/dist/index.d.ts',
        import: './authoring/dist/index.js',
      },
    });
  });
});

describe('MDX authoring imports', () => {
  it('resolves named imports and aliases to the same canonical AST', async () => {
    const imported = await scrollPackage(
      `import { Scroll as Deck, Page as Slide } from 'scorm-cli/authoring';\n\n<Deck>\n  <Slide src='lesson.mdx' />\n</Deck>`,
    );
    const plain = await makePackage(canonicalScroll);
    await writeFile(path.join(plain, 'lesson.mdx'), '---\ntitle: Lesson\n---');

    const fromImports = await parsePackage(imported);
    const fromCanonical = await parsePackage(plain);
    expect(fromImports.presentation).toEqual(fromCanonical.presentation);
    expect(fromImports.metadata).toEqual(fromCanonical.metadata);
  });

  it('supports namespace imports with member components', async () => {
    const root = await scrollPackage(
      `import * as Authoring from 'scorm-cli/authoring';\n\n<Authoring.Scroll>\n  <Authoring.Page src='lesson.mdx' />\n</Authoring.Scroll>`,
    );
    const parsed = await parsePackage(root);
    expect(parsed.presentation).toMatchObject({
      type: 'scroll',
      pages: [{ id: 'page:lesson.mdx', source: 'lesson.mdx' }],
    });
  });

  it('resolves aliases for Path and Page inside referenced documents', async () => {
    const root = await makePackage(
      `---\ntitle: Package\n---\n<Scroll>\n  <Page src='lessons/start.mdx' />\n  <Page src='lessons/next.mdx' />\n</Scroll>`,
    );
    await mkdir(path.join(root, 'lessons'));
    await writeFile(
      path.join(root, 'lessons/start.mdx'),
      `---\ntitle: Start\n---\nimport { Path as Journey, Page as Step } from 'scorm-cli/authoring';\n\n<Journey>\n  <Step ref='lessons/next.mdx' />\n</Journey>`,
    );
    await writeFile(
      path.join(root, 'lessons/next.mdx'),
      '---\ntitle: Next\n---',
    );

    const parsed = await parsePackage(root);
    const pages =
      parsed.presentation.type === 'scroll' ? parsed.presentation.pages : [];
    expect(pages[0]?.content).toEqual([
      { type: 'path', pageIds: ['page:lessons/next.mdx'] },
    ]);
  });

  it('resolves aliased root Scroll/Page declarations used by Path refs', async () => {
    const root = await makePackage(
      `---\ntitle: Package\n---\nimport { Scroll as Deck, Page as Slide } from 'scorm-cli/authoring';\n\n<Deck>\n  <Slide src='lessons/start.mdx' />\n  <Slide src='lessons/next.mdx' />\n</Deck>`,
    );
    await mkdir(path.join(root, 'lessons'));
    await writeFile(
      path.join(root, 'lessons/start.mdx'),
      `---\ntitle: Start\n---\nimport { Path, Page } from 'scorm-cli/authoring';\n\n<Path>\n  <Page ref='lessons/next.mdx' />\n</Path>`,
    );
    await writeFile(
      path.join(root, 'lessons/next.mdx'),
      '---\ntitle: Next\n---',
    );

    const parsed = await parsePackage(root);
    const pages =
      parsed.presentation.type === 'scroll' ? parsed.presentation.pages : [];
    expect(pages[0]?.content).toEqual([
      { type: 'path', pageIds: ['page:lessons/next.mdx'] },
    ]);
  });

  it('ignores unrelated imports that do not shadow authoring markers', async () => {
    const withUnrelatedImport = await scrollPackage(
      `import { Widget } from './widget';\n\n<Scroll>\n  <Page src='lesson.mdx' />\n</Scroll>`,
    );
    const parsed = await parsePackage(withUnrelatedImport);
    expect(parsed.presentation).toMatchObject({
      type: 'scroll',
      pages: [{ id: 'page:lesson.mdx' }],
    });

    const unknownComponent = await scrollPackage(
      `<Scroll>\n  <Page src='lesson.mdx' />\n</Scroll>`,
      `import { Widget } from './widget';\n\n<Widget />`,
    );
    await expect(parsePackage(unknownComponent)).rejects.toThrow(
      /unknown MDX component <Widget>/,
    );
  });

  it('gives imported aliases precedence over canonical names', async () => {
    const root = await makePackage(
      `---\ntitle: Package\n---\nimport { Grid as Scroll } from 'scorm-cli/authoring';\n\n<Scroll>\n  <Item src='lesson.mdx' />\n</Scroll>`,
    );
    await writeFile(path.join(root, 'lesson.mdx'), '---\ntitle: Lesson\n---');
    const parsed = await parsePackage(root);
    expect(parsed.presentation).toMatchObject({
      type: 'grid',
      items: [{ id: 'item:lesson.mdx' }],
    });
  });

  it('does not resolve Scroll/Page shadowed by same-name unrelated imports', async () => {
    const shadowedScroll = await scrollPackage(
      `import { Scroll } from './my-components';\n\n<Scroll>\n  <Page src='lesson.mdx' />\n</Scroll>`,
    );
    await expect(parsePackage(shadowedScroll)).rejects.toThrow(
      /root must contain exactly one <Scroll> or <Grid> presentation/,
    );

    const shadowedPage = await scrollPackage(
      `import { Page } from './my-components';\n\n<Scroll>\n  <Page src='lesson.mdx' />\n</Scroll>`,
    );
    await expect(parsePackage(shadowedPage)).rejects.toThrow(
      /children may only contain direct <Page/,
    );
  });

  it('shadows canonical names bound by default and namespace imports', async () => {
    const defaultScroll = await scrollPackage(
      `import Scroll from './my-components';\n\n<Scroll>\n  <Page src='lesson.mdx' />\n</Scroll>`,
    );
    await expect(parsePackage(defaultScroll)).rejects.toThrow(
      /root must contain exactly one <Scroll> or <Grid> presentation/,
    );

    const namespaceScroll = await scrollPackage(
      `import * as Scroll from './my-components';\n\n<Scroll>\n  <Page src='lesson.mdx' />\n</Scroll>`,
    );
    await expect(parsePackage(namespaceScroll)).rejects.toThrow(
      /root must contain exactly one <Scroll> or <Grid> presentation/,
    );
  });

  it('rejects unknown authoring markers and default imports', async () => {
    const unknown = await makePackage(
      `---\ntitle: Package\n---\nimport { Card } from 'scorm-cli/authoring';\n\n<Scroll>\n  <Page src='lesson.mdx' />\n</Scroll>`,
    );
    await expect(parsePackage(unknown)).rejects.toThrow(
      /"Card" is not an authoring component/,
    );

    const noDefault = await makePackage(
      `---\ntitle: Package\n---\nimport Authoring from 'scorm-cli/authoring';\n\n<Scroll>\n  <Page src='lesson.mdx' />\n</Scroll>`,
    );
    await expect(parsePackage(noDefault)).rejects.toThrow(
      /provides named exports only/,
    );
  });

  it('applies canonical validation to aliased components', async () => {
    const missing = await makePackage(
      `---\ntitle: Package\n---\nimport { Scroll as Deck, Page as Slide } from 'scorm-cli/authoring';\n\n<Deck>\n  <Slide src='missing.mdx' />\n</Deck>`,
    );
    await expect(parsePackage(missing)).rejects.toThrow(
      /Page source "missing\.mdx" does not exist/,
    );

    const badAttribute = await makePackage(
      `---\ntitle: Package\n---\nimport { Scroll, Page as Slide } from 'scorm-cli/authoring';\n\n<Scroll>\n  <Slide src='lesson.mdx' title='nope' />\n</Scroll>`,
    );
    await writeFile(
      path.join(badAttribute, 'lesson.mdx'),
      '---\ntitle: Lesson\n---',
    );
    await expect(parsePackage(badAttribute)).rejects.toThrow(
      /unknown attribute "title"/,
    );
  });

  it('still rejects non-import MDX JavaScript', async () => {
    const root = await scrollPackage(
      `<Scroll>\n  <Page src='lesson.mdx' />\n</Scroll>`,
      `export const runtime = 'edge';`,
    );
    await expect(parsePackage(root)).rejects.toThrow(
      /MDX JavaScript is not supported/,
    );
  });

  it('rejects local component declarations instead of parsing them as canonical', async () => {
    const localFunction = await scrollPackage(
      `<Scroll>\n  <Page src='lesson.mdx' />\n</Scroll>`,
      `export function Scroll() {}\n\n<Scroll />`,
    );
    await expect(parsePackage(localFunction)).rejects.toThrow(
      /MDX JavaScript is not supported/,
    );

    const localConst = await scrollPackage(
      `<Scroll>\n  <Page src='lesson.mdx' />\n</Scroll>`,
      `const Page = () => null;\n\n<Page src='lesson.mdx' />`,
    );
    await expect(parsePackage(localConst)).rejects.toThrow(
      /unknown MDX component <Page>/,
    );
  });
});
