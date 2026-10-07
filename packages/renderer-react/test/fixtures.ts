import type { ContentPackage } from '@scorm-cli/core';

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
          content: [
            { type: 'heading', depth: 2, text: 'Welcome' },
            { type: 'paragraph', text: 'This is an introduction paragraph.' },
            {
              type: 'list',
              ordered: false,
              items: ['First point', 'Second point'],
            },
            {
              type: 'link',
              href: 'https://example.com/docs',
              text: 'Read the docs',
            },
            {
              type: 'image',
              src: './assets/thumb.svg',
              alt: 'Package thumbnail',
            },
            {
              type: 'video',
              src: './assets/lesson.mp4',
              title: 'Lesson video',
            },
            {
              type: 'question',
              questionType: 'single-choice',
              question: 'Which option is correct?',
              answers: [
                { text: 'Option A', correct: true },
                { text: 'Option B', correct: false },
              ],
            },
            {
              type: 'question',
              questionType: 'multiple-choice',
              question: 'Which options apply?',
              answers: [
                { text: 'Choice 1', correct: true },
                { text: 'Choice 2', correct: true },
                { text: 'Choice 3', correct: false },
              ],
            },
            { type: 'code', value: 'const answer = 42;', language: 'ts' },
            { type: 'quote', text: 'Simplicity is the soul of efficiency.' },
          ],
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
          content: [{ type: 'paragraph', text: 'Setup instructions.' }],
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
          content: [{ type: 'paragraph', text: 'Modal body content.' }],
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
          content: [{ type: 'paragraph', text: 'First step.' }],
        },
        {
          type: 'item',
          id: 'step-two',
          source: 'step-two.mdx',
          presentation: { open: 'page' },
          metadata: { title: 'Step two' },
          content: [{ type: 'paragraph', text: 'Second step.' }],
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
