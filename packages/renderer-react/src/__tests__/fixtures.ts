import { getPresentationNodes } from '@scorm-cli/core'
import type {
  ContentPackage,
  ContentNode,
  PageNode,
  QuestionnaireNode,
  QuestionNode,
  ScrollNode,
  ItemNode,
  TilesNode
} from '@scorm-cli/core'
import type { ContentProvider } from '../../app/lib/content-loader'

/** A single-choice question as authored inside a questionnaire. */
export const singleChoiceQuestion: QuestionNode = {
  type: 'question',
  id: 'question:intro.mdx:1:1',
  questionType: 'single-choice',
  prompt: 'Which option is correct?',
  options: [
    {
      value: 'first',
      correct: true,
      content: 'Option A'
    },
    {
      value: 'second',
      correct: false,
      content: 'Option B'
    }
  ]
}

/** A multiple-choice question, so grouping exercises both input types. */
export const multipleChoiceQuestion: QuestionNode = {
  type: 'question',
  id: 'question:intro.mdx:1:2',
  questionType: 'multiple-choice',
  prompt: 'Which options apply?',
  options: [
    {
      value: 'alpha',
      correct: true,
      content: 'Alpha'
    },
    {
      value: 'beta',
      correct: false,
      content: 'Beta'
    }
  ]
}

/**
 * A grouped questionnaire (single- then multiple-choice) with plain-text
 * prompts and options. Shared by the questionnaire component and presentation
 * tests. The cap matches the parser's normalized single-attempt default.
 */
export const questionnaireNode: QuestionnaireNode = {
  type: 'questionnaire',
  id: 'questionnaire:intro.mdx:1:1',
  contributesToScore: true,
  revealCorrectAnswers: true,
  maxAttempts: 1,
  questions: [singleChoiceQuestion, multipleChoiceQuestion]
}

/**
 * Rich content exercising every supported block and inline variant. Shared by
 * the package-level and DOM test suites; dedicated `content.test.tsx` cases
 * build focused nodes inline instead.
 */
export const richContent: ContentNode[] = [
  {
    type: 'heading',
    depth: 2,
    children: [{ type: 'text', value: 'Welcome' }]
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
        children: [{ type: 'text', value: 'link' }]
      },
      { type: 'break' },
      {
        type: 'image',
        src: './assets/inline.svg',
        alt: 'Inline icon'
      },
      { type: 'text', value: 'after the image.' }
    ]
  },
  {
    type: 'list',
    ordered: false,
    items: [
      {
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'First point' }]
          }
        ]
      },
      {
        children: [
          {
            type: 'paragraph',
            children: [{ type: 'text', value: 'Second point' }]
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
                    children: [{ type: 'text', value: 'Nested step' }]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
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
          { type: 'text', value: '.' }
        ]
      }
    ]
  },
  {
    type: 'image',
    src: './assets/thumb.svg',
    alt: 'Package thumbnail',
    caption: 'The package thumbnail'
  },
  {
    type: 'video',
    id: 'video:lesson.mdx:1:1',
    provider: 'native',
    src: './assets/lesson.mp4',
    title: 'Lesson video',
    poster: './assets/poster.png',
    captions: './assets/lesson.vtt'
  },
  questionnaireNode
]

function paragraph(value: string): ContentNode {
  return { type: 'paragraph', children: [{ type: 'text', value }] }
}

/**
 * One heading per authored Markdown depth 1-6. Shared by the renderer,
 * scroll and tiles suites to assert that each depth maps straight to its
 * matching `h1`-`h6`, with no wrapper or nested context shifting the level.
 */
export const headingDepths: ContentNode[] = Array.from({ length: 6 }, (_, index) => ({
  type: 'heading',
  depth: index + 1,
  children: [{ type: 'text', value: `Level ${index + 1}` }]
}))

export const introPage: PageNode = {
  type: 'page',
  id: 'page:intro.mdx',
  source: 'intro.mdx',
  metadata: { title: 'Introduction' },
  content: richContent
}

export const setupPage: PageNode = {
  type: 'page',
  id: 'page:setup.mdx',
  source: 'setup.mdx',
  metadata: { title: 'Setting things up' },
  content: [paragraph('Setup instructions.')]
}

export const scrollPackage: ContentPackage = {
  metadata: { title: 'Rendering Fundamentals' },
  presentation: {
    type: 'scroll',
    pages: [introPage, setupPage]
  } satisfies ScrollNode
}

/** Alias kept for the build/dev suites that only need representative content. */
export const samplePackage: ContentPackage = scrollPackage

export const functionsItem: ItemNode = {
  type: 'item',
  id: 'item:functions.mdx',
  source: 'functions.mdx',
  metadata: { title: 'Functions' },
  content: [paragraph('Function body.')]
}

export const typesItem: ItemNode = {
  type: 'item',
  id: 'item:types.mdx',
  source: 'types.mdx',
  metadata: { title: 'Types' },
  content: [paragraph('Type body.')]
}

export const detailsItem: ItemNode = {
  type: 'item',
  id: 'item:details.mdx',
  source: 'details.mdx',
  metadata: { title: 'Extra details' },
  content: [paragraph('Modal body content.')]
}

export const tilesPackage: ContentPackage = {
  metadata: { title: 'Tiles package' },
  presentation: {
    type: 'tiles',
    columns: 2,
    items: [functionsItem, typesItem, detailsItem]
  } satisfies TilesNode
}

/** A one-at-a-time slides package over the same pages as {@link scrollPackage}. */
export const slidesPackage: ContentPackage = {
  metadata: { title: 'Slides package' },
  presentation: {
    type: 'slides',
    pages: [introPage, setupPage]
  }
}

export function makeEmptyPackage(): ContentPackage {
  return {
    metadata: { title: 'Empty package' },
    presentation: { type: 'scroll', pages: [] } satisfies ScrollNode
  }
}

export function makeEmptyTilesPackage(): ContentPackage {
  return {
    metadata: { title: 'Empty tiles package' },
    presentation: { type: 'tiles', items: [] } satisfies TilesNode
  }
}

/**
 * The test implementation of the runtime {@link ContentProvider}: `get` answers
 * every node from the content already held inline in `contentPackage`, so a
 * package whose bodies are present needs no load and renders synchronously (the
 * static-markup suites depend on this). Production packages embed no bodies and
 * answer `load` from an independent dynamic import; both go through the same
 * abstraction, so the presentations have a single code path.
 */
export function inlineContentProvider(contentPackage: ContentPackage): ContentProvider {
  const byId = new Map(getPresentationNodes(contentPackage).map((node) => [node.id, node.content]))
  return {
    get(nodeId) {
      return byId.get(nodeId)
    },
    load(nodeId) {
      const content = byId.get(nodeId)
      // Mirror the generated provider: an id with no module is a real
      // inconsistency, so it rejects rather than resolving to a blank node.
      return content === undefined
        ? Promise.reject(new Error(`No content module for node id: ${nodeId}`))
        : Promise.resolve(content)
    }
  }
}
