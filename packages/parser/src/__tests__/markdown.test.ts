import { describe, expect, it } from 'vitest';
import type { AstNode } from '../ast';
import { parseContentNodes } from '../content';
import {
  isMarkdownBlock,
  isMarkdownInline,
  markdownBlockTypes,
  markdownInlineTypes,
} from '../markdown';
import { parseMdx } from '../mdx';

const text = (value: string): AstNode => ({ type: 'text', value });
const paragraph = (...children: AstNode[]): AstNode => ({ type: 'paragraph', children });

function parse(node: AstNode) {
  return parseContentNodes(node, 'lesson.mdx', '/package');
}

describe('standard Markdown vocabulary', () => {
  it('recognizes exactly the supported inline and block node types', () => {
    expect([...markdownInlineTypes]).toEqual([
      'text',
      'emphasis',
      'strong',
      'inlineCode',
      'link',
      'image',
      'break',
    ]);
    expect([...markdownBlockTypes]).toEqual([
      'heading',
      'paragraph',
      'thematicBreak',
      'list',
      'code',
      'blockquote',
    ]);
    for (const type of markdownInlineTypes) expect(isMarkdownInline({ type })).toBe(true);
    for (const type of markdownBlockTypes) expect(isMarkdownBlock({ type })).toBe(true);
    // A thematic break is a block, never inline syntax.
    expect(isMarkdownInline({ type: 'thematicBreak' })).toBe(false);
    expect(isMarkdownBlock({ type: 'thematicBreak' })).toBe(true);
    // Paragraphs are block vocabulary owned by the block dispatch.
    expect(isMarkdownBlock({ type: 'paragraph' })).toBe(true);
    expect(isMarkdownBlock({ type: 'image' })).toBe(false);
  });
});

describe('Markdown dispatch', () => {
  it('converts headings, links and nested formatting', async () => {
    const heading: AstNode = {
      type: 'heading',
      depth: 2,
      children: [
        text('See '),
        {
          type: 'link',
          url: 'https://example.test',
          children: [{ type: 'strong', children: [text('docs')] }],
        },
      ],
    };

    expect(await parse(heading)).toEqual([
      {
        type: 'heading',
        depth: 2,
        children: [
          { type: 'text', value: 'See ' },
          {
            type: 'link',
            href: 'https://example.test',
            children: [{ type: 'strong', children: [{ type: 'text', value: 'docs' }] }],
          },
        ],
      },
    ]);
  });

  it('wraps a lone inline node in a paragraph', async () => {
    expect(await parse({ type: 'inlineCode', value: 'x' })).toEqual([
      { type: 'paragraph', children: [{ type: 'inlineCode', value: 'x' }] },
    ]);
  });

  it('converts fenced code with its language', async () => {
    expect(await parse({ type: 'code', value: 'const x = 1;', lang: 'ts' })).toEqual([
      { type: 'code', value: 'const x = 1;', language: 'ts' },
    ]);
  });

  it('normalizes tight list items to inlineContent and keeps loose paragraphs', async () => {
    const tight: AstNode = {
      type: 'list',
      ordered: false,
      spread: false,
      children: [{ type: 'listItem', children: [paragraph(text('one'))] }],
    };
    const loose: AstNode = {
      type: 'list',
      ordered: false,
      spread: true,
      children: [{ type: 'listItem', children: [paragraph(text('one'))] }],
    };

    expect(await parse(tight)).toEqual([
      {
        type: 'list',
        ordered: false,
        spread: false,
        items: [
          { children: [{ type: 'inlineContent', children: [{ type: 'text', value: 'one' }] }] },
        ],
      },
    ]);
    expect(await parse(loose)).toEqual([
      {
        type: 'list',
        ordered: false,
        spread: true,
        items: [{ children: [{ type: 'paragraph', children: [{ type: 'text', value: 'one' }] }] }],
      },
    ]);
  });

  it('converts blockquotes through the shared sibling converter', async () => {
    const quote: AstNode = {
      type: 'blockquote',
      children: [paragraph(text('A quote')), { type: 'code', value: 'x' }],
    };
    expect(await parse(quote)).toEqual([
      {
        type: 'quote',
        children: [
          { type: 'paragraph', children: [{ type: 'text', value: 'A quote' }] },
          { type: 'code', value: 'x' },
        ],
      },
    ]);
  });

  it('splits paragraphs around block components without an asset read', async () => {
    // A block-only component adjacent to text is reported as inline misuse
    // before any media handler runs.
    const node = paragraph(text('before '), { type: 'mdxJsxTextElement', name: 'Video' });
    await expect(parse(node)).rejects.toThrow(
      /component <Video> is block-only and cannot be used inline/,
    );
  });
});

describe('standard Markdown thematic breaks', () => {
  it('converts a thematic break to a canonical node', async () => {
    const { children } = parseMdx('Before\n\n---\n\nAfter', 'lesson.mdx');
    const thematicBreak = children.find((node) => node.type === 'thematicBreak');
    expect(thematicBreak).toBeDefined();
    expect(await parseContentNodes(thematicBreak!, 'lesson.mdx', '/package')).toEqual([
      { type: 'thematicBreak' },
    ]);
  });
});

describe('unknown Markdown syntax', () => {
  it('rejects unrecognized Markdown nodes instead of dropping them', async () => {
    const node: AstNode = { type: 'html', value: '<b>x</b>', position: { start: { line: 5 } } };
    await expect(parse(node)).rejects.toThrow(/lesson\.mdx:5: unsupported content node "html"/);
  });

  it('rejects inline nodes the Markdown dispatcher does not own', async () => {
    const node = paragraph({ type: 'mystery' });
    await expect(parse(node)).rejects.toThrow(/unsupported inline node "mystery"/);
  });

  it('rejects MDX JavaScript with a source-aware error', async () => {
    const node: AstNode = {
      type: 'blockquote',
      children: [{ type: 'mdxjsEsm', value: 'export const x = 1;' }],
    };
    await expect(parse(node)).rejects.toThrow(/MDX JavaScript is not supported/);
  });
});
