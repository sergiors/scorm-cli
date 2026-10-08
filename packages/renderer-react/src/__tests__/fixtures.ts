import type {
  ContentPackage,
  ContentNode,
  GridNode,
  ItemNode,
  PageNode,
  QuestionnaireNode,
  QuestionNode,
  ScrollNode,
} from '@scorm-cli/core';

/** A single-choice question as authored inside a questionnaire. */
export const singleChoiceQuestion: QuestionNode = {
  type: 'question',
  id: 'question:intro.mdx:1:1',
  questionType: 'single-choice',
  prompt: [
    {
      type: 'paragraph',
      children: [{ type: 'text', value: 'Which option is correct?' }],
    },
  ],
  options: [
    {
      value: 'first',
      correct: true,
      content: [
        { type: 'paragraph', children: [{ type: 'text', value: 'Option A' }] },
      ],
    },
    {
      value: 'second',
      correct: false,
      content: [
        { type: 'paragraph', children: [{ type: 'text', value: 'Option B' }] },
      ],
    },
  ],
};

/** A multiple-choice question, so grouping exercises both input types. */
export const multipleChoiceQuestion: QuestionNode = {
  type: 'question',
  id: 'question:intro.mdx:1:2',
  questionType: 'multiple-choice',
  prompt: [
    {
      type: 'paragraph',
      children: [{ type: 'text', value: 'Which options apply?' }],
    },
  ],
  options: [
    {
      value: 'alpha',
      correct: true,
      content: [
        { type: 'paragraph', children: [{ type: 'text', value: 'Alpha' }] },
      ],
    },
    {
      value: 'beta',
      correct: false,
      content: [
        { type: 'paragraph', children: [{ type: 'text', value: 'Beta' }] },
      ],
    },
  ],
};

/**
 * A grouped questionnaire (single- then multiple-choice) with rich prompts and
 * options. Shared by the questionnaire component and presentation tests.
 */
export const questionnaireNode: QuestionnaireNode = {
  type: 'questionnaire',
  id: 'questionnaire:intro.mdx:1:1',
  questions: [singleChoiceQuestion, multipleChoiceQuestion],
};

/**
 * Rich content exercising every supported block and inline variant. Shared by
 * the package-level and DOM test suites; dedicated `content.test.tsx` cases
 * build focused nodes inline instead.
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
  questionnaireNode,
];

function paragraph(value: string): ContentNode {
  return { type: 'paragraph', children: [{ type: 'text', value }] };
}

export const introPage: PageNode = {
  type: 'page',
  id: 'page:intro.mdx',
  source: 'intro.mdx',
  metadata: { title: 'Introduction' },
  content: richContent,
};

export const setupPage: PageNode = {
  type: 'page',
  id: 'page:setup.mdx',
  source: 'setup.mdx',
  metadata: { title: 'Setting things up' },
  content: [paragraph('Setup instructions.')],
};

export const scrollPackage: ContentPackage = {
  metadata: { title: 'Rendering Fundamentals' },
  presentation: {
    type: 'scroll',
    pages: [introPage, setupPage],
  } satisfies ScrollNode,
};

/** Alias kept for the build/dev suites that only need representative content. */
export const samplePackage: ContentPackage = scrollPackage;

export const functionsItem: ItemNode = {
  type: 'item',
  id: 'item:functions.mdx',
  source: 'functions.mdx',
  metadata: { title: 'Functions' },
  content: [paragraph('Function body.')],
};

export const typesItem: ItemNode = {
  type: 'item',
  id: 'item:types.mdx',
  source: 'types.mdx',
  metadata: { title: 'Types' },
  content: [paragraph('Type body.')],
};

export const detailsItem: ItemNode = {
  type: 'item',
  id: 'item:details.mdx',
  source: 'details.mdx',
  metadata: { title: 'Extra details' },
  content: [paragraph('Modal body content.')],
};

export const gridPackage: ContentPackage = {
  metadata: { title: 'Grid package' },
  presentation: {
    type: 'grid',
    columns: 2,
    items: [functionsItem, typesItem, detailsItem],
  } satisfies GridNode,
};

export function makeEmptyPackage(): ContentPackage {
  return {
    metadata: { title: 'Empty package' },
    presentation: { type: 'scroll', pages: [] } satisfies ScrollNode,
  };
}

export function makeEmptyGridPackage(): ContentPackage {
  return {
    metadata: { title: 'Empty grid package' },
    presentation: { type: 'grid', items: [] } satisfies GridNode,
  };
}
