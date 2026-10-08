import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContentRenderer } from '../app/components/ContentRenderer';
import { InlineContent } from '../app/components/InlineContent';
import type { ContentNode, InlineNode } from '../app/types';
import { multipleChoiceQuestion, singleChoiceQuestion } from './fixtures';

function render(nodes: ContentNode[], headingOffset?: number): string {
  return renderToStaticMarkup(
    <ContentRenderer nodes={nodes} headingOffset={headingOffset} />,
  );
}

function renderInline(nodes: InlineNode[]): string {
  return renderToStaticMarkup(<InlineContent nodes={nodes} />);
}

describe('ContentRenderer headings', () => {
  it('renders headings at the source depth with inline children', () => {
    const html = render([
      {
        type: 'heading',
        depth: 2,
        children: [
          { type: 'text', value: 'Welcome ' },
          { type: 'strong', children: [{ type: 'text', value: 'back' }] },
        ],
      },
    ]);
    expect(html).toContain('<h2');
    expect(html).toContain('Welcome ');
    expect(html).toContain('<strong');
    expect(html).toContain('back');
  });

  it('applies a heading offset so content nests under package headings', () => {
    expect(
      render(
        [
          {
            type: 'heading',
            depth: 1,
            children: [{ type: 'text', value: 'Deep' }],
          },
        ],
        2,
      ),
    ).toContain('<h3');
  });

  it('clamps heading depth to the 1-6 range', () => {
    expect(
      render([
        {
          type: 'heading',
          depth: 9,
          children: [{ type: 'text', value: 'Big' }],
        },
      ]),
    ).toContain('<h6');
    expect(
      render([
        {
          type: 'heading',
          depth: 0,
          children: [{ type: 'text', value: 'Small' }],
        },
      ]),
    ).toContain('<h1');
  });
});

describe('ContentRenderer paragraphs and inline semantics', () => {
  it('renders an inline sequence without flattening it into a string', () => {
    const html = render([
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'See ' },
          { type: 'emphasis', children: [{ type: 'text', value: 'this' }] },
          { type: 'text', value: ', ' },
          { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
          { type: 'text', value: ', ' },
          { type: 'inlineCode', value: 'run()' },
          { type: 'break' },
          { type: 'text', value: 'after' },
        ],
      },
    ]);
    expect(html).toContain('<p');
    expect(html).toContain('<em');
    expect(html).toContain('<strong');
    expect(html).toContain('<code');
    expect(html).toContain('<br');
    expect(html).toContain('See ');
    expect(html).toContain('after');
  });

  it('marks external links and leaves internal links alone', () => {
    const external = renderInline([
      {
        type: 'link',
        href: 'https://example.com',
        children: [{ type: 'text', value: 'Docs' }],
      },
    ]);
    expect(external).toContain('href="https://example.com"');
    expect(external).toContain('target="_blank"');
    expect(external).toContain('rel="noreferrer noopener"');
    expect(external).toContain('Docs');

    const internal = renderInline([
      {
        type: 'link',
        href: './other.mdx',
        children: [{ type: 'text', value: 'Other' }],
      },
    ]);
    expect(internal).not.toContain('target=');
    expect(internal).not.toContain('rel=');
  });

  it('renders Markdown inline images in flow instead of a figure block', () => {
    const html = render([
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'before ' },
          { type: 'image', src: './inline.svg', alt: 'Inline icon' },
          { type: 'text', value: ' after' },
        ],
      },
    ]);
    expect(html).toContain('<img');
    expect(html).toContain('src="./inline.svg"');
    expect(html).toContain('alt="Inline icon"');
    expect(html).not.toContain('<figure');
    expect(html).not.toContain('<figcaption');
  });

  it('renders an inline image caption inside an inline span', () => {
    const html = renderInline([
      { type: 'image', src: './a.png', alt: 'A', caption: 'An icon' },
    ]);
    expect(html).toContain('<span');
    expect(html).toContain('An icon');
    expect(html).not.toContain('<figcaption');
  });
});

describe('ContentRenderer lists', () => {
  it('renders unordered and ordered lists', () => {
    const unordered = render([
      {
        type: 'list',
        ordered: false,
        items: [
          {
            children: [
              { type: 'paragraph', children: [{ type: 'text', value: 'One' }] },
            ],
          },
        ],
      },
    ]);
    expect(unordered).toContain('<ul');
    expect(unordered).toContain('list-disc');
    expect(unordered).toContain('<li');
    expect(unordered).toContain('One');

    const ordered = render([
      {
        type: 'list',
        ordered: true,
        items: [
          {
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'First' }],
              },
            ],
          },
        ],
      },
    ]);
    expect(ordered).toContain('<ol');
    expect(ordered).toContain('list-decimal');
  });

  it('honours the ordered list start value', () => {
    const html = render([
      {
        type: 'list',
        ordered: true,
        start: 3,
        items: [
          {
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'Third' }],
              },
            ],
          },
        ],
      },
    ]);
    expect(html).toContain('start="3"');
  });

  it('renders nested block content inside list items', () => {
    const html = render([
      {
        type: 'list',
        ordered: false,
        items: [
          {
            children: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'Outer' }],
              },
              {
                type: 'list',
                ordered: true,
                items: [
                  {
                    children: [
                      {
                        type: 'paragraph',
                        children: [{ type: 'text', value: 'Inner' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(html).toContain('Outer');
    expect(html).toContain('Inner');
    expect((html.match(/<ul/g) ?? []).length).toBe(1);
    expect((html.match(/<ol/g) ?? []).length).toBe(1);
  });
});

describe('ContentRenderer code and quotes', () => {
  it('renders code blocks with an optional language class and escaped value', () => {
    const html = render([
      { type: 'code', value: 'const x = 1 < 2;', language: 'ts' },
    ]);
    expect(html).toContain('<pre');
    expect(html).toContain('<code');
    expect(html).toContain('language-ts');
    expect(html).toContain('const x = 1 &lt; 2;');
  });

  it('renders quotes with nested rich content', () => {
    const html = render([
      {
        type: 'quote',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'Stay ' },
              {
                type: 'emphasis',
                children: [{ type: 'text', value: 'curious' }],
              },
              { type: 'text', value: '.' },
            ],
          },
        ],
      },
    ]);
    expect(html).toContain('<blockquote');
    expect(html).toContain('<em');
    expect(html).toContain('Stay ');
  });
});

describe('ContentRenderer images and video', () => {
  it('renders a block image with a caption as figure/figcaption', () => {
    const html = render([
      {
        type: 'image',
        src: './a.png',
        alt: 'A picture',
        caption: 'A caption',
      },
    ]);
    expect(html).toContain('<figure');
    expect(html).toContain('<figcaption');
    expect(html).toContain('src="./a.png"');
    expect(html).toContain('alt="A picture"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain('A caption');
  });

  it('renders a block image without a caption as a bare img', () => {
    const html = render([{ type: 'image', src: './a.png', alt: 'A picture' }]);
    expect(html).toContain('<img');
    expect(html).not.toContain('<figure');
    expect(html).not.toContain('<figcaption');
  });

  it('renders video with poster, source, caption track and title', () => {
    const html = render([
      {
        type: 'video',
        src: './v.mp4',
        title: 'Intro video',
        poster: './poster.png',
        captions: './v.vtt',
      },
    ]);
    expect(html).toContain('<video');
    expect(html).toContain('controls');
    expect(html).toContain('preload="metadata"');
    expect(html).toContain('poster="./poster.png"');
    expect(html).toContain('aria-label="Intro video"');
    expect(html).toContain('<source src="./v.mp4"');
    expect(html).toContain('<track');
    expect(html).toContain('kind="captions"');
    expect(html).toContain('src="./v.vtt"');
    // Unspecified locale must not be reported as a concrete, wrong locale.
    expect(html).toContain('srcLang="und"');
    expect(html).toContain('<figcaption');
    expect(html).toContain('Intro video');
  });

  it('omits the caption track and figcaption when not provided', () => {
    const html = render([{ type: 'video', src: './v.mp4' }]);
    expect(html).toContain('aria-label="Video"');
    expect(html).not.toContain('<track');
    expect(html).not.toContain('<figcaption');
    expect(html).not.toContain('poster=');
  });
});

describe('ContentRenderer questionnaires', () => {
  it('renders a grouped questionnaire through a single shadcn questionnaire root', () => {
    const html = render([
      {
        type: 'questionnaire',
        id: 'questionnaire:lesson.mdx:1:1',
        questions: [singleChoiceQuestion],
      },
    ]);
    expect(html).toContain('data-slot="questionnaire"');
    expect(html).toContain('data-slot="questionnaire-item"');
    expect(html).toContain('data-slot="questionnaire-choice"');
    expect(html).toContain('<fieldset');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('Which option is correct?');
    expect(html).toContain('type="radio"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('value="first"');
    expect(html).toContain('value="second"');
    expect(html).toContain('Option A');
    expect(html).toContain('Option B');
    expect(html).toContain('Submit questionnaire');
    // Correctness must never be surfaced to the DOM.
    expect(html).not.toContain('correct=');
    expect(html).not.toContain('data-correct');
  });

  it('groups every question into one root instead of a wrapper per question', () => {
    const html = render([
      {
        type: 'questionnaire',
        id: 'questionnaire:lesson.mdx:1:1',
        questions: [singleChoiceQuestion, multipleChoiceQuestion],
      },
    ]);
    expect((html.match(/data-slot="questionnaire"/g) ?? []).length).toBe(1);
    expect((html.match(/data-slot="questionnaire-item"/g) ?? []).length).toBe(
      2,
    );
    expect(html).toContain('type="radio"');
    expect(html).toContain('type="checkbox"');
  });

  it('renders a true-false question as radios using the option values', () => {
    const html = render([
      {
        type: 'questionnaire',
        id: 'questionnaire:check.mdx:1:1',
        questions: [
          {
            type: 'question',
            id: 'question:check.mdx:1:1',
            questionType: 'true-false',
            prompt: [
              {
                type: 'paragraph',
                children: [{ type: 'text', value: 'Is it true?' }],
              },
            ],
            options: [
              {
                value: 'true',
                correct: true,
                content: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'True' }],
                  },
                ],
              },
              {
                value: 'false',
                correct: false,
                content: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'False' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
    expect(html).toContain('type="radio"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).toContain('value="true"');
    expect(html).toContain('value="false"');
  });

  it('supports rich prompt and option content', () => {
    const html = render([
      {
        type: 'questionnaire',
        id: 'questionnaire:check.mdx:1:1',
        questions: [
          {
            type: 'question',
            id: 'question:check.mdx:1:1',
            questionType: 'single-choice',
            prompt: [
              {
                type: 'heading',
                depth: 3,
                children: [{ type: 'text', value: 'Context' }],
              },
              {
                type: 'paragraph',
                children: [
                  { type: 'text', value: 'Read the ' },
                  {
                    type: 'strong',
                    children: [{ type: 'text', value: 'details' }],
                  },
                  { type: 'text', value: '.' },
                ],
              },
            ],
            options: [
              {
                value: 'a',
                correct: true,
                content: [
                  {
                    type: 'paragraph',
                    children: [
                      { type: 'text', value: 'An ' },
                      {
                        type: 'emphasis',
                        children: [{ type: 'text', value: 'emphasised' }],
                      },
                      { type: 'text', value: ' option' },
                    ],
                  },
                ],
              },
              {
                value: 'b',
                correct: false,
                content: [{ type: 'code', value: 'codeOption()' }],
              },
            ],
          },
        ],
      },
    ]);
    expect(html).toContain('<h3');
    expect(html).toContain('<strong');
    expect(html).toContain('<em');
    expect(html).toContain('<pre');
    expect(html).toContain('codeOption()');
  });

  it('renders questionnaires nested in list items', () => {
    const html = render([
      {
        type: 'list',
        ordered: false,
        items: [
          {
            children: [
              {
                type: 'questionnaire',
                id: 'questionnaire:nested.mdx:1:1',
                questions: [singleChoiceQuestion],
              },
            ],
          },
        ],
      },
    ]);
    expect(html).toContain('<li');
    expect(html).toContain('data-slot="questionnaire"');
    expect(html).toContain('Which option is correct?');
  });
});

describe('ContentRenderer safety', () => {
  it('escapes unsafe text in paragraphs and code', () => {
    const html = render([
      {
        type: 'paragraph',
        children: [{ type: 'text', value: '<script>alert(1)</script>' }],
      },
      { type: 'code', value: '<img src=x onerror=alert(1)>' },
    ]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('escapes unsafe text in inline nodes and link hrefs', () => {
    const html = renderInline([
      { type: 'inlineCode', value: '<b>' },
      { type: 'text', value: ' & ' },
      {
        type: 'link',
        href: './a.png?x="y"',
        children: [{ type: 'text', value: 'step' }],
      },
    ]);
    expect(html).toContain('&lt;b&gt;');
    expect(html).toContain('&amp;');
    expect(html).not.toContain('"y"');
    expect(html).toContain('&quot;y&quot;');
  });

  it('throws on an unknown runtime block node type', () => {
    expect(() =>
      render([{ type: 'mystery' } as unknown as ContentNode]),
    ).toThrow(/Unsupported content node type/);
  });

  it('throws on an unknown runtime inline node type', () => {
    expect(() =>
      render([
        {
          type: 'paragraph',
          children: [{ type: 'mystery' } as unknown as InlineNode],
        },
      ]),
    ).toThrow(/Unsupported inline node type/);
  });
});
