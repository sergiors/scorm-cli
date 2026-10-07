import type { ContentPackage, ContentNode } from '@scorm-cli/core';

/**
 * Rich content exercising every block and inline variant. Shared by the
 * package-level and DOM test suites; dedicated `content.test.tsx` cases build
 * focused nodes inline instead.
 */
export const richContent: ContentNode[] = [
  {
    type: 'heading',
    depth: 2,
    children: [{ type: 'text', value: 'Welcome' }],
  },
  {
    type: 'paragraph',
    children: [
      { type: 'text', value: 'This is an introduction with ' },
      { type: 'emphasis', children: [{ type: 'text', value: 'emphasis' }] },
      { type: 'text', value: ', ' },
      { type: 'strong', children: [{ type: 'text', value: 'strong text' }] },
      { type: 'text', value: ', and ' },
      { type: 'inlineCode', value: 'inline()' },
      { type: 'text', value: ' plus a ' },
      {
        type: 'link',
        href: 'https://example.com/docs',
        children: [{ type: 'text', value: 'link' }],
      },
      { type: 'break' },
      {
        type: 'image',
        src: './assets/inline.svg',
        alt: 'Inline icon',
      },
      { type: 'text', value: 'after the image.' },
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
            children: [{ type: 'text', value: 'First point' }],
          },
        ],
      },
      {
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Second point' }],
          },
          {
            type: 'list',
            ordered: true,
            start: 2,
            items: [
              {
                children: [
                  {
                    type: 'paragraph',
                    children: [{ type: 'text', value: 'Nested step' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  { type: 'code', value: 'const answer = 42;', language: 'ts' },
  {
    type: 'quote',
    children: [
      {
        type: 'paragraph',
        children: [
          { type: 'text', value: 'Simplicity is the soul of ' },
          { type: 'strong', children: [{ type: 'text', value: 'efficiency' }] },
          { type: 'text', value: '.' },
        ],
      },
    ],
  },
  {
    type: 'image',
    src: './assets/thumb.svg',
    alt: 'Package thumbnail',
    caption: 'The package thumbnail',
  },
  {
    type: 'video',
    src: './assets/lesson.mp4',
    title: 'Lesson video',
    poster: './assets/poster.png',
    captions: './assets/lesson.vtt',
  },
  {
    type: 'callout',
    variant: 'tip',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'Try the exercise yourself.' }],
      },
    ],
  },
  {
    type: 'example',
    title: 'A worked example',
    children: [{ type: 'code', value: 'add(1, 2);', language: 'ts' }],
  },
  {
    type: 'question',
    questionType: 'single-choice',
    prompt: [
      {
        type: 'paragraph',
        children: [{ type: 'text', value: 'Which option is correct?' }],
      },
    ],
    options: [
      {
        value: 'a',
        correct: true,
        content: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Option A' }],
          },
        ],
      },
      {
        value: 'b',
        correct: false,
        content: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Option B' }],
          },
        ],
      },
    ],
  },
  {
    type: 'steps',
    steps: [
      {
        title: 'Install',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Run the installer.' }],
          },
        ],
      },
      {
        title: 'Configure',
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Edit the config file.' }],
          },
        ],
      },
    ],
  },
];

export const samplePackage: ContentPackage = {
  metadata: {
    title: 'Rendering Fundamentals',
    description: 'A short package used by the renderer test suite.',
  },
  children: [
    {
      type: 'section',
      id: 'getting-started',
      title: 'Getting started',
      presentation: { layout: 'list' },
      children: [
        {
          type: 'item',
          id: 'intro',
          source: 'intro.mdx',
          presentation: { open: 'page' },
          metadata: {
            title: 'Introduction',
            description: 'What this package covers.',
            thumbnail: './assets/thumb.svg',
          },
          content: richContent,
        },
      ],
    },
    {
      type: 'section',
      id: 'media',
      title: 'Media',
      presentation: { layout: 'grid', columns: 2 },
      children: [
        {
          type: 'item',
          id: 'setup',
          source: 'setup.mdx',
          presentation: { open: 'page' },
          metadata: {
            title: 'Setting things up',
            thumbnail: './assets/setup.svg',
          },
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: 'Setup instructions.' }],
            },
          ],
        },
        {
          type: 'item',
          id: 'details',
          source: 'details.mdx',
          presentation: { open: 'modal' },
          metadata: {
            title: 'Extra details',
            description: 'Opens in a modal.',
            thumbnail: './assets/details.svg',
          },
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: 'Modal body content.' }],
            },
          ],
        },
      ],
    },
    {
      type: 'section',
      id: 'walkthrough',
      title: 'Walkthrough',
      presentation: { layout: 'sequence' },
      children: [
        {
          type: 'item',
          id: 'step-one',
          source: 'step-one.mdx',
          presentation: { open: 'page' },
          metadata: { title: 'Step one' },
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: 'First step.' }],
            },
          ],
        },
        {
          type: 'item',
          id: 'step-two',
          source: 'step-two.mdx',
          presentation: { open: 'page' },
          metadata: { title: 'Step two' },
          content: [
            {
              type: 'paragraph',
              children: [{ type: 'text', value: 'Second step.' }],
            },
          ],
        },
      ],
    },
  ],
};

export function makeEmptyPackage(): ContentPackage {
  return {
    metadata: { title: 'Empty package' },
    children: [],
  };
}
